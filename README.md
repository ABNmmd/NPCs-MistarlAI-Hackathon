# NPCs — Mistral AI Hackathon

> **A 3D browser game where every NPC is a live AI agent.** NPCs perceive your actions, form opinions, remember your history, and speak with their own voice — while an invisible AI director reshapes the world around you based on your moral choices. Powered by **Mistral AI**.

---

## Demo

1. You walk into a village. Three NPCs are going about their day — a farmer, a guard on patrol, a merchant at their stall.  
2. Press **E** to talk. Type anything in natural language. The NPC responds in-character, with voice.  
3. Be kind → your karma rises → the world brightens, a healer appears, tension drops.  
4. Be hostile → karma falls → weather darkens, guards spawn, the world fights back.  
5. Every NPC **remembers** what you said. Come back to the farmer after threatening the guard — he's heard about it.

No scripts. No dialogue trees. Every word is generated live by Mistral AI.

---

## What Makes This Different

| Feature | How It Works |
|---|---|
| **NPC Memory & Emotions** | Each NPC tracks trust (0–10), emotion (8 states), short-term memory, long-term summaries, and relationship history. All persist across conversations. |
| **Karma-Driven World** | A World Orchestrator AI agent watches your cumulative karma (-100 to +100) and issues real-time world actions: spawning NPCs, changing weather, triggering events, adjusting tension. |
| **Two Independent AI Agents** | The NPC Agent and World Orchestrator are separate LangGraph pipelines with their own state machines, validation, and retry logic. They coordinate but run independently. |
| **Voice Acting** | Every NPC response is converted to speech via Deepgram Aura TTS with per-NPC voice assignments. Audio plays in-browser as a base64 data URL. |
| **Quest System** | A multi-stage quest chain unlocks new NPCs (healer, blacksmith, wanderer) as the player progresses. NPCs spawn dynamically with full AI personalities. |
| **Zero Dialogue Trees** | There are no pre-written conversation paths. NPCs generate every response live based on their persona, emotional state, trust level, and conversation history. |

---

## Tech Stack

| Layer | Technology | Purpose |
|---|---|---|
| **3D Engine** | Babylon.js 8.53 | Scene rendering, physics, shadows, animations |
| **Frontend** | TypeScript + Vite | Game loop, NPC management, player controls, chat UI |
| **Backend** | Python + FastAPI + Uvicorn | REST API serving both AI agents |
| **AI Pipelines** | LangGraph + LangChain | Stateful, graph-based agent orchestration |
| **LLM** | Mistral AI (`mistral-large-latest`) | All NPC dialogue and world orchestration |
| **Voice** | Deepgram Aura TTS | Real-time text-to-speech with multiple voice profiles |
| **Validation** | Pydantic v2 | Strict schema enforcement on all AI outputs |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                        BROWSER (Babylon.js)                  │
│                                                              │
│  Game.ts ──┬── PlayerController (WASD, camera, collisions)   │
│            ├── NPCManager (spawn, AI behaviors, speech)      │
│            ├── Environment (lighting, weather, procedural     │
│            │               ground texture)                   │
│            ├── WorldManager (trees, rocks, buildings)         │
│            ├── ChatUI (natural language chat overlay)         │
│            ├── WorldService (orchestrator auto-tick, karma)   │
│            └── AIService (NPC backend communication)         │
│                                                              │
│  Every 45s: WorldService ──POST──▶ /api/world/tick           │
│  On chat:   AIService ────POST──▶ /api/npc/react             │
└──────────────────────────────────────────────────────────────┘
                              │
                              ▼
┌──────────────────────────────────────────────────────────────┐
│                    BACKEND (FastAPI)                          │
│                                                              │
│  /api/npc/react ──▶ NPC LangGraph Pipeline                   │
│                     ┌─────────────────────────────────┐      │
│                     │ perceive → evaluate_consciousness│      │
│                     │ → update_memory → generate_response    │
│                     │ → validate_output                │      │
│                     └─────────────────────────────────┘      │
│                                                              │
│  /api/world/tick ──▶ World Orchestrator LangGraph Pipeline   │
│                     ┌─────────────────────────────────┐      │
│                     │ normalize_input → generate_actions│     │
│                     │ → validate_output ──┐            │      │
│                     │     ↑ (retry)       ▼            │      │
│                     │     └── INVALID     VALID        │      │
│                     │                     ▼            │      │
│                     │            dispatch_npc_actions   │      │
│                     └─────────────────────────────────┘      │
│                                                              │
│  Voice: Deepgram Aura TTS (per-NPC voice profiles)           │
└──────────────────────────────────────────────────────────────┘
```

---

## NPC Agent Pipeline (LangGraph)

Each NPC processes player input through a 5-node graph:

| Node | Purpose | LLM Call? |
|---|---|---|
| **Perceive** | Extract player action from events, run keyword trigger detection (emotion + action triggers) | No |
| **Evaluate Consciousness** | Determine emotional shift and trust delta based on persona, history, and current action | Yes |
| **Update Memory** | Append to short-term memory; when buffer reaches 8 entries, generate a long-term summary | Sometimes |
| **Generate Response** | Produce in-character dialogue (1–2 sentences, ≤240 chars) using full conversation context | Yes |
| **Validate Output** | Enforce Pydantic schema: dialogue, emotion, trust_score, action_trigger, audio_url | No |

**Emotion States:** `ANGRY` · `HAPPY` · `NEUTRAL` · `SUSPICIOUS` · `GRATEFUL` · `SAD` · `CONFUSED` · `EXCITED`

**Trigger System:** Keywords like "gift", "attack", "joke", "threat" fire deterministic emotion/trust changes *before* the LLM evaluates — ensuring consistent reactions to clear-cut actions while letting the LLM handle nuance.

---

## World Orchestrator Agent (LangGraph)

The orchestrator runs on a 45-second auto-tick and has access to 6 world actions:

| Action | Effect |
|---|---|
| `spawn_npc` | Add a new NPC (villager, guard, merchant, wanderer, healer, blacksmith) |
| `remove_npc` | Remove an NPC from the world |
| `change_weather` | Shift conditions (clear → thunderstorm, etc.) with instant or gradual transition |
| `trigger_event` | Fire a named world event (rescue mission, festival, lockdown, etc.) |
| `update_tension` | Set global tension level (0–10) — affects lighting and NPC behavior |
| `send_to_npc` | Tell a specific NPC what just happened nearby — it independently decides its reaction |

**Karma Bands** drive the narrative:

| Karma Range | World Behavior |
|---|---|
| +75 to +100 (Hero) | Friendly NPCs, clear weather, festivals, tension drops |
| +25 to +74 (Good) | Subtle boosts, helpful merchants, mild positive events |
| -24 to +24 (Neutral) | Balanced — random flavor events, NPCs go about their business |
| -25 to -74 (Bad) | Hostile NPCs, darkening weather, rising tension |
| -75 to -100 (Villain) | Maximum chaos — guards hunt you, storms rage, lockdowns trigger |

---

## Project Structure

```
├── main.py                          # Entry point (uvicorn)
├── requirements.txt                 # Python dependencies
├── .env                             # API keys + LLM_PROVIDER config
│
├── backend/
│   ├── main.py                      # FastAPI app, CORS, router mounts
│   ├── routes/
│   │   ├── npc.py                   # POST /api/npc/react — NPC dialogue
│   │   └── world.py                 # POST /api/world/tick — world orchestration
│   ├── npc/
│   │   ├── graph.py                 # LangGraph StateGraph (5 nodes)
│   │   ├── nodes.py                 # NodeExecutor — all NPC logic
│   │   ├── state.py                 # NPCState TypedDict
│   │   ├── prompts.py              # System prompts for consciousness + response
│   │   ├── trigger_system.py        # Keyword-based emotion/action triggers
│   │   ├── tts_service.py           # Deepgram Aura TTS + dialogue cleanup
│   │   └── output_schema.py         # Pydantic NPCResponse model
│   └── world_orchestrator/
│       ├── graph.py                 # LangGraph StateGraph (4 nodes + retry loop)
│       ├── nodes.py                 # NodeExecutor — orchestrator logic
│       ├── state.py                 # WorldOrchestratorState TypedDict
│       ├── prompts.py              # World director system prompt (~5K tokens)
│       ├── llm.py                   # Multi-provider LLM factory
│       └── output_schema.py         # Pydantic action schemas (6 action types)
│
└── frontend/
    ├── package.json                 # Vite + Babylon.js 8.53
    ├── index.html                   # Canvas + UI overlays
    ├── npc_config.json              # Backend URL + default NPC config
    ├── public/
    │   ├── world.json               # Terrain, lighting, 60 trees, 30 rocks
    │   ├── npcs.json                # 6 templates, 3 instances, 3 deferred NPCs
    │   └── player.json              # Player stats, camera, movement config
    └── src/
        ├── main.ts                  # Bootstrap
        ├── Game.ts                  # Main game class (13 initialization stages)
        ├── PlayerController.ts      # WASD movement, pointer lock camera, jump
        ├── NPCManager.ts            # NPC lifecycle, behaviors, animations, speech
        ├── AIService.ts             # Backend communication, state management
        ├── ChatUI.ts                # In-game chat overlay
        ├── WorldService.ts          # Orchestrator client, karma, auto-tick
        ├── WorldManager.ts          # Procedural trees, rocks, buildings
        ├── Environment.ts           # Lighting, fog, weather transitions, sky
        └── style.css                # Full game UI styles (790 lines)
```

---

## Getting Started

### Prerequisites

- **Python 3.11+**
- **Node.js 18+**
- A **Mistral AI** API key ([console.mistral.ai](https://console.mistral.ai))

### 1. Clone & Install

```bash
git clone https://github.com/<your-org>/NPCs-MistarlAI-Hackathon.git
cd NPCs-MistarlAI-Hackathon

# Backend
python -m venv .venv
.venv\Scripts\activate        # Windows
# source .venv/bin/activate   # macOS / Linux
pip install -r requirements.txt

# Frontend
cd frontend
npm install
cd ..
```

### 2. Configure Environment

Create a `.env` file in the project root:

```env
# Required — Mistral AI powers all NPC dialogue and world orchestration
MISTRAL_API_KEY=your_mistral_api_key_here
LLM_PROVIDER=mistral

# Optional — Deepgram for voice (NPCs still work without it, just no audio)
DEEPGRAM_API_KEY=your_deepgram_api_key_here

# Optional — alternative providers
# GROQ_API_KEY=your_groq_key
# LLM_PROVIDER=groq
# LLM_PROVIDER=ollama          # requires local Ollama server
```

### 3. Run

```bash
# Terminal 1 — Backend
python main.py
# → Uvicorn running on http://127.0.0.1:8000

# Terminal 2 — Frontend
cd frontend
npm run dev
# → Vite dev server on http://localhost:5173
```

### 4. Play

1. Open **http://localhost:5173** in your browser
2. Click to capture the mouse (pointer lock for camera control)
3. **WASD** to move, **mouse** to look, **scroll** to zoom
4. Walk near an NPC → press **E** to talk
5. Type anything → the NPC responds in-character with voice
6. Press **Escape** to close chat
7. Watch the world evolve every 45 seconds as the orchestrator reacts to your karma

---

## Controls

| Key | Action |
|---|---|
| **W A S D** | Move |
| **Shift** | Sprint |
| **Space** | Jump |
| **E** | Talk to nearby NPC |
| **Escape** | Close chat |
| **M** | Toggle management panel |
| **Mouse** | Camera rotation (pointer lock) |
| **Scroll** | Zoom in/out |

---

## API Reference

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/npc/react` | Send player input, receive NPC dialogue + emotion + trust + audio |
| `POST` | `/api/world/tick` | Run world orchestrator tick — returns actions, narrator, NPC directives |
| `POST` | `/api/world/orchestrate` | Run orchestrator without NPC processing |
| `GET` | `/api/npc/health` | NPC agent health check |
| `GET` | `/api/world/health` | World orchestrator health check |
| `GET` | `/docs` | Interactive Swagger API documentation |

---

## LLM Provider Configuration

Both the NPC agent and World Orchestrator read from the same `LLM_PROVIDER` environment variable:

| Provider | `LLM_PROVIDER` | Required Env Var | Default Model |
|---|---|---|---|
| **Mistral AI** | `mistral` | `MISTRAL_API_KEY` | `mistral-large-latest` |
| **Groq** | `groq` | `GROQ_API_KEY` | `llama-3.3-70b-versatile` |
| **Ollama** | `ollama` | `OLLAMA_BASE_URL` (default: `localhost:11434`) | `llama2` |

---

## NPCs in the World

### Starting NPCs

| NPC | Type | Personality | Voice |
|---|---|---|---|
| **Farmer Tom** | Villager | Cheerful, down-to-earth, proud of his crops | Zeus (male) |
| **Guard Captain** | Guard | Stern, disciplined, suspicious of strangers | Orpheus (neutral) |
| **Traveling Merchant** | Merchant | Charming, hints at mysterious wares and rumors | Asteria (female) |

### Quest-Unlocked NPCs

| NPC | Unlocked By | Personality |
|---|---|---|
| **Elder Sage** (Healer) | Talking to the Merchant | Wise, mystical, has foreseen your arrival |
| **Ironforge** (Blacksmith) | Shadow warning quest | Gruff, skilled, wants to forge a shadow-banishing weapon |
| **Silent Walker** (Wanderer) | Earning trust | Mysterious, speaks in riddles, has seen dark omens |

---

## Built With

- [Mistral AI](https://mistral.ai/) — Large language model powering all NPC intelligence and world orchestration
- [LangGraph](https://github.com/langchain-ai/langgraph) — Graph-based AI agent framework with state management
- [LangChain](https://github.com/langchain-ai/langchain) — LLM abstraction layer for multi-provider support
- [Babylon.js](https://www.babylonjs.com/) — WebGL 3D game engine
- [FastAPI](https://fastapi.tiangolo.com/) — High-performance Python web framework
- [Deepgram](https://deepgram.com/) — Aura text-to-speech for NPC voice acting
- [Vite](https://vitejs.dev/) — Frontend build tool
- [Pydantic](https://docs.pydantic.dev/) — Data validation for all AI outputs

---

## License

MIT

