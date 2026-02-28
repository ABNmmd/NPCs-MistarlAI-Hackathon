import json
import os
import re

from dotenv import load_dotenv

load_dotenv()

# ── Provider defaults ──
PROVIDER_DEFAULTS = {
    "groq": "llama-3.3-70b-versatile",
    "mistral": "mistral-large-latest",
}


def get_llm(provider: str = None, model: str = None, temperature: float = 0.8):
    """
    Return a LangChain chat LLM based on the configured provider.

    Provider is resolved in order:
      1. Explicit `provider` argument
      2. WORLD_LLM_PROVIDER env var
      3. Defaults to "groq"

    Model is resolved in order:
      1. Explicit `model` argument
      2. WORLD_LLM_MODEL env var
      3. Provider-specific default
    """
    provider = (provider or os.getenv("WORLD_LLM_PROVIDER", "groq")).lower()
    model = model or os.getenv("WORLD_LLM_MODEL") or PROVIDER_DEFAULTS.get(provider)

    if provider == "groq":
        from langchain_groq import ChatGroq
        api_key = os.getenv("GROQ_API_KEY")
        if not api_key:
            raise EnvironmentError("GROQ_API_KEY is not set. Add it to your .env file.")
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
            raise EnvironmentError("MISTRAL_API_KEY is not set. Add it to your .env file.")
        return ChatMistralAI(
            model=model,
            api_key=api_key,
            temperature=temperature,
            model_kwargs={"response_format": {"type": "json_object"}},
        )

    else:
        raise ValueError(
            f"Unknown WORLD_LLM_PROVIDER '{provider}'. "
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
        text = fenced.group(1).strip()

    try:
        return json.loads(text)
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", text)
        if match:
            try:
                return json.loads(match.group(0))
            except json.JSONDecodeError:
                pass

    raise ValueError(
        f"Could not parse JSON from response.\nRaw:\n{raw}"
    )
