import re
import os
import asyncio
import base64
import threading
from io import BytesIO
from edge_tts import communicate


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


# Map voice_id values to Edge TTS voices
VOICE_MAPPING = {
    "JBFqnCBsd6RMkjVDRZzb": "en-US-AriaNeural",  # Female
    "VR6AewLBeTwWjLpvPKcI": "en-US-GuyNeural",   # Male
    "pNInz6obpgDQGcFmaJgB": "en-US-AmberNeural", # Female
    "ErXwobaYiN019PkySvjV": "en-US-EricNeural",  # Male
}


def generate_speech(text: str, voice_id: str = None) -> str:
    """Generate speech using Edge TTS (free, no API key required)"""

    print(f"[TTS] Starting speech generation | text_len={len(text) if text else 0} | voice_id={voice_id}")

    if text is None or not text.strip():
        print("[TTS] Empty text, skipping TTS")
        return None

    # Map voice_id to Edge TTS voice, default to Aria if not found
    edge_voice = VOICE_MAPPING.get(voice_id, "en-US-AriaNeural")
    print(f"[TTS] Mapped voice_id '{voice_id}' → '{edge_voice}'")

    try:
        result = [None]
        error = [None]

        def run_tts():
            try:
                print(f"[TTS] Creating event loop in thread")
                loop = asyncio.new_event_loop()
                asyncio.set_event_loop(loop)
                print(f"[TTS] Calling _generate_audio with voice='{edge_voice}'")
                audio_data = loop.run_until_complete(_generate_audio(text, edge_voice))
                result[0] = audio_data
                print(f"[TTS] Audio generated successfully, size={len(audio_data) if audio_data else 0} bytes")
            except Exception as e:
                print(f"[TTS] ERROR in thread: {type(e).__name__}: {e}")
                error[0] = e
            finally:
                try:
                    loop.close()
                    print("[TTS] Event loop closed")
                except Exception as close_err:
                    print(f"[TTS] Error closing loop: {close_err}")

        thread = threading.Thread(target=run_tts, daemon=True)
        print("[TTS] Starting TTS thread")
        thread.start()
        thread.join(timeout=60)
        print("[TTS] TTS thread completed")

        if error[0]:
            print(f"[TTS] Generation failed with error: {error[0]}")
            return None

        audio_data = result[0]
        if audio_data is None:
            print("[TTS] No audio data returned")
            return None

        print(f"[TTS] Encoding to base64, size={len(audio_data)} bytes")
        audio_base64 = base64.b64encode(audio_data).decode('utf-8')
        audio_url = f"data:audio/mp3;base64,{audio_base64}"
        print(f"[TTS] Success! Generated data URL of {len(audio_url)} chars")
        return audio_url

    except Exception as e:
        print(f"[TTS] Outer exception: {type(e).__name__}: {e}")
        return None


async def _generate_audio(text: str, voice: str) -> bytes:
    """Helper function to generate audio asynchronously"""
    try:
        print(f"[TTS-Async] Creating Communicate instance with voice='{voice}'")
        communicate_instance = communicate.Communicate(text, voice=voice, rate="+0%")
        audio_buffer = BytesIO()

        print(f"[TTS-Async] Streaming audio chunks...")
        chunk_count = 0
        async for chunk in communicate_instance.stream():
            if chunk["type"] == "audio":
                audio_buffer.write(chunk["data"])
                chunk_count += 1

        print(f"[TTS-Async] Received {chunk_count} audio chunks")
        audio_buffer.seek(0)
        result = audio_buffer.read()
        print(f"[TTS-Async] Total audio bytes: {len(result)}")
        return result
    except Exception as e:
        print(f"[TTS-Async] ERROR: {type(e).__name__}: {e}")
        return None


