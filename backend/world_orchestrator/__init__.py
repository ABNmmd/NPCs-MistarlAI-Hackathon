from .graph import create_world_graph
from .state import WorldOrchestratorState
from .output_schema import OrchestratorOutput


async def call_orchestrator(world_state: dict, recent_events: list) -> dict:
    """
    One-shot convenience wrapper around the LangGraph workflow.
    Returns {"actions": [...], "narrator": "...", "npc_directives": [...]}.
    """
    graph = create_world_graph()
    result = await graph.ainvoke({
        "world_state": world_state,
        "recent_events": recent_events,
    })
    return {
        "actions": result.get("actions", []),
        "narrator": result.get("narrator", ""),
        "npc_directives": result.get("npc_directives", []),
        "validation_status": result.get("validation_status", "VALID"),
    }


__all__ = [
    "create_world_graph",
    "call_orchestrator",
    "WorldOrchestratorState",
    "OrchestratorOutput",
]
