import os
import traceback
import urllib.request
import re
from langchain_ollama import ChatOllama
from langchain_core.output_parsers import StrOutputParser, JsonOutputParser
from .state import NPCState, Memory, Event
from .trigger_system import TriggerSystem
from .output_schema import NPCResponse
from .prompts import (
    SYSTEM_EVALUATE_CONSCIOUSNESS,
    SYSTEM_GENERATE_RESPONSE,
    SYSTEM_VALIDATE,
)
from datetime import datetime
from typing import Optional
import json


def _trim_dialogue(text: str, max_sentences: int = 2, max_chars: int = 240) -> str:
    """Constrain dialogue to a few sentences and length to keep replies short."""
    if not text:
        return ""
    # Split on sentence enders while preserving order
    parts = re.split(r'(?<=[.!?])\s+', text.strip())
    trimmed = " ".join(parts[:max_sentences]).strip()
    if len(trimmed) > max_chars:
        trimmed = trimmed[: max_chars - 1].rstrip() + "…"
    return trimmed


def _is_ollama_available(base_url: str) -> bool:
    """Quick HTTP check to see if Ollama is running."""
    try:
        with urllib.request.urlopen(f"{base_url}/api/tags", timeout=3) as resp:
            return resp.status == 200
    except Exception as e:
        print(f"[NPC-Init] Ollama health check failed: {type(e).__name__}: {e}")
        return False


def _make_groq_llm(model: str, temperature: float):
    """Create a Groq LLM instance using GROQ_API_KEY from env."""
    from langchain_groq import ChatGroq
    api_key = os.getenv("GROQ_API_KEY")
    if not api_key:
        print(f"[NPC-Init] ERROR: GROQ_API_KEY is not set in .env")
        raise EnvironmentError("GROQ_API_KEY is not set. Add it to your .env file.")
    print(f"[NPC-Init] Using Groq | model={model}")
    return ChatGroq(model=model, api_key=api_key, temperature=temperature)


GROQ_DEFAULT_MODEL = "llama-3.3-70b-versatile"


class NodeExecutor:
    def __init__(self, llm_model: str = None, temperature: float = 0.7):
        provider = os.getenv("LLM_PROVIDER", "ollama").lower()
        llm_model = llm_model or os.getenv("LLM_MODEL", "llama2")

        print(f"[NPC-Init] Initializing NodeExecutor | provider={provider} | model={llm_model}")

        if provider == "groq":
            self.llm = _make_groq_llm(
                model=os.getenv("GROQ_MODEL", GROQ_DEFAULT_MODEL),
                temperature=temperature,
            )
        elif provider == "openai":
            from langchain_openai import ChatOpenAI
            self.llm = ChatOpenAI(model=llm_model, temperature=temperature)
        elif provider == "ollama":
            base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
            print(f"[NPC-Init] Checking Ollama availability at {base_url}...")
            if _is_ollama_available(base_url):
                print(f"[NPC-Init] Ollama is available, connecting")
                self.llm = ChatOllama(model=llm_model, base_url=base_url, temperature=temperature)
            else:
                print(f"[NPC-Init] Ollama not reachable at {base_url}, falling back to Groq")
                self.llm = _make_groq_llm(
                    model=os.getenv("GROQ_MODEL", GROQ_DEFAULT_MODEL),
                    temperature=temperature,
                )
        else:
            print(f"[NPC-Init] ERROR: Unknown LLM provider '{provider}'")
            raise ValueError(f"Unknown LLM provider: '{provider}'. Supported: ollama, groq, openai")

        self.trigger_system = TriggerSystem()
        print(f"[NPC-Init] NodeExecutor ready")

    def node_perceive(self, state: NPCState) -> dict:
        npc_id = state.get("npc_id", "unknown")
        print(f"[NPC-Perceive] [{npc_id}] Starting perception node")
        try:
            player_action = state["recent_events"][-1]["action"] if state["recent_events"] else "unknown"
            print(f"[NPC-Perceive] [{npc_id}] Player action: '{player_action}'")

            # Keyword-based trigger detection (no LLM call — saves ~25% of budget)
            triggers = self.trigger_system.get_all_triggers(player_action)
            print(f"[NPC-Perceive] [{npc_id}] Triggers detected: {triggers}")

            new_history = state["conversation_history"].copy()
            new_history.append({
                "role": "player",
                "content": player_action,
                "timestamp": datetime.now().isoformat(),
                "triggers": triggers,
            })

            print(f"[NPC-Perceive] [{npc_id}] Done")
            return {
                "conversation_history": new_history,
                "recent_events": state["recent_events"],
            }
        except Exception as e:
            print(f"[NPC-Perceive] [{npc_id}] ERROR: {type(e).__name__}: {e}")
            print(traceback.format_exc())
            raise

    def node_evaluate_consciousness(self, state: NPCState) -> dict:
        npc_id = state.get("npc_id", "unknown")
        print(f"[NPC-Consciousness] [{npc_id}] Starting consciousness evaluation | trust={state.get('trust_score')} | emotion={state.get('emotion')}")
        try:
            player_action = state["conversation_history"][-1]["content"]
            triggers = state["conversation_history"][-1].get("triggers", {})

            memory = state["memory"]
            recent_history = "\n".join(memory.get("relationship_history", [])[-5:])

            # Build conversation context so the LLM knows what was already said
            conv_history = state.get("conversation_history", [])
            conv_lines = []
            for entry in conv_history[:-1]:  # exclude the latest (already in player_action)
                role = entry.get("role", "unknown")
                content = entry.get("content", "")
                label = "[You said]" if role == "npc" else "[Player said]"
                conv_lines.append(f"{label} {content}")
            conv_history_str = "\n".join(conv_lines[-10:]) if conv_lines else "(conversation just started)"

            prompt = SYSTEM_EVALUATE_CONSCIOUSNESS.format(
                trust_score=state["trust_score"],
                emotion=state["emotion"],
                persona=state["npc_identity"],
                player_action=player_action,
                recent_events=", ".join([e["action"] for e in state["recent_events"][-3:]]),
                memory=memory["long_term_summary"],
                conversation_history=conv_history_str,
            )

            print(f"[NPC-Consciousness] [{npc_id}] Calling LLM...")
            response = self.llm.invoke(prompt)
            reasoning_raw = response.content
            print(f"[NPC-Consciousness] [{npc_id}] LLM response received, len={len(reasoning_raw)}")

            # Parse structured JSON from the LLM response
            lm_trust_delta = 0
            lm_emotion = None
            reasoning = reasoning_raw
            try:
                # Extract JSON even if the LLM wraps it in markdown fences
                json_match = re.search(r'\{[^{}]*\}', reasoning_raw, re.DOTALL)
                if json_match:
                    parsed = json.loads(json_match.group())
                    lm_trust_delta = max(-2, min(2, int(parsed.get("trust_delta", 0))))
                    lm_emotion = parsed.get("emotion")
                    reasoning = parsed.get("reasoning", reasoning_raw)
                    print(f"[NPC-Consciousness] [{npc_id}] Parsed JSON | trust_delta={lm_trust_delta} | emotion={lm_emotion}")
                else:
                    print(f"[NPC-Consciousness] [{npc_id}] No JSON found in LLM response, defaulting trust_delta=0")
            except (json.JSONDecodeError, ValueError, TypeError) as parse_err:
                print(f"[NPC-Consciousness] [{npc_id}] JSON parse failed ({parse_err}), defaulting trust_delta=0")

            emotion_trigger = triggers.get("emotion_trigger")
            if emotion_trigger:
                new_emotion = emotion_trigger["emotion"]
                trust_delta = emotion_trigger["trust_delta"]
                print(f"[NPC-Consciousness] [{npc_id}] Emotion trigger fired: emotion={new_emotion} | trust_delta={trust_delta}")
            else:
                # Use LLM-parsed emotion if available, otherwise keep current
                new_emotion = lm_emotion if lm_emotion else state["emotion"]
                trust_delta = lm_trust_delta

            new_trust = max(0, min(10, state["trust_score"] + trust_delta))
            print(f"[NPC-Consciousness] [{npc_id}] Result: emotion={new_emotion} | trust {state['trust_score']} -> {new_trust}")

            return {
                "trust_score": new_trust,
                "emotion": new_emotion,
                "internal_reasoning": reasoning,
            }
        except Exception as e:
            print(f"[NPC-Consciousness] [{npc_id}] ERROR: {type(e).__name__}: {e}")
            print(traceback.format_exc())
            raise

    def node_update_memory(self, state: NPCState) -> dict:
        npc_id = state.get("npc_id", "unknown")
        print(f"[NPC-Memory] [{npc_id}] Updating memory")
        try:
            memory = state["memory"]
            player_action = state["conversation_history"][-1]["content"]

            short_term = memory.get("short_term", [])
            short_term.append(f"[Trust: {state['trust_score']}/10] {player_action}")

            # ── Long-term summary generation ──────────────────────────────
            long_term_summary = memory.get("long_term_summary", "")
            if len(short_term) >= 8:
                to_summarize = short_term[:-4]
                summary_prompt = (
                    "You are summarizing an NPC's memory of interactions with a player.\n"
                    f"Previous summary: {long_term_summary or 'None yet.'}\n"
                    "New interactions to incorporate:\n"
                    + "\n".join(to_summarize)
                    + "\n\nWrite a concise 2-3 sentence summary of the overall relationship "
                    "and key events. Include trust trends and notable moments. "
                    "Do NOT include any JSON or markdown — just plain sentences."
                )
                try:
                    print(f"[NPC-Memory] [{npc_id}] Generating long-term summary from {len(to_summarize)} entries")
                    response = self.llm.invoke(summary_prompt)
                    long_term_summary = response.content.strip()
                    short_term = short_term[-4:]  # keep only recent entries
                    print(f"[NPC-Memory] [{npc_id}] Summary generated, len={len(long_term_summary)}")
                except Exception as summary_err:
                    print(f"[NPC-Memory] [{npc_id}] Summary generation failed: {summary_err}")

            short_term = short_term[-10:]

            relationship_history = memory.get("relationship_history", [])
            if state["emotion"] != "NEUTRAL" or state["trust_score"] != 5:
                relationship_history.append(
                    f"Action: {player_action} | Emotion: {state['emotion']} | Trust: {state['trust_score']}/10"
                )
                relationship_history = relationship_history[-10:]

            updated_memory: Memory = {
                "short_term": short_term,
                "long_term_summary": long_term_summary,
                "relationship_history": relationship_history,
            }

            print(f"[NPC-Memory] [{npc_id}] Memory updated | short_term_count={len(short_term)} | history_count={len(relationship_history)} | has_summary={bool(long_term_summary)}")
            return {"memory": updated_memory}
        except Exception as e:
            print(f"[NPC-Memory] [{npc_id}] ERROR: {type(e).__name__}: {e}")
            print(traceback.format_exc())
            raise

    def node_generate_response(self, state: NPCState) -> dict:
        npc_id = state.get("npc_id", "unknown")
        print(f"[NPC-Response] [{npc_id}] Generating response | emotion={state.get('emotion')} | trust={state.get('trust_score')}")
        try:
            player_action = state["conversation_history"][-1]["content"]
            memory = state["memory"]
            recent_history = "\n".join(memory.get("relationship_history", [])[-3:])

            # Build conversation context so the LLM doesn't repeat greetings
            conv_history = state.get("conversation_history", [])
            conv_lines = []
            for entry in conv_history[:-1]:  # exclude the latest (already in player_action)
                role = entry.get("role", "unknown")
                content = entry.get("content", "")
                label = "[You said]" if role == "npc" else "[Player said]"
                conv_lines.append(f"{label} {content}")
            conv_history_str = "\n".join(conv_lines[-10:]) if conv_lines else "(conversation just started)"

            prompt = SYSTEM_GENERATE_RESPONSE.format(
                persona=state["npc_identity"],
                trust_score=state["trust_score"],
                emotion=state["emotion"],
                relationship_history=recent_history,
                player_action=player_action,
                conversation_history=conv_history_str,
            )

            print(f"[NPC-Response] [{npc_id}] Calling LLM...")
            response = self.llm.invoke(prompt)
            dialogue = _trim_dialogue(response.content)
            print(f"[NPC-Response] [{npc_id}] LLM response received, len={len(dialogue)}")

            action_trigger = state["conversation_history"][-1]["triggers"].get("action_trigger", "NONE")
            print(f"[NPC-Response] [{npc_id}] action_trigger={action_trigger}")

            return {
                "dialogue": dialogue,
                "action_trigger": action_trigger or "NONE",
            }
        except Exception as e:
            print(f"[NPC-Response] [{npc_id}] ERROR: {type(e).__name__}: {e}")
            print(traceback.format_exc())
            raise

    def node_validate_output(self, state: NPCState) -> dict:
        npc_id = state.get("npc_id", "unknown")
        print(f"[NPC-Validate] [{npc_id}] Validating output")
        try:
            output = NPCResponse(
                dialogue=state["dialogue"],
                emotion=state["emotion"],
                trust_score=state["trust_score"],
                action_trigger=state["action_trigger"],
                audio_url=None,
            )
            print(f"[NPC-Validate] [{npc_id}] Validation PASSED | emotion={output.emotion} | trust={output.trust_score}")
            return {"validation_status": "VALID", "output": output.model_dump()}
        except Exception as e:
            print(f"[NPC-Validate] [{npc_id}] Validation FAILED: {type(e).__name__}: {e}")
            return {"validation_status": "INVALID", "error": str(e)}
