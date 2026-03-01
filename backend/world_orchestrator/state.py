from typing import TypedDict, Optional


class WorldOrchestratorState(TypedDict):
    # ── Inputs (provided by caller) ──
    world_state: dict
    recent_events: list

    # ── Normalized (filled by normalize_input node) ──
    normalized_world_state: dict
    normalized_recent_events: list[str]
    user_message: str

    # ── LLM output ──
    raw_response: str
    actions: list[dict]
    narrator: str

    # ── NPC integration ──
    npc_directives: list[dict]

    # ── Validation / retry ──
    validation_status: str
    validation_error: Optional[str]
    retry_count: int
