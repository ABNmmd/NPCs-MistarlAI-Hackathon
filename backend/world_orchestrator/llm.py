import json
import os
import re

from dotenv import load_dotenv

load_dotenv()

# ── Provider defaults ──
PROVIDER_DEFAULTS = {
    "ollama": "llama2",
    "groq": "llama-3.3-70b-versatile",
    "mistral": "mistral-large-latest",
}


def get_llm(provider: str = None, model: str = None, temperature: float = 0.8):
    """
    Return a LangChain chat LLM based on the configured provider.

    Provider is resolved in order:
      1. Explicit `provider` argument
      2. WORLD_LLM_PROVIDER env var
      3. Defaults to "ollama"

    Model is resolved in order:
      1. Explicit `model` argument
      2. WORLD_LLM_MODEL env var
      3. Provider-specific default
    """
    provider = (provider or os.getenv("LLM_PROVIDER", "ollama")).lower()
    model = model or os.getenv("LLM_MODEL") or PROVIDER_DEFAULTS.get(provider)

    print(f"[WO-LLM] Initializing LLM | provider={provider} | model={model} | temperature={temperature}")

    if provider == "ollama":
        from langchain_ollama import ChatOllama
        base_url = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
        print(f"[WO-LLM] Connecting to Ollama at {base_url}")
        return ChatOllama(
            model=model,
            base_url=base_url,
            temperature=temperature,
            format="json",
        )

    elif provider == "groq":
        from langchain_groq import ChatGroq
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            print(f"[WO-LLM] ERROR: GROQ_API_KEY is not set")
            raise EnvironmentError("GROQ_API_KEY is not set. Add it to your .env file.")
        print(f"[WO-LLM] Using Groq with model={model}")
        return ChatGroq(
            model=model,
            api_key=api_key,
            temperature=temperature,
            model_kwargs={"response_format": {"type": "json_object"}},
        )

    elif provider == "mistral":
        from langchain_mistralai import ChatMistralAI
        api_key = os.getenv("MISTRAL_API_KEY")
        if not api_key:
            print(f"[WO-LLM] ERROR: MISTRAL_API_KEY is not set")
            raise EnvironmentError("MISTRAL_API_KEY is not set. Add it to your .env file.")
        print(f"[WO-LLM] Using Mistral with model={model}")
        return ChatMistralAI(
            model=model,
            api_key=api_key,
            temperature=temperature,
            model_kwargs={"response_format": {"type": "json_object"}},
        )

    else:
        print(f"[WO-LLM] ERROR: Unknown provider '{provider}'")
        raise ValueError(
            f"Unknown LLM_PROVIDER '{provider}'. "
            f"Supported: {', '.join(PROVIDER_DEFAULTS.keys())}"
        )


def _extract_json(raw: str) -> dict:
    """
    Parse the model response as JSON.
    Strips markdown code fences if the model included them despite instructions.
    Raises ValueError if no valid JSON object can be extracted.
    """
    text = raw.strip()

    fenced = re.match(r"^```(?:json)?\s*([\s\S]*?)```$", text, re.IGNORECASE)
    if fenced:
        print(f"[WO-LLM] Stripping markdown code fence from response")
        text = fenced.group(1).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError as e:
        print(f"[WO-LLM] Direct JSON parse failed: {e} — trying regex extraction")
        match = re.search(r"\{[\s\S]*\}", text)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError as e2:
                print(f"[WO-LLM] Regex JSON extraction also failed: {e2}")

    print(f"[WO-LLM] Could not parse JSON from response. Raw snippet: {raw[:200]}")
    raise ValueError(
        f"Could not parse JSON from response.\nRaw:\n{raw}"
    )
