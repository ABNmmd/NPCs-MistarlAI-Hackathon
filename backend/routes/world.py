from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field
from typing import List, Dict, Any, Optional

from ..world_orchestrator import call_orchestrator
from ..npc import create_npc_graph, NPCState, Memory, Event, NPCResponse
from ..npc.tts_service import clean_dialogue, generate_speech

router = APIRouter(prefix="/api/world", tags=["world"])


# ── Request / Response Models ──


class OrchestrateRequest(BaseModel):
    world_state: Dict[str, Any] = Field(
        default_factory=dict,
        description="Current world state (player_karma, weather, tension_level, etc.)",
    )
    recent_events: List[Any] = Field(
        default_factory=list,
        description="Recent event strings or {source, action, time} objects",
    )


class OrchestratorResponse(BaseModel):
    actions: List[Dict[str, Any]]
    narrator: str
    npc_directives: List[Dict[str, Any]]
    validation_status: str


class NPCDirectiveResult(BaseModel):
    npc_id: str
    event: str
    dialogue: Optional[str] = None
    emotion: Optional[str] = None
    trust_score: Optional[int] = None
    action_trigger: Optional[str] = None
    audio_url: Optional[str] = None
    error: Optional[str] = None


class TickRequest(BaseModel):
    world_state: Dict[str, Any] = Field(
        default_factory=dict,
        description="Current world state",
    )
    recent_events: List[Any] = Field(
        default_factory=list,
        description="Recent events",
    )
    active_npcs: Dict[str, Dict[str, Any]] = Field(
        default_factory=dict,
        description="Map of npc_id -> NPC data (npc_identity, voice_id, memory, trust_score, emotion, etc.)",
    )


class TickResponse(BaseModel):
    actions: List[Dict[str, Any]]
    narrator: str
    npc_directives: List[Dict[str, Any]]
    npc_responses: List[NPCDirectiveResult]
    validation_status: str


# ── Routes ──


@router.post("/orchestrate", response_model=OrchestratorResponse)
async def orchestrate(request: OrchestrateRequest) -> OrchestratorResponse:
    """Run the world orchestrator and return actions + narrator + npc_directives."""
    try:
        result = await call_orchestrator(
            request.world_state,
            request.recent_events,
        )
        return OrchestratorResponse(**result)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Orchestrator error: {str(e)}")


def _build_npc_world_state(world_state: dict, npc_data: dict) -> dict:
    """
    Build a world_state dict shaped for the NPC agent.

    The NPC expects a lightweight dict (e.g. {"location": "marketplace"}).
    We keep the NPC's location front-and-center and add useful world context
    (weather, time, tension) without dumping the full orchestrator blob
    (player_karma, active_npcs list, etc.) which is irrelevant to individual NPCs.
    """
    return {
        "location": npc_data.get("location", world_state.get("location", "unknown")),
        "weather": world_state.get("weather", "clear"),
        "time_of_day": world_state.get("time_of_day", "noon"),
        "tension_level": world_state.get("tension_level", 0),
    }


@router.post("/tick", response_model=TickResponse)
async def world_tick(request: TickRequest) -> TickResponse:
    """
    Full world tick: run the orchestrator, then feed any npc_directives
    into the NPC agent as events. Each NPC independently decides its own
    reaction, dialogue, and actions.
    """
    try:
        result = await call_orchestrator(
            request.world_state,
            request.recent_events,
        )
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Orchestrator error: {str(e)}")

    npc_responses: list[NPCDirectiveResult] = []
    directives = result.get("npc_directives", [])

    if directives:
        graph = create_npc_graph()

    for directive in directives:
        npc_id = directive.get("npc_id", "")
        event_text = directive.get("event", "")

        if npc_id == "all":
            npc_type_filter = directive.get("npc_type", "")
            matching_ids = [
                k for k, v in request.active_npcs.items()
                if not npc_type_filter or v.get("type", "") == npc_type_filter
            ]
        else:
            matching_ids = [npc_id] if npc_id in request.active_npcs else []

        for target_id in matching_ids:
            npc_data = request.active_npcs.get(target_id)
            if not npc_data:
                npc_responses.append(NPCDirectiveResult(
                    npc_id=target_id,
                    event=event_text,
                    error=f"NPC {target_id} not found in active_npcs",
                ))
                continue

            try:
                directive_event = Event(
                    source="world_orchestrator",
                    action=event_text,
                    time=0,
                )

                memory_data = npc_data.get("memory", {
                    "short_term": [],
                    "long_term_summary": "",
                    "relationship_history": [],
                })

                state = NPCState(
                    npc_id=target_id,
                    npc_identity=npc_data.get("npc_identity", "A generic NPC"),
                    voice_id=npc_data.get("voice_id"),
                    memory=Memory(**memory_data),
                    trust_score=npc_data.get("trust_score", 5),
                    emotion=npc_data.get("emotion", "NEUTRAL"),
                    world_state=_build_npc_world_state(request.world_state, npc_data),
                    recent_events=[directive_event],
                    conversation_history=npc_data.get("conversation_history", []),
                    internal_reasoning=None,
                    dialogue=None,
                    action_trigger=None,
                )

                output = graph.invoke(state, config={"configurable": {"thread_id": target_id}})

                raw_dialogue = output.get("dialogue", "")
                cleaned_dialogue = clean_dialogue(raw_dialogue)
                voice = output.get("voice_id") or npc_data.get("voice_id")
                audio_url = generate_speech(cleaned_dialogue, voice_id=voice)

                npc_responses.append(NPCDirectiveResult(
                    npc_id=target_id,
                    event=event_text,
                    dialogue=cleaned_dialogue,
                    emotion=output.get("emotion", "NEUTRAL"),
                    trust_score=output.get("trust_score", 5),
                    action_trigger=output.get("action_trigger", "NONE"),
                    audio_url=audio_url,
                ))

            except Exception as e:
                npc_responses.append(NPCDirectiveResult(
                    npc_id=target_id,
                    event=event_text,
                    error=f"NPC processing error: {str(e)}",
                ))

    return TickResponse(
        actions=result.get("actions", []),
        narrator=result.get("narrator", ""),
        npc_directives=result.get("npc_directives", []),
        npc_responses=npc_responses,
        validation_status=result.get("validation_status", "VALID"),
    )


@router.get("/health")
async def health_check():
    return {"status": "healthy", "service": "World Orchestrator"}
