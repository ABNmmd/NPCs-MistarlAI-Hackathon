from langgraph.graph import StateGraph, START, END
from .state import WorldOrchestratorState
from .nodes import NodeExecutor


def _route_after_validation(state: WorldOrchestratorState) -> str:
    """
    Conditional edge function after validate_output:
      - VALID    -> dispatch_npc_actions
      - FALLBACK -> dispatch_npc_actions (return safe defaults)
      - INVALID  -> generate_actions (retry)
    """
    status = state.get("validation_status", "INVALID")
    if status in ("VALID", "FALLBACK"):
        return "dispatch_npc_actions"
    return "generate_actions"


def create_world_graph(
    provider: str = None,
    model: str = None,
    temperature: float = 0.8,
):
    """
    Build and compile the World Orchestrator LangGraph.

    Args:
        provider:    "groq" or "mistral" (default from WORLD_LLM_PROVIDER env var, fallback "groq")
        model:       Model name (default from WORLD_LLM_MODEL env var, fallback per provider)
        temperature: LLM temperature (default 0.8)

    Graph flow:
        START -> normalize_input -> generate_actions -> validate_output
                                        ^                    |
                                        |                    v
                                        +--- (INVALID) -----+
                                                             |
                                        (VALID/FALLBACK) ----+-> dispatch_npc_actions -> END
    """
    executor = NodeExecutor(provider=provider, model=model, temperature=temperature)

    graph = StateGraph(WorldOrchestratorState)

    graph.add_node("normalize_input", executor.normalize_input)
    graph.add_node("generate_actions", executor.generate_actions)
    graph.add_node("validate_output", executor.validate_output)
    graph.add_node("dispatch_npc_actions", executor.dispatch_npc_actions)

    graph.add_edge(START, "normalize_input")
    graph.add_edge("normalize_input", "generate_actions")
    graph.add_edge("generate_actions", "validate_output")

    graph.add_conditional_edges(
        "validate_output",
        _route_after_validation,
        {
            "dispatch_npc_actions": "dispatch_npc_actions",
            "generate_actions": "generate_actions",
        },
    )

    graph.add_edge("dispatch_npc_actions", END)

    return graph.compile()
