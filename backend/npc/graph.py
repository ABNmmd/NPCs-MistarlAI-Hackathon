from langgraph.graph import StateGraph, START, END
from .state import NPCState
from .nodes import NodeExecutor


def _build_npc_graph(temperature: float = 0.7):
    """Build and compile the NPC graph. Called once at module load."""
    executor = NodeExecutor(temperature=temperature)

    graph = StateGraph(NPCState)

    graph.add_node("perceive", executor.node_perceive)
    graph.add_node("evaluate_consciousness", executor.node_evaluate_consciousness)
    graph.add_node("update_memory", executor.node_update_memory)
    graph.add_node("generate_response", executor.node_generate_response)
    graph.add_node("validate_output", executor.node_validate_output)

    graph.add_edge(START, "perceive")
    graph.add_edge("perceive", "evaluate_consciousness")
    graph.add_edge("evaluate_consciousness", "update_memory")
    graph.add_edge("update_memory", "generate_response")
    graph.add_edge("generate_response", "validate_output")
    graph.add_edge("validate_output", END)

    # No checkpointer — the frontend is the source of truth for all NPC state
    # (trust, emotion, memory, conversation_history). Using MemorySaver caused
    # conversation_history to accumulate/duplicate across invocations because
    # LangGraph's default list reducer appends rather than overwrites.
    compiled_graph = graph.compile()

    return compiled_graph


# ── Module-level singleton ──────────────────────────────────────────────────
# Each invocation is stateless — the frontend sends the full NPC state every call.
print("[NPC-Graph] Building singleton NPC graph...")
npc_graph = _build_npc_graph()
print("[NPC-Graph] Singleton NPC graph ready.")


def create_npc_graph(temperature: float = 0.7):
    """Backward-compatible wrapper — returns the module-level singleton."""
    return npc_graph
