import base64
import os
import re
from io import BytesIO
import requests


def clean_dialogue(dialogue: str) -> str:
    dialogue = re.sub(r'\s+', ' ', dialogue)

    # Strip any "Name:" or "NPC:" prefix the LLM might prepend
    dialogue = re.sub(r'^[A-Za-z_\s]{1,30}:\s*', '', dialogue.strip())

    dialogue = re.sub(r'\*[^*]*\*', '', dialogue)

    dialogue = re.sub(r'\([^)]*\)', '', dialogue)

    dialogue = re.sub(r'"([^"]*)"', r'\1', dialogue)

    gesture_patterns = [
        r'\bsmiling\b',
        r'\blaughing\b',
        r'\bcoughing\b',
        r'\bwinking\b',
        r'\bnodding\b',
        r'\bshaking\s+(?:head|my\s+head)\b',
        r'\beyes?\s+(?:lightin?\s+up|widening|closing|contact)\b',
        r'\badjusting\s+\w+(?:\s+\w+)?\b',
        r'\bpausing\s+(?:for\s+effect)?\b',
        r'\bclears?\s+(?:throat|voice)\b',
        r'\bgesturing\b',
        r'\bpointing\b',
        r'\btaps?\s+(?:fingers|foot|chest)\b',
        r'\braises?\s+(?:hand|eyebrow)\b',
        r'\bfrowning\b',
        r'\bsmirking\b',
        r'\bgrinning\b',
        r'\bcrossing\s+arms\b',
        r'\bhugging\b',
        r'\bstamping\s+foot\b',
        r'\bpacing\b',
        r'\bchuckles?\b',
        r'\btone\b',
        r'\bnerve\b',
        r'\bcurious\b',
    ]

    cleaned = dialogue
    for pattern in gesture_patterns:
        cleaned = re.sub(pattern, '', cleaned, flags=re.IGNORECASE)

    cleaned = re.sub(r'\s+', ' ', cleaned).strip()

    return cleaned


def _resolve_deepgram_model(voice_id: str | None) -> str:
    """
    Resolve which Deepgram TTS model to use.

    Priority:
      1) If voice_id already looks like a Deepgram Aura model (starts with "aura"), use it.
      2) Map known legacy voice_ids (e.g., ElevenLabs ids) to Aura models.
      3) DEEPGRAM_TTS_MODEL env.
      4) Default fallback.
    """

    if voice_id and voice_id.lower().startswith("aura"):
        return voice_id

    legacy_map = {
        # ElevenLabs common ids → map to Aura with gender-consistent voices
        "JBFqnCBsd6RMkjVDRZzb": "aura-asteria-en",   # female
        "VR6AewLBeTwWjLpvPKcI": "aura-zeus-en",      # male
        "pNInz6obpgDQGcFmaJgB": "aura-orpheus-en",   # neutral
        "ErXwobaYiN019PkySvjV": "aura-orpheus-en",   # neutral/male-ish
    }
    if voice_id and voice_id in legacy_map:
        return legacy_map[voice_id]

    env_model = os.getenv("DEEPGRAM_TTS_MODEL")
    if env_model:
        return env_model

    return "aura-asteria-en"


def generate_speech(text: str, voice_id: str = None) -> str:
    """Generate speech using Deepgram Aura (Aura-2 family) via REST Speak API."""

    print(f"[TTS] Starting speech generation | text_len={len(text) if text else 0} | voice_id={voice_id}")

    if text is None or not text.strip():
        print("[TTS] Empty text, skipping TTS")
        return None

    api_key = os.getenv("DEEPGRAM_API_KEY")
    if not api_key:
        print("[TTS] DEEPGRAM_API_KEY missing; cannot generate speech")
        return None

    model = _resolve_deepgram_model(voice_id)
    url = f"https://api.deepgram.com/v1/speak?model={model}&encoding=mp3"

    try:
        resp = requests.post(
            url,
            headers={
                "Authorization": f"Token {api_key}",
                "Content-Type": "application/json",
                "Accept": "audio/mpeg",
            },
            json={"text": text},
            timeout=30,
        )

        if resp.status_code != 200:
            print(f"[TTS] Deepgram error {resp.status_code}: {resp.text[:200]}")
            return None

        audio_bytes = resp.content
        print(f"[TTS] Received {len(audio_bytes)} bytes from Deepgram")

        audio_base64 = base64.b64encode(audio_bytes).decode("utf-8")
        audio_url = f"data:audio/mp3;base64,{audio_base64}"
        return audio_url

    except Exception as e:
        print(f"[TTS] ERROR calling Deepgram: {type(e).__name__}: {e}")
        return None


