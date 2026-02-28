import re
import os
from elevenlabs.client import ElevenLabs


def clean_dialogue(dialogue: str) -> str:
    dialogue = re.sub(r'\s+', ' ', dialogue)

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


def generate_speech(text: str, voice_id: str = None) -> str:
    if voice_id is None:
        voice_id = "JBFqnCBsd6RMkjVDRZzb"

    api_key = os.getenv("ELEVENLABS_API_KEY")
    if not api_key:
        return None

    try:
        client = ElevenLabs(api_key=api_key)

        audio = client.text_to_speech.convert(
            text=text,
            voice_id=voice_id,
            model_id="eleven_multilingual_v2",
            output_format="mp3_44100_128",
        )

        import base64
        audio_bytes = b''.join(audio)
        audio_base64 = base64.b64encode(audio_bytes).decode('utf-8')
        audio_url = f"data:audio/mp3;base64,{audio_base64}"

        return audio_url

    except Exception as e:
        print(f"ElevenLabs TTS error: {e}")
        return None


