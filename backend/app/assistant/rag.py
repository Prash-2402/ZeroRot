"""Retrieval over the bilingual knowledge library (data/knowledge/*.md).

Lexical retrieval with character n-gram TF-IDF (scikit-learn). Character n-grams work for Kannada script and
English without downloading an embedding model. An embedding retriever can replace `Index.search` later
without changing callers."""
from __future__ import annotations

import pathlib
import re
from dataclasses import dataclass
from functools import lru_cache

from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.metrics.pairwise import linear_kernel

KNOWLEDGE_DIR = pathlib.Path(__file__).resolve().parents[3] / "data" / "knowledge"
KANNADA = re.compile(r"[ಀ-೿]")
MIN_SCORE = 0.08
# topic boosts: question words -> words in a section heading (small, transparent re-ranking)
BOOSTS = [
    (("cold", "chill", "ಶೀತ", "ತಣ್ಣ", "ಹಾನಿ", "damage", "injur", "fridge"), ("chilling", "heat injury")),
    (("humid", "ತೇವ", "moist", "dry", "ಒಣ"), ("humidity",)),
    (("rot", "disease", "ರೋಗ", "ಕೊಳೆ", "mould", "mold", "ಬೂಷ್ಟು", "fung"), ("rots", "diseases", "handling")),
    (("ripen", "ಹಣ್ಣಾಗ", "ಹಣ್ಣು ಮಾಡ"), ("ripening",)),
    (("auction", "ಹರಾಜು", "mandi time"), ("auction",)),
    (("confiden", "ವಿಶ್ವಾಸ", "trust", "sure"), ("confidence",)),
    (("price", "value", "ಬೆಲೆ", "ಮೌಲ್ಯ", "worth", "money", "ಹಣ"), ("value",)),
]


def is_kannada(text: str) -> bool:
    return len(KANNADA.findall(text or "")) >= 2


@dataclass
class Chunk:
    doc: str
    title: str
    heading: str
    source: str
    url: str
    en: str
    kn: str

    @property
    def text(self) -> str:
        return f"{self.heading}\n{self.en}\n{self.kn}"


def _parse(path: pathlib.Path) -> list[Chunk]:
    raw = path.read_text(encoding="utf-8")
    meta = {}
    if raw.startswith("---"):
        head, raw = raw[3:].split("---", 1)
        for line in head.strip().splitlines():
            if ":" in line:
                k, v = line.split(":", 1)
                meta[k.strip()] = v.strip()
    out = []
    for sec in re.split(r"^## ", raw, flags=re.M):
        sec = sec.strip()
        if not sec:
            continue
        heading, _, body = sec.partition("\n")
        paras = [p.strip() for p in body.split("\n\n") if p.strip()]
        en = " ".join(p for p in paras if not is_kannada(p))
        kn = " ".join(p for p in paras if is_kannada(p))
        out.append(Chunk(path.stem, meta.get("title", path.stem), heading.strip(), meta.get("source", ""), meta.get("url", ""), en, kn))
    return out


class Index:
    def __init__(self, chunks: list[Chunk]):
        self.chunks = chunks
        self.vec = TfidfVectorizer(analyzer="char_wb", ngram_range=(2, 4), sublinear_tf=True, lowercase=True)
        self.matrix = self.vec.fit_transform([c.text for c in chunks]) if chunks else None

    def search(self, query: str, k: int = 3) -> list[dict]:
        if not self.chunks or not query.strip():
            return []
        scores = linear_kernel(self.vec.transform([query]), self.matrix).ravel()
        q = query.lower()
        for words, heads in BOOSTS:
            if any(w in q for w in words):
                for i, c in enumerate(self.chunks):
                    if any(h in c.heading.lower() for h in heads):
                        scores[i] += 0.12
        crops = {"tomato": ("tomato", "ಟೊಮ"), "mango": ("mango", "ಮಾವ"), "banana": ("banana", "ಬಾಳೆ")}
        named = [c for c, ws in crops.items() if any(w in q for w in ws)]
        if named:
            for i, c in enumerate(self.chunks):
                if c.doc in crops:
                    scores[i] += 0.15 if c.doc in named else -0.15
        order = scores.argsort()[::-1][:k]
        return [{"title": self.chunks[i].title, "heading": self.chunks[i].heading, "source": self.chunks[i].source,
                 "url": self.chunks[i].url, "en": self.chunks[i].en, "kn": self.chunks[i].kn, "score": round(float(scores[i]), 3)}
                for i in order if scores[i] >= MIN_SCORE]


@lru_cache(maxsize=1)
def index() -> Index:
    chunks = []
    for f in sorted(KNOWLEDGE_DIR.glob("*.md")):
        chunks += _parse(f)
    return Index(chunks)
