import json

from langchain_core.messages import SystemMessage, HumanMessage, AIMessage

from .state import WorldOrchestratorState
from .llm import get_llm, _extract_json
from .output_schema import OrchestratorOutput
from .prompts import SYSTEM_PROMPT, RETRY_PROMPT


class NodeExecutor:
    """Stateless executor — each method is a LangGraph node function."""

    def __init__(self, provider: str = None, model: str = None, temperature: float = 0.8):
        self.llm = get_llm(provider=provider, model=model, temperature=temperature)

    # ── Node 1: normalize_input (sync, no LLM) ──

    def normalize_input(self, state: WorldOrchestratorState) -> dict:
        """
        Fill defaults in world_state, convert event dicts to strings,
        build the formatted user message. Sets retry_count to 0.
        """
        defaults = {
            "player_karma": 0,
            "active_npcs": [],
            "weather": "clear",
            "time_of_day": "noon",
            "tension_level": 0,
            "active_events": [],
            "recent_player_actions": [],
        }
        normalized_ws = {**defaults, **state["world_state"]}

        normalized_events: list[str] = []
        for event in state.get("recent_events", []):
            if isinstance(event, dict):
                action = event.get("action", "")
                source = event.get("source", "")
                if source and action:
                    normalized_events.append(f"{source}: {action}")
                elif action:
                    normalized_events.append(action)
                else:
                    normalized_events.append(str(event))
            else:
                normalized_events.append(str(event))

        payload = {
            "world_state": normalized_ws,
            "recent_events": normalized_events,
        }
        user_message = (
            "Current world snapshot:\n"
            + json.dumps(payload, indent=2)
            + "\n\nDirector, what happens next?"
        )

        return {
            "normalized_world_state": normalized_ws,
            "normalized_recent_events": normalized_events,
            "user_message": user_message,
            "retry_count": 0,
            "validation_status": "",
            "validation_error": None,
            "raw_response": "",
            "actions": [],
            "narrator": "",
            "npc_directives": [],
        }

    # ── Node 2: generate_actions (async, calls Groq via LangChain) ──

    async def generate_actions(self, state: WorldOrchestratorState) -> dict:
        """
        Call Groq LLM with the system prompt via LangChain.
        On retry, append the prior raw response + error so the model
        sees what went wrong and can correct it.
        """
        messages = [
            SystemMessage(content=SYSTEM_PROMPT),
            HumanMessage(content=state["user_message"]),
        ]

        if state.get("retry_count", 0) > 0 and state.get("validation_error"):
            messages.append(AIMessage(content=state.get("raw_response", "")))
            messages.append(HumanMessage(content=RETRY_PROMPT.format(
                validation_error=state["validation_error"]
            )))

        response = await self.llm.ainvoke(messages)
        raw_content = response.content

        try:
            parsed = _extract_json(raw_content)
        except ValueError:
            return {
                "raw_response": raw_content,
                "actions": [],
                "narrator": "",
            }

        return {
            "raw_response": raw_content,
            "actions": parsed.get("actions", []),
            "narrator": parsed.get("narrator", ""),
        }

    # ── Node 3: validate_output (sync, no LLM) ──

    def validate_output(self, state: WorldOrchestratorState) -> dict:
        """
        Validate the parsed actions + narrator using Pydantic.
        Sets validation_status to VALID, INVALID, or FALLBACK.
        """
        try:
            OrchestratorOutput(
                actions=state.get("actions", []),
                narrator=state.get("narrator", ""),
            )
            return {
                "validation_status": "VALID",
                "validation_error": None,
            }
        except Exception as e:
            new_retry_count = state.get("retry_count", 0) + 1
            if new_retry_count >= 3:
                return {
                    "validation_status": "FALLBACK",
                    "validation_error": str(e),
                    "retry_count": new_retry_count,
                    "actions": [],
                    "narrator": "The world holds its breath, waiting.",
                }
            return {
                "validation_status": "INVALID",
                "validation_error": str(e),
                "retry_count": new_retry_count,
            }

    # ── Node 4: dispatch_npc_actions (sync, no LLM) ──

    def dispatch_npc_actions(self, state: WorldOrchestratorState) -> dict:
        """
        Separate send_to_npc actions from the actions list.
        - npc_directives: list of send_to_npc action dicts
        - actions: remaining non-NPC actions
        """
        npc_directives = []
        other_actions = []

        for action in state.get("actions", []):
            if action.get("action") == "send_to_npc":
                npc_directives.append(action)
            else:
                other_actions.append(action)

        return {
            "actions": other_actions,
            "npc_directives": npc_directives,
        }
