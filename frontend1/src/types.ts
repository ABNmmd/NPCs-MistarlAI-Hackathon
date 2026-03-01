// ── Backend API Types ──
// These interfaces match the Pydantic models in backend/routes/npc.py and backend/routes/world.py

// ── NPC React ──

export interface NPCMemory {
  short_term: string[];
  long_term_summary: string;
  relationship_history: string[];
}

export interface NPCEvent {
  source: string;
  action: string;
  time: number;
}

export interface NPCReactRequest {
  npc_id: string;
  npc_identity: string;
  voice_id: string;
  memory: NPCMemory;
  trust_score: number;
  emotion: string;
  world_state: Record<string, unknown>;
  recent_events: NPCEvent[];
  conversation_history: { role: string; content: string }[];
}

export interface NPCReactResponse {
  dialogue: string;
  emotion: string;
  trust_score: number;
  action_trigger: string;
  audio_url: string | null;
}

// ── World Tick ──

export interface WorldAction {
  action: string;
  [key: string]: unknown;
}

export interface NPCDirectiveResult {
  npc_id: string;
  event: string;
  dialogue: string | null;
  emotion: string | null;
  trust_score: number | null;
  action_trigger: string | null;
  audio_url: string | null;
  error: string | null;
}

export interface WorldTickRequest {
  world_state: Record<string, unknown>;
  recent_events: unknown[];
  active_npcs: Record<string, NPCTickData>;
}

export interface NPCTickData {
  npc_identity: string;
  voice_id: string;
  type: string;
  location: string;
  mood: string;
  memory: NPCMemory;
  trust_score: number;
  emotion: string;
  conversation_history: { role: string; content: string }[];
}

export interface WorldTickResponse {
  actions: WorldAction[];
  narrator: string;
  npc_directives: unknown[];
  npc_responses: NPCDirectiveResult[];
  validation_status: string;
}

// ── NPC Config (loaded from npc_config.json) ──

export interface NPCConfigEntry {
  id: string;
  npc_identity: string;
  voice_id: string;
  greeting: string;
  spawn: { x: number; z: number };
  type: string;
}

export interface GameConfig {
  npcs: NPCConfigEntry[];
  world_defaults: {
    location: string;
    weather: string;
    time_of_day: string;
    tension_level: number;
    player_karma: number;
  };
}

// ── Runtime NPC State (tracked per NPC in the frontend) ──

export interface NPCRuntimeState {
  id: string;
  npc_identity: string;
  voice_id: string;
  type: string;
  location: string;
  greeting: string;
  trust_score: number;
  emotion: string;
  memory: NPCMemory;
  conversation_history: { role: string; content: string }[];
}

// ── Game World State ──

export interface GameWorldState {
  location: string;
  weather: string;
  time_of_day: string;
  tension_level: number;
  player_karma: number;
  active_npcs: { id: string; type: string; location: string; mood: string }[];
}
