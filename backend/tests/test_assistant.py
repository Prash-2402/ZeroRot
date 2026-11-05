"""Mitra assistant: rule-based answers use engine numbers, navigate the app, cite the knowledge library."""
import os
import pathlib
import tempfile

_tmp = pathlib.Path(tempfile.mkdtemp()) / "assistant.db"
os.environ.setdefault("DATABASE_URL", f"sqlite:///{_tmp.as_posix()}")

from app.core import config  # noqa: E402

config.settings.groq_api_key = ""

from app.assistant.agent import chat, detect_lang  # noqa: E402
from app.assistant.rag import index  # noqa: E402
from app.db.seed import seed  # noqa: E402
from app.db.session import SessionLocal  # noqa: E402


def setup_module(_):
    seed()


def ask(msg, ctx=None):
    with SessionLocal() as db:
        return chat(db, msg, None, ctx or {}, [])


def test_language_detection():
    assert detect_lang("ನನ್ನ ಟೊಮೇಟೊ", "en") == "kn" and detect_lang("hello", "en") == "en"


def test_kannada_days_left_uses_engine_and_navigates():
    r = ask("ನನ್ನ ಟೊಮೇಟೊ ಎಷ್ಟು ದಿನ ಉಳಿಯುತ್ತದೆ?")
    assert r["lang"] == "kn" and r["engine"] == "rule_based" and "ದಿನ" in r["reply"]
    assert {"type": "focus", "place": "shed", "batch_id": "ZR-TOM-001"} in r["ui"]


def test_choices_open_screen():
    r = ask("What should I do with my mangoes?")
    assert any(a["type"] == "open_choices" and a["batch_id"] == "ZR-MAN-001" for a in r["ui"])


def test_festival_when_to_sell_flips_from_today():
    r = ask("ಹಬ್ಬದ ಸಮಯದಲ್ಲಿ ಮಾವು ಯಾವಾಗ ಮಾರಬೇಕು?")
    assert "ಇಂದು" not in r["reply"].split(",")[1]


def test_truck_actions_need_confirmation():
    r = ask("Where is the mandi truck?")
    assert any(a["type"] == "confirm" and a["action"] == "handover" for a in r["ui"])
    with SessionLocal() as db:
        from app.db.models import Batch
        assert db.get(Batch, "ZR-BAN-001").status == "stored"  # nothing happened without the farmer's tap


def test_knowledge_answer_cites_source():
    r = ask("why do bananas get damaged in cold?")
    assert r["sources"] and r["sources"][0]["heading"] == "Banana chilling injury" and "UC Davis" in r["reply"]


def test_retrieval_handles_kannada():
    hits = index().search("ಮಾವಿಗೆ ರೋಗ ಏಕೆ ಬರುತ್ತದೆ", 1)
    assert hits and hits[0]["heading"] == "Mango diseases and handling"
