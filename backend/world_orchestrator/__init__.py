import traceback
from .graph import create_world_graph
from .state import WorldOrchestratorState
from .output_schema import OrchestratorOutput


async def call_orchestrator(world_state: dict, recent_events: list) -> dict:
    """
    One-shot convenience wrapper around the LangGraph workflow.
    Returns {"actions": [...], "narrator": "...", "npc_directives": [...]}.
    """
    print(f"[WO] call_orchestrator started | events_count={len(recent_events)}")
    try:
        graph = create_world_graph()
        result = await graph.ainvoke({
            "world_state": world_state,
            "recent_events": recent_events,
        })
        actions = result.get("actions", [])
        npc_directives = result.get("npc_directives", [])
        validation_status = result.get("validation_status", "VALID")
        print(f"[WO] call_orchestrator done | actions={len(actions)} | npc_directives={len(npc_directives)} | status={validation_status}")
        return {
            "actions": actions,
            "narrator": result.get("narrator", ""),
            "npc_directives": npc_directives,
            "validation_status": validation_status,
        }
    except Exception as e:
        print(f"[WO] call_orchestrator ERROR: {type(e).__name__}: {e}")
        print(traceback.format_exc())
        raise


__all__ = [
    "create_world_graph",
    "call_orchestrator",
    "WorldOrchestratorState",
    "OrchestratorOutput",
]
