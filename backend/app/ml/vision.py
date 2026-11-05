"""Produce inspection from images.

Default method: classical computer vision with OpenCV (not a trained neural network):
1. Segment produce from background (HSV saturation/value thresholds + Otsu, morphology), split touching fruit with
   distance-transform watershed.
2. Per object measure: lesion share (dark/brown pixels well below the object's own median brightness), mould share
   (low-saturation, bright, greyish pixels), colour-stage shares.
3. Defect score = lesion + 1.5 x mould. Good < 0.06 <= Moderately damaged < 0.20 <= Spoiled/Rejected.
   Confidence falls near the thresholds and for poorly segmented objects; below 0.55 the object is 'uncertain'.
Thresholds are engineering assumptions (configurable), not validated against a labelled dataset.

Optional: if an ONNX classifier exists at CV_MODEL_PATH (with a .labels.txt next to it), crops are classified with
cv2.dnn instead. No weights ship with the project."""
from __future__ import annotations

import pathlib

import cv2
import numpy as np

from app.core.config import settings

GOOD_MAX = 0.06
DAMAGED_MAX = 0.20
MIN_CONFIDENCE = 0.55
METHOD = "opencv_classical"
VERSION = "opencv-defect-v1"


def model_status() -> dict:
    p = pathlib.Path(settings.cv_model_path)
    if p.exists() and p.with_suffix(".labels.txt").exists():
        return {"available": True, "method": "onnx_model", "path": str(p)}
    return {"available": False, "method": METHOD,
            "message": "No trained model weights installed; using classical OpenCV defect analysis."}


def _decode(data: bytes) -> np.ndarray:
    img = cv2.imdecode(np.frombuffer(data, np.uint8), cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("File is not a readable image")
    h, w = img.shape[:2]
    if min(h, w) < 64:
        raise ValueError("Image too small to inspect (minimum 64 px)")
    scale = 800.0 / max(h, w)
    if scale < 1:
        img = cv2.resize(img, (int(w * scale), int(h * scale)), interpolation=cv2.INTER_AREA)
    return img


def _segment(img: np.ndarray) -> tuple[np.ndarray, np.ndarray]:
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    s, v = hsv[..., 1], hsv[..., 2]
    _, s_otsu = cv2.threshold(s, 0, 255, cv2.THRESH_BINARY + cv2.THRESH_OTSU)
    mask = ((s_otsu > 0) & (s > 45) & (v > 35)).astype(np.uint8) * 255
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (7, 7))
    mask = cv2.morphologyEx(mask, cv2.MORPH_CLOSE, k, iterations=2)
    mask = cv2.morphologyEx(mask, cv2.MORPH_OPEN, k, iterations=1)
    # fill holes so lesions inside a fruit stay inside its mask
    cnts, _ = cv2.findContours(mask, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    filled = np.zeros_like(mask)
    cv2.drawContours(filled, cnts, -1, 255, thickness=cv2.FILLED)
    # split touching objects: one marker per distance-transform peak (fruit centre)
    dist = cv2.distanceTransform(filled, cv2.DIST_L2, 5)
    dmax = dist.max() if dist.max() > 0 else 1.0
    ksz = max(15, int(dmax * 0.9) | 1)
    dil = cv2.dilate(dist, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (ksz, ksz)))
    peaks = ((dist >= dil - 1e-6) & (dist > 0.35 * dmax)).astype(np.uint8)
    sure = cv2.dilate(peaks, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (9, 9))) * 255
    n, markers = cv2.connectedComponents(sure)
    markers = markers + 1
    unknown = cv2.subtract(filled, sure)
    markers[unknown == 255] = 0
    markers = cv2.watershed(img.copy(), markers)
    return filled, markers


def background_lab(img: np.ndarray, fg: np.ndarray) -> np.ndarray | None:
    """Median Lab colour of the image border outside the produce mask (None if the border is all produce)."""
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB).reshape(-1, 3)
    h, w = fg.shape
    b = max(4, int(0.05 * min(h, w)))
    border = np.zeros_like(fg, dtype=bool)
    border[:b, :], border[-b:, :], border[:, :b], border[:, -b:] = True, True, True, True
    sel = (border & (fg == 0)).reshape(-1)
    if sel.sum() < 200:
        return None
    return np.median(lab[sel], axis=0)


def _object_features(img: np.ndarray, obj_mask: np.ndarray, bg_lab: np.ndarray | None = None) -> dict:
    hsv = cv2.cvtColor(img, cv2.COLOR_BGR2HSV)
    m8 = obj_mask.astype(np.uint8)
    size = max(3, int(0.04 * np.sqrt(obj_mask.sum())))
    inner = cv2.erode(m8, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * size + 1, 2 * size + 1))).astype(bool)
    if inner.sum() < 0.3 * obj_mask.sum():
        inner = obj_mask
    h, s, v = hsv[..., 0][inner], hsv[..., 1][inner].astype(float), hsv[..., 2][inner].astype(float)
    n = max(1, h.size)
    med_v = float(np.median(v))
    lesion = ((v < 0.55 * med_v) & ((h <= 30) | (h >= 160))).sum() / n
    # mould: greyish-white pixels inside the object's convex hull that do not match the background colour
    cnts, _ = cv2.findContours(m8 * 255, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
    hull_mask = np.zeros_like(m8)
    cv2.drawContours(hull_mask, [cv2.convexHull(max(cnts, key=cv2.contourArea))], -1, 1, thickness=cv2.FILLED)
    hull = hull_mask.astype(bool)
    hs, hv = hsv[..., 1][hull].astype(float), hsv[..., 2][hull].astype(float)
    cand = (hs < 50) & (hv > 0.75 * med_v) & (hv > 120)
    if bg_lab is not None:
        lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)[hull].astype(float)
        cand &= np.linalg.norm(lab - bg_lab, axis=1) > 18
    mould = cand.sum() / max(1, hull.sum())
    red = (((h <= 10) | (h >= 165)) & (s > 80)).sum() / n
    yellow = ((h > 15) & (h <= 35) & (s > 80)).sum() / n
    green = ((h > 35) & (h <= 85) & (s > 60)).sum() / n
    return {"lesion_share": round(float(lesion), 4), "mould_share": round(float(mould), 4), "red_share": round(float(red), 3),
            "yellow_share": round(float(yellow), 3), "green_share": round(float(green), 3), "median_brightness": round(med_v, 1)}


def _classify(f: dict, solidity: float, elongated: bool = False) -> tuple[str, float, float]:
    score = f["lesion_share"] + 1.5 * f["mould_share"]
    if score < GOOD_MAX:
        cat, margin = "good", (GOOD_MAX - score) / GOOD_MAX
    elif score < DAMAGED_MAX:
        cat, margin = "damaged", min(score - GOOD_MAX, DAMAGED_MAX - score) / ((DAMAGED_MAX - GOOD_MAX) / 2)
    else:
        cat, margin = "rejected", min(1.0, (score - DAMAGED_MAX) / DAMAGED_MAX)
    conf = 0.5 + 0.45 * max(0.0, min(1.0, margin))
    if not elongated:   # bananas are naturally non-convex
        conf *= max(0.6, min(1.0, (solidity - 0.55) / 0.25))   # irregular segments lower confidence
    if conf < MIN_CONFIDENCE:
        cat = "uncertain"
    return cat, round(conf, 3), round(score, 4)


def inspect(data: bytes, image_name: str = "image", commodity: str | None = None) -> dict:
    img = _decode(data)
    filled, markers = _segment(img)
    bg = background_lab(img, filled)
    area_total = img.shape[0] * img.shape[1]
    objects = []
    for label in np.unique(markers):
        if label <= 1:
            continue
        m = (markers == label) & (filled > 0)
        area = int(m.sum())
        if area < 0.012 * area_total:
            continue
        ys, xs = np.where(m)
        x0, y0, x1, y1 = int(xs.min()), int(ys.min()), int(xs.max()), int(ys.max())
        cnts, _ = cv2.findContours(m.astype(np.uint8) * 255, cv2.RETR_EXTERNAL, cv2.CHAIN_APPROX_SIMPLE)
        c = max(cnts, key=cv2.contourArea)
        hull = cv2.convexHull(c)
        solidity = float(cv2.contourArea(c) / max(1.0, cv2.contourArea(hull)))
        f = _object_features(img, m, bg)
        cat, conf, score = _classify(f, solidity, elongated=commodity == "banana")
        f.update({"defect_score": score, "solidity": round(solidity, 3), "area_px": area})
        objects.append({"image_name": image_name, "bbox": [x0, y0, x1 - x0, y1 - y0], "category": cat, "confidence": conf, "features": f})
    coverage = float((filled > 0).sum()) / area_total
    note = None
    if not objects:
        note = "No produce could be segmented; photograph produce on a plain, contrasting background."
    elif coverage > 0.85:
        note = "Produce fills almost the whole frame; object separation is unreliable, so counts are approximate."
    return {"image_name": image_name, "width": img.shape[1], "height": img.shape[0], "objects": objects, "coverage": round(coverage, 3),
            "note": note, "method": METHOD, "model_version": VERSION}


def summarise(results: list[dict], batch_quantity_kg: float | None = None, sample_kg: float | None = None) -> dict:
    objs = [o for r in results for o in r["objects"]]
    counts = {k: sum(1 for o in objs if o["category"] == k) for k in ("good", "damaged", "rejected", "uncertain")}
    n = len(objs)
    classified = n - counts["uncertain"]
    shares = {k: (counts[k] / classified if classified else None) for k in ("good", "damaged", "rejected")}
    out = {"objects_detected": n, "counts": counts, "classified_objects": classified,
           "shares_of_classified": {k: (round(v, 3) if v is not None else None) for k, v in shares.items()},
           "mean_confidence": round(float(np.mean([o["confidence"] for o in objs])), 3) if objs else None,
           "defects": {"mean_lesion_share": round(float(np.mean([o["features"]["lesion_share"] for o in objs])), 4) if objs else None,
                       "mean_mould_share": round(float(np.mean([o["features"]["mould_share"] for o in objs])), 4) if objs else None},
           "scope": "Only the objects visible in the uploaded images were inspected."}
    if batch_quantity_kg and classified:
        out["batch_estimate"] = {"batch_quantity_kg": batch_quantity_kg, "sample_kg": sample_kg,
                                 "estimated_kg": {k: round(batch_quantity_kg * v, 1) for k, v in shares.items() if v is not None},
                                 "label": "Extrapolated from the inspected sample to the whole batch (estimate, not an inspection of every unit)."}
    return out
