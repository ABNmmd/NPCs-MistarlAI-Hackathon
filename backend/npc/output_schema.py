from pydantic import BaseModel, Field
from typing import Optional


class NPCResponse(BaseModel):
    dialogue: str = Field(..., description="NPC dialogue response to the player (cleaned of gestures)")
    emotion: str = Field(..., description="Current emotion state (ANGRY, HAPPY, NEUTRAL, SUSPICIOUS, GRATEFUL, SAD, CONFUSED, EXCITED)")
    trust_score: int = Field(..., ge=0, le=10, description="Trust score from 0-10")
    action_trigger: str = Field(default="NONE", description="Action trigger (ATTACK, PUNCH, WALK_AWAY, GIVE_ITEM, NONE, etc)")
    audio_url: Optional[str] = Field(default=None, description="ElevenLabs TTS audio URL")

    class Config:
        json_schema_extra = {
            "example": {
                "dialogue": "Ah, thank ye kindly for bringin' me that gift! I'm glad ye thought o' me. It's been a while since anyone's brought me somethin', so this is quite gratifyin'. Trust level still at 7/10, mind ye? Can't be too careful in these parts. How've ye been doin' lately?",
                "emotion": "GRATEFUL",
                "trust_score": 7,
                "action_trigger": "NONE",
                "audio_url": "https://api.elevenlabs.io/v1/text-to-speech/..."
            }
        }
