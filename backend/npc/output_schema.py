from pydantic import BaseModel, Field
from typing import Optional


class NPCResponse(BaseModel):
    dialogue: str = Field(..., description="NPC dialogue response to the player")
    emotion: str = Field(..., description="Current emotion state (ANGRY, HAPPY, NEUTRAL, SUSPICIOUS, GRATEFUL, SAD, CONFUSED, EXCITED)")
    trust_score: int = Field(..., ge=0, le=10, description="Trust score from 0-10")
    action_trigger: str = Field(default="NONE", description="Action trigger (ATTACK, PUNCH, WALK_AWAY, GIVE_ITEM, NONE, etc)")
    audio_url: Optional[str] = Field(default=None, description="Placeholder for TTS audio URL")

    class Config:
        json_schema_extra = {
            "example": {
                "dialogue": "I appreciate you helping me.",
                "emotion": "GRATEFUL",
                "trust_score": 7,
                "action_trigger": "NONE",
                "audio_url": None
            }
        }
