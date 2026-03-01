from typing import TypedDict, Optional
from datetime import datetime


class Event(TypedDict):
    source: str
    action: str
    time: int


class Memory(TypedDict):
    short_term: list[str]
    long_term_summary: str
    relationship_history: list[str]


class NPCState(TypedDict):
    npc_id: str
    npc_identity: str
    voice_id: Optional[str]
    memory: Memory
    trust_score: int
    emotion: str
    world_state: dict
    recent_events: list[Event]
    conversation_history: list[dict]
    internal_reasoning: Optional[str]
    dialogue: Optional[str]
    action_trigger: Optional[str]
