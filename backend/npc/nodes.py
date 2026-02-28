import os
from langchain_ollama import ChatOllama
from langchain_core.output_parsers import StrOutputParser, JsonOutputParser
from .state import NPCState, Memory, Event
from .trigger_system import TriggerSystem
from .output_schema import NPCResponse
from .prompts import (
    SYSTEM_PERCEIVE,
    SYSTEM_EVALUATE_CONSCIOUSNESS,
    SYSTEM_GENERATE_RESPONSE,
    SYSTEM_VALIDATE,
)
from datetime import datetime
from typing import Optional
import json


class NodeExecutor:
    def __init__(self, llm_model: str = None, temperature: float = 0.7):
        provider = os.getenv("LLM_PROVIDER", "ollama").lower()
        llm_model = llm_model or os.getenv("LLM_MODEL", "llama2")

        if provider == "openai":
            self.llm = ChatOpenAI(model=llm_model, temperature=temperature)
        elif provider == "ollama":
            base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
            self.llm = ChatOllama(model=llm_model, base_url=base_url, temperature=temperature)
        else:
            raise ValueError(f"Unknown LLM provider: {provider}")

        self.trigger_system = TriggerSystem()

    def node_perceive(self, state: NPCState) -> dict:
        player_action = state["recent_events"][-1]["action"] if state["recent_events"] else "unknown"

        prompt = f"""{SYSTEM_PERCEIVE}

Player Input: {player_action}
Context: NPC {state['npc_id']} processing input."""

        response = self.llm.invoke(prompt)
        perceived_intent = response.content

        triggers = self.trigger_system.get_all_triggers(player_action)

        new_history = state["conversation_history"].copy()
        new_history.append({
            "role": "player",
            "action": player_action,
            "timestamp": datetime.now().isoformat(),
            "perceived_intent": perceived_intent,
            "triggers": triggers,
        })

        return {
            "conversation_history": new_history,
            "recent_events": state["recent_events"],
        }

    def node_evaluate_consciousness(self, state: NPCState) -> dict:
        player_action = state["conversation_history"][-1]["action"]
        triggers = state["conversation_history"][-1].get("triggers", {})

        memory = state["memory"]
        recent_history = "\n".join(memory.get("relationship_history", [])[-5:])

        prompt = SYSTEM_EVALUATE_CONSCIOUSNESS.format(
            trust_score=state["trust_score"],
            emotion=state["emotion"],
            persona=state["npc_identity"],
            player_action=player_action,
            recent_events=", ".join([e["action"] for e in state["recent_events"][-3:]]),
            memory=memory["long_term_summary"],
        )

        response = self.llm.invoke(prompt)
        reasoning = response.content

        lm_trust_delta = 0
        if "trust" in reasoning.lower():
            if "+1" in reasoning or "+2" in reasoning or "increase" in reasoning.lower():
                lm_trust_delta = 1
            elif "-1" in reasoning or "-2" in reasoning or "decrease" in reasoning.lower():
                lm_trust_delta = -1

        emotion_trigger = triggers.get("emotion_trigger")
        if emotion_trigger:
            new_emotion = emotion_trigger["emotion"]
            trust_delta = emotion_trigger["trust_delta"]
        else:
            new_emotion = state["emotion"]
            trust_delta = lm_trust_delta

        new_trust = max(0, min(10, state["trust_score"] + trust_delta))

        return {
            "trust_score": new_trust,
            "emotion": new_emotion,
            "internal_reasoning": reasoning,
        }

    def node_update_memory(self, state: NPCState) -> dict:
        memory = state["memory"]
        player_action = state["conversation_history"][-1]["action"]

        short_term = memory.get("short_term", [])
        short_term.append(f"[Trust: {state['trust_score']}/10] {player_action}")
        short_term = short_term[-10:]

        relationship_history = memory.get("relationship_history", [])
        if state["emotion"] != "NEUTRAL" or state["trust_score"] != 5:
            relationship_history.append(
                f"Action: {player_action} | Emotion: {state['emotion']} | Trust: {state['trust_score']}/10"
            )
            relationship_history = relationship_history[-10:]

        updated_memory: Memory = {
            "short_term": short_term,
            "long_term_summary": memory.get("long_term_summary", ""),
            "relationship_history": relationship_history,
        }

        return {"memory": updated_memory}

    def node_generate_response(self, state: NPCState) -> dict:
        player_action = state["conversation_history"][-1]["action"]
        memory = state["memory"]
        recent_history = "\n".join(memory.get("relationship_history", [])[-3:])

        prompt = SYSTEM_GENERATE_RESPONSE.format(
            persona=state["npc_identity"],
            trust_score=state["trust_score"],
            emotion=state["emotion"],
            relationship_history=recent_history,
            player_action=player_action,
        )

        response = self.llm.invoke(prompt)
        dialogue = response.content

        action_trigger = state["conversation_history"][-1]["triggers"].get("action_trigger", "NONE")

        return {
            "dialogue": dialogue,
            "action_trigger": action_trigger or "NONE",
        }

    def node_validate_output(self, state: NPCState) -> dict:
        try:
            output = NPCResponse(
                dialogue=state["dialogue"],
                emotion=state["emotion"],
                trust_score=state["trust_score"],
                action_trigger=state["action_trigger"],
                audio_url=None,
            )
            return {"validation_status": "VALID", "output": output.model_dump()}
        except Exception as e:
            return {"validation_status": "INVALID", "error": str(e)}
