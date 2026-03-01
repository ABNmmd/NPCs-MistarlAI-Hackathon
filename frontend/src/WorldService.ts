// ── Types matching the backend /api/world/tick schema ─────────────────────────

interface WorldState {
  location: string;
  weather: string;
  time_of_day: string;
  tension_level: number;
  /** -100 (villain) → +100 (hero) — primary orchestrator narrative compass */
  player_karma: number;
  recent_player_actions: string[];
  /** List kept in sync with registerNPC / updateNPCState for the LLM */
  active_npcs: { id: string; type: string; location: string; mood: string }[];
  [key: string]: unknown;
}

interface NPCMemory {
  short_term: string[];
  long_term_summary: string;
  relationship_history: string[];
}

export interface NPCTickData {
  npc_identity: string;
  voice_id: string;
  /** NPC archetype — used by orchestrator send_to_npc type-filter */
  type: string;
  memory: NPCMemory;
  trust_score: number;
  emotion: string;
  location: string;
  conversation_history: { role: string; content: string }[];
}

export interface TickNPCResult {
  npc_id: string;
  event: string;
  dialogue?: string;
  emotion?: string;
  trust_score?: number;
  action_trigger?: string;
  audio_url?: string | null;
  error?: string;
}

interface TickResponse {
  actions: Record<string, unknown>[];
  narrator: string;
  npc_directives: Record<string, unknown>[];
  npc_responses: TickNPCResult[];
  validation_status: string;
}

type NarratorCallback = (text: string) => void;
type ActionCallback   = (action: Record<string, unknown>) => void;
type DirectiveCallback = (result: TickNPCResult) => void;

/** Gap between successive NPC speeches so they don't all talk at once */
const SPEECH_STAGGER_MS = 5_000;

// ── Service ────────────────────────────────────────────────────────────────────

export class WorldService {
  private backendUrl = "";

  private worldState: WorldState = {
    location:              "village",
    weather:               "clear",
    time_of_day:           "noon",
    tension_level:         0,
    player_karma:          0,
    recent_player_actions: [],
    active_npcs:           [],
  };

  private recentEvents: { source: string; action: string; time: number }[] = [];
  private activeNpcs: Record<string, NPCTickData> = {};

  private tickInterval: ReturnType<typeof setInterval> | null = null;
  /** NPC the player is currently chatting with — skip orchestrator directives for it */
  private activeChatNpcId: string | null = null;

  private onDirectiveCallback: DirectiveCallback | null = null;
  private onNarratorCallback:  NarratorCallback  | null = null;
  private onActionCallback:    ActionCallback    | null = null;

  // ── Init ──────────────────────────────────────────────────────────────────

  public init(backendUrl: string): void {
    this.backendUrl = backendUrl.replace(/\/$/, "");
    console.log("[WorldService] Initialized. Backend:", this.backendUrl);
  }

  // ── NPC registry ─────────────────────────────────────────────────────────

  public registerNPC(id: string, data: NPCTickData): void {
    this.activeNpcs[id] = data;
    this._syncActiveNpcList();
    console.log(`[WorldService] Registered NPC: ${id}`);
  }

  public updateNPCState(id: string, patch: Partial<NPCTickData>): void {
    if (this.activeNpcs[id]) {
      this.activeNpcs[id] = { ...this.activeNpcs[id], ...patch };
      this._syncActiveNpcList();
    }
  }

  private _syncActiveNpcList(): void {
    this.worldState.active_npcs = Object.entries(this.activeNpcs).map(([id, d]) => ({
      id,
      type:     d.type,
      location: d.location,
      mood:     d.emotion,  // emotion → mood as the LLM expects
    }));
  }

  // ── Karma ─────────────────────────────────────────────────────────────────

  /**
   * Adjust player karma clamped to [-100, +100].
   * Positive delta = more heroic, negative = more villainous.
   */
  public adjustPlayerKarma(delta: number): void {
    const prev = this.worldState.player_karma as number;
    this.worldState.player_karma = Math.max(-100, Math.min(100, prev + delta));
    console.log(`[WorldService] player_karma ${prev} → ${this.worldState.player_karma}`);
  }

  public getPlayerKarma(): number {
    return this.worldState.player_karma as number;
  }

  // ── World state helpers ───────────────────────────────────────────────────

  public addEvent(source: string, action: string): void {
    this.recentEvents.push({ source, action, time: Math.floor(Date.now() / 1000) });
    if (this.recentEvents.length > 10) {
      this.recentEvents = this.recentEvents.slice(-10);
    }
    // Keep recent_player_actions inside world_state for the orchestrator LLM
    if (source === "player") {
      const arr = this.worldState.recent_player_actions as string[];
      arr.push(action);
      if (arr.length > 5) arr.splice(0, arr.length - 5);
    }
  }

  public setWeather(weather: string): void   { this.worldState.weather = weather; }
  public setTimeOfDay(time: string): void    { this.worldState.time_of_day = time; }
  public setTensionLevel(level: number): void {
    this.worldState.tension_level = Math.max(0, Math.min(10, level));
  }

  public getWorldState(): WorldState { return { ...this.worldState }; }

  // ── Callbacks ─────────────────────────────────────────────────────────────

  /** Fires for each NPC speech the orchestrator produces (staggered). */
  public onNPCDirective(cb: DirectiveCallback): void { this.onDirectiveCallback = cb; }

  /** Fires when the orchestrator emits the narrator sentence. */
  public onNarrator(cb: NarratorCallback): void { this.onNarratorCallback = cb; }

  /**
   * Fires for each world action in the orchestrator response:
   * spawn_npc, remove_npc, change_weather, trigger_event, update_tension, spawn_vehicle
   */
  public onAction(cb: ActionCallback): void { this.onActionCallback = cb; }

  /** Mark an NPC as actively chatting — orchestrator directives for it will be skipped. */
  public setActiveChatNpc(npcId: string | null): void { this.activeChatNpcId = npcId; }

  // ── Tick ──────────────────────────────────────────────────────────────────

  public async tick(): Promise<void> {
    if (!this.backendUrl) return;
    if (Object.keys(this.activeNpcs).length === 0) {
      console.log("[WorldService] Skipping tick — no NPCs registered.");
      return;
    }

    console.log(`[WorldService] Ticking | karma=${this.worldState.player_karma} | npcs=${Object.keys(this.activeNpcs).length}`);
    try {
      const response = await fetch(`${this.backendUrl}/api/world/tick`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          world_state:   this.worldState,
          recent_events: this.recentEvents,
          active_npcs:   this.activeNpcs,
        }),
      });

      if (!response.ok) {
        console.warn(`[WorldService] Tick failed: ${response.status} ${response.statusText}`);
        return;
      }

      const result = (await response.json()) as TickResponse;
      console.log(`[WorldService] Tick done | narrator="${result.narrator}" | actions=${result.actions.length} | npc_responses=${result.npc_responses.length}`);

      // Clear events consumed by this tick
      this.recentEvents = [];

      // 1 ── Show narrator line
      if (result.narrator && this.onNarratorCallback) {
        this.onNarratorCallback(result.narrator);
      }

      // 2 ── Fire world actions (spawn_npc, change_weather, etc.)
      if (this.onActionCallback) {
        for (const action of result.actions) {
          this.onActionCallback(action);
        }
      }

      // 3 ── Staggered NPC directive speeches (skip whoever player is chatting with)
      if (this.onDirectiveCallback) {
        const eligible = result.npc_responses.filter(
          (r) => !r.error && r.dialogue && r.npc_id !== this.activeChatNpcId
        );

        eligible.forEach((npcResult, index) => {
          // Sync state immediately (no need to wait for display)
          this.updateNPCState(npcResult.npc_id, {
            emotion:     npcResult.emotion    ?? this.activeNpcs[npcResult.npc_id]?.emotion,
            trust_score: npcResult.trust_score ?? this.activeNpcs[npcResult.npc_id]?.trust_score,
          });

          setTimeout(() => {
            // Re-check in case player opened chat with this NPC during the delay
            if (npcResult.npc_id !== this.activeChatNpcId) {
              this.onDirectiveCallback!(npcResult);
            }
          }, index * SPEECH_STAGGER_MS);
        });

        result.npc_responses
          .filter((r) => r.error)
          .forEach((r) => console.warn(`[WorldService] Directive error for ${r.npc_id}: ${r.error}`));
      }

    } catch (err) {
      console.warn("[WorldService] Tick error (backend unreachable?):", err);
    }
  }

  /** Start auto-ticking every `intervalMs` milliseconds (default 45 s). */
  public startAutoTick(intervalMs = 45_000): void {
    if (this.tickInterval) this.stopAutoTick();
    console.log(`[WorldService] Auto-tick every ${intervalMs / 1000}s`);
    void this.tick();
    this.tickInterval = setInterval(() => void this.tick(), intervalMs);
  }

  public stopAutoTick(): void {
    if (this.tickInterval) {
      clearInterval(this.tickInterval);
      this.tickInterval = null;
      console.log("[WorldService] Auto-tick stopped.");
    }
  }
}

// Singleton — import this everywhere
export const worldService = new WorldService();
