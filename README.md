# NPCs-MistralAI-Hackathon

A 3D game where every NPC is powered by a live AI agent. NPCs remember your actions, form opinions about you, and the world itself reacts to your moral choices — all driven by MistralAI and LangGraph.

## What We Built

An interactive 3D browser game with a full AI backend. Players explore a procedurally built city, talk to NPCs in natural language, and watch the world change based on their behavior. Every NPC runs as an independent AI agent with memory, emotion, and trust tracking. A separate world orchestrator agent monitors global state and triggers dynamic events in response to player karma.

## Key Innovations

- **Persistent NPC Memory and Emotion**: NPCs remember past interactions and adjust their trust, mood, and dialogue accordingly. Relationships evolve across the session.
- **Karma-Driven World Orchestration**: A dedicated AI agent tracks player karma and issues world-level directives — spawning allies or enemies, shifting weather, raising tension — in real time.
- **Graph-Based AI Pipelines**: Both the NPC agent and world orchestrator are built with LangGraph, enabling structured, retryable, and validatable AI workflows.
- **Free Text-to-Speech**: NPC dialogue is voiced using Edge TTS — no API cost, no latency overhead.
- **Multi-Provider LLM Support**: Swap between Ollama (local), Groq, or MistralAI with a single environment variable.

## Tech Stack

| Layer | Technologies |
|---|---|
| Frontend | TypeScript, Babylon.js, Vite |
| Backend | Python, FastAPI, Uvicorn |
| AI / Agents | LangGraph, LangChain, MistralAI, Groq, Ollama |
| Voice | Edge TTS |
| Data Validation | Pydantic |

## Architecture

**Frontend** (`frontend1/src/`):
- `Game.ts` — main game loop and scene management
- `PlayerController.ts` — WASD movement, sprinting, jumping, collision
- `NPCController.ts` — NPC positioning and interaction triggers
- `AssetLoader.ts` — GLB model loading with animation support
- `CityBuilder.ts` — procedural city generation
- `ChatUI.ts` — in-game chat overlay
- `AIService.ts` — communicates with backend NPC endpoints

**Backend** (`backend/`):
- `routes/npc.py` — NPC reaction endpoint
- `routes/world.py` — world tick and orchestration endpoint
- `npc/` — LangGraph agent: perception, consciousness, memory, and response nodes
- `world_orchestrator/` — LangGraph agent: global state tracking and world directive generation
- `tts_service.py` — text-to-speech via Edge TTS

State is managed with TypedDicts and persisted using LangGraph's built-in memory saver.


## API Endpoints

| Method | Endpoint | Description |
|---|---|---|
| `POST` | `/api/npc/react` | Generate an NPC response |
| `POST` | `/api/world/tick` | Run a full world orchestration tick |
| `GET` | `/api/npc/health` | NPC agent health check |
| `GET` | `/api/world/health` | World orchestrator health check |





