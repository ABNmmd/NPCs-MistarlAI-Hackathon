from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Dict, Any
from ..npc import create_npc_graph, NPCState, Memory, Event, NPCResponse
from ..npc.tts_service import clean_dialogue, generate_speech

router = APIRouter(prefix="/api/npc", tags=["npc"])


class NPCInputRequest(BaseModel):
    npc_id: str
    npc_identity: str
    voice_id: str = "JBFqnCBsd6RMkjVDRZzb"
    memory: Dict[str, Any]
    trust_score: int
    emotion: str
    world_state: Dict[str, Any]
    recent_events: List[Dict[str, Any]]
    conversation_history: List[Dict[str, Any]] = []


class DialogueCleanTest(BaseModel):
    raw_dialogue: str


@router.post("/react", response_model=NPCResponse)
async def npc_react(request: NPCInputRequest) -> NPCResponse:
    try:
        state = NPCState(
            npc_id=request.npc_id,
            npc_identity=request.npc_identity,
            voice_id=request.voice_id,
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

        raw_dialogue = output.get("dialogue", "")
        cleaned_dialogue = clean_dialogue(raw_dialogue)

        audio_url = generate_speech(cleaned_dialogue, voice_id=output.get("voice_id", request.voice_id))

        return NPCResponse(
            dialogue=cleaned_dialogue,
            emotion=output.get("emotion", "NEUTRAL"),
            trust_score=output.get("trust_score", 5),
            action_trigger=output.get("action_trigger", "NONE"),
            audio_url=audio_url,
        )

    except Exception as e:
        raise HTTPException(status_code=500, detail=f"NPC processing error: {str(e)}")


@router.post("/test-clean-dialogue")
async def test_clean(request: DialogueCleanTest) -> dict:
    cleaned = clean_dialogue(request.raw_dialogue)
    return {
        "raw": request.raw_dialogue,
        "cleaned": cleaned,
        "removed_length": len(request.raw_dialogue) - len(cleaned),
    }


@router.get("/health")
async def health_check():
    return {"status": "healthy", "service": "NPC Brain Agent"}

