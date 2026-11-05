"""CSV and PDF exports of simulation results and comparisons."""
from __future__ import annotations

import csv
import io
from datetime import datetime

from reportlab.lib import colors
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle

GOLD = colors.HexColor("#FFC900")
BLACK = colors.HexColor("#08090B")

ROWS = [("Initial quantity (kg)", "initial_kg"), ("Final saleable quantity (kg)", "final_saleable_kg"), ("Quantity lost (kg)", "lost_kg"),
        ("Loss (%)", "loss_pct"), ("Final quality (0-100)", "final_quality"), ("Remaining shelf life (days)", "remaining_shelf_life_days"),
        ("Weight loss (%)", "weight_loss_pct"), ("Rejected (%)", "rejected_pct"), ("Duration (days)", "duration_days"), ("Energy (kWh)", "energy_kwh")]
MONEY = [("Revenue (Rs)", "revenue"), ("Storage cost (Rs)", "storage_cost"), ("Transport cost (Rs)", "transport_cost"),
         ("Energy cost (Rs)", "energy_cost"), ("Net profit (Rs)", "net_profit")]


def comparison_csv(cmp: dict) -> str:
    buf = io.StringIO()
    w = csv.writer(buf)
    w.writerow(["metric", cmp["baseline"]["label"], cmp["improved"]["label"]])
    for name, key in ROWS:
        w.writerow([name, cmp["baseline"].get(key), cmp["improved"].get(key)])
    for name, key in MONEY:
        w.writerow([name, cmp["baseline"]["money"].get(key), cmp["improved"]["money"].get(key)])
    w.writerow(["Loss prevented (kg)", "", cmp["loss_prevented_kg"]])
    w.writerow(["Note", cmp["label"], ""])
    return buf.getvalue()


def comparison_pdf(cmp: dict, title: str, context: dict) -> bytes:
    buf = io.BytesIO()
    doc = SimpleDocTemplate(buf, pagesize=A4, leftMargin=18 * mm, rightMargin=18 * mm, topMargin=16 * mm, bottomMargin=16 * mm,
                            title=title, author="ZERO ROT")
    st = getSampleStyleSheet()
    story = [Paragraph(f"<b>ZERO ROT</b> — {title}", st["Title"]),
             Paragraph(f"Generated {datetime.utcnow().strftime('%Y-%m-%d %H:%M')} UTC", st["Normal"]), Spacer(1, 6)]
    for k, v in context.items():
        story.append(Paragraph(f"<b>{k}:</b> {v}", st["Normal"]))
    story.append(Spacer(1, 8))
    data = [["Metric", cmp["baseline"]["label"], cmp["improved"]["label"]]]
    data += [[n, _f(cmp["baseline"].get(k)), _f(cmp["improved"].get(k))] for n, k in ROWS]
    data += [[n, _f(cmp["baseline"]["money"].get(k)), _f(cmp["improved"]["money"].get(k))] for n, k in MONEY]
    data.append(["Loss prevented (kg)", "", _f(cmp["loss_prevented_kg"])])
    t = Table(data, colWidths=[70 * mm, 50 * mm, 50 * mm])
    t.setStyle(TableStyle([("BACKGROUND", (0, 0), (-1, 0), BLACK), ("TEXTCOLOR", (0, 0), (-1, 0), GOLD), ("FONTSIZE", (0, 0), (-1, -1), 9),
                           ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#C9C6BF")), ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, colors.HexColor("#F5F3EF")])]))
    story += [t, Spacer(1, 10), Paragraph(f"<i>{cmp['label']}</i>", st["Normal"])]
    doc.build(story)
    return buf.getvalue()


def _f(v):
    if v is None:
        return "—"
    if isinstance(v, float):
        return f"{v:,.2f}"
    return str(v)
