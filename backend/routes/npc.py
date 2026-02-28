from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any
from ..npc import create_npc_graph, NPCState, Memory, Event, NPCResponse

router = APIRouter(prefix="/api/npc", tags=["npc"])


class NPCInputRequest(BaseModel):
    npc_id: str
    npc_identity: str
    memory: Dict[str, Any]
    trust_score: int
    emotion: str
    world_state: Dict[str, Any]
    recent_events: List[Dict[str, Any]]
    conversation_history: List[Dict[str, Any]] = []


@router.post("/react", response_model=NPCResponse)
async def npc_react(request: NPCInputRequest) -> NPCResponse:
    try:
        state = NPCState(
            npc_id=request.npc_id,
            npc_identity=request.npc_identity,
            memory=Memory(**request.memory),
            trust_score=request.trust_score,
            emotion=request.emotion,
            world_state=request.world_state,
            recent_events=[Event(**event) for event in request.recent_events],
            conversation_history=request.conversation_history,
            internal_reasoning=None,
            dialogue=None,
            action_trigger=None,
        )

        graph = create_npc_graph()
        output = graph.invoke(state, config={"configurable": {"thread_id": request.npc_id}})

        return NPCResponse(
            dialogue=output.get("dialogue", ""),
            emotion=output.get("emotion", "NEUTRAL"),
            trust_score=output.get("trust_score", 5),
            action_trigger=output.get("action_trigger", "NONE"),
            audio_url=None,
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"NPC processing error: {str(e)}")


@router.get("/health")
async def health_check():
    return {"status": "healthy", "service": "NPC Brain Agent"}
