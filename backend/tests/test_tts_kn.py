"""Kannada voice: numbers, money, percent and Latin letters become Kannada words the voice can pronounce;
synthesis returns a WAV when the model is installed."""
import io

import pytest

from app.integrations import tts_kn


def test_number_words():
    assert tts_kn.number_words(21) == "ಇಪ್ಪತ್ತೊಂದು"
    assert tts_kn.number_words(150) == "ನೂರ ಐವತ್ತು"
    assert tts_kn.number_words(2500) == "ಎರಡು ಸಾವಿರದ ಐನೂರು"
    assert tts_kn.number_words(123456) == "ಒಂದು ಲಕ್ಷದ ಇಪ್ಪತ್ತಮೂರು ಸಾವಿರದ ನಾನೂರ ಐವತ್ತಾರು"


def test_speakable_text_has_no_digits_or_latin():
    out = tts_kn.to_speakable("ಕೆಜಿಗೆ ₹42, ಒಟ್ಟು 69,900 ರೂಪಾಯಿ; ಆರ್ದ್ರತೆ 98%, APMC 4.5 ದಿನ")
    assert "ನಲವತ್ತೆರಡು ರೂಪಾಯಿ," in out and "ಶೇಕಡಾ ತೊಂಬತ್ತೆಂಟು" in out and "ಎಪಿಎಂಸಿ" in out
    assert not any(c.isdigit() or ("a" <= c.lower() <= "z") for c in out)


@pytest.mark.skipif(not tts_kn.available(), reason="Kannada voice model not installed")
def test_synthesize_wav():
    from scipy.io import wavfile
    sr, audio = wavfile.read(io.BytesIO(tts_kn.synthesize("ನಮಸ್ಕಾರ. ನಿಮ್ಮ ಟೊಮೆಟೊ ಚೆನ್ನಾಗಿದೆ.")))
    assert sr == 22050 and len(audio) > sr   # more than a second of speech
