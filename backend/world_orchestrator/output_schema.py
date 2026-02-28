from pydantic import BaseModel, Field, field_validator
from typing import Optional, Literal


# ── Per-action-type models ──


class SpawnNPCAction(BaseModel):
    action: Literal["spawn_npc"]
    npc_type: str
    location: str
    mood: str
    count: int = 1
    reason: str = ""


class RemoveNPCAction(BaseModel):
    action: Literal["remove_npc"]
    npc_id: str
    npc_type: Optional[str] = None
    reason: str = ""


class ChangeWeatherAction(BaseModel):
    action: Literal["change_weather"]
    condition: Literal[
        "clear", "cloudy", "rain", "heavy_rain",
        "fog", "thunderstorm", "blizzard", "heatwave",
    ]
    transition: Literal["instant", "gradual"] = "gradual"
    reason: str = ""


class TriggerEventAction(BaseModel):
    action: Literal["trigger_event"]
    event_name: str
    location: str
    intensity: Literal["low", "medium", "high"] = "medium"
    reason: str = ""


class UpdateTensionAction(BaseModel):
    action: Literal["update_tension"]
    level: int = Field(ge=0, le=10)
    delta: Optional[int] = None
    reason: str = ""


class SpawnVehicleAction(BaseModel):
    action: Literal["spawn_vehicle"]
    vehicle_type: str
    location: str
    behavior: Literal["parked", "patrolling", "fleeing", "chasing"] = "parked"
    count: int = 1
    reason: str = ""


class SendToNPCAction(BaseModel):
    action: Literal["send_to_npc"]
    npc_id: str
    npc_type: Optional[str] = None
    instruction: str
    dialogue: Optional[str] = None
    reason: str = ""


# ── Mapping from action name string to model class ──

ACTION_MODEL_MAP: dict[str, type[BaseModel]] = {
    "spawn_npc": SpawnNPCAction,
    "remove_npc": RemoveNPCAction,
    "change_weather": ChangeWeatherAction,
    "trigger_event": TriggerEventAction,
    "update_tension": UpdateTensionAction,
    "spawn_vehicle": SpawnVehicleAction,
    "send_to_npc": SendToNPCAction,
}

VALID_ACTION_NAMES = set(ACTION_MODEL_MAP.keys())


def validate_action(action_dict: dict) -> BaseModel:
    """
    Validate a single action dict against the correct Pydantic model.
    Raises ValueError with a descriptive message on failure.
    """
    action_name = action_dict.get("action")
    if not action_name:
        raise ValueError(f"Action missing 'action' field: {action_dict}")
    if action_name not in ACTION_MODEL_MAP:
        raise ValueError(
            f"Unknown action type '{action_name}'. "
            f"Valid types: {sorted(VALID_ACTION_NAMES)}"
        )
    model_cls = ACTION_MODEL_MAP[action_name]
    return model_cls(**action_dict)


# ── Top-level output model ──


class OrchestratorOutput(BaseModel):
    actions: list[dict] = Field(default_factory=list)
    narrator: str = Field(default="")

    @field_validator("actions")
    @classmethod
    def validate_actions(cls, v: list[dict]) -> list[dict]:
        if len(v) > 5:
            raise ValueError(f"Too many actions ({len(v)}). Maximum is 5.")
        errors = []
        for i, action_dict in enumerate(v):
            try:
                validate_action(action_dict)
            except (ValueError, Exception) as e:
                errors.append(f"Action [{i}]: {e}")
        if errors:
            raise ValueError("Action validation failed:\n" + "\n".join(errors))
        return v

    @field_validator("narrator")
    @classmethod
    def validate_narrator(cls, v: str) -> str:
        if not v or not v.strip():
            raise ValueError("Narrator text must not be empty.")
        return v.strip()
