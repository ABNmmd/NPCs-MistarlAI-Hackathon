import type {
  NPCReactRequest,
  NPCReactResponse,
  NPCRuntimeState,
  NPCEvent,
  NPCTickData,
  GameWorldState,
  WorldTickRequest,
  WorldTickResponse,
  GameConfig,
  NPCConfigEntry,
} from "./types";

export class BackendService {
  private npcStates: Map<string, NPCRuntimeState> = new Map();
  private config: GameConfig | null = null;

  /**
   * Load the game configuration from npc_config.json.
   */
  public async loadConfig(): Promise<GameConfig> {
    const response = await fetch("/npc_config.json");
    this.config = (await response.json()) as GameConfig;
    return this.config;
  }

  public getConfig(): GameConfig | null {
    return this.config;
  }

  /**
   * Register an NPC from config, initializing its runtime state.
   */
  public registerNPC(npc: NPCConfigEntry): void {
    this.npcStates.set(npc.id, {
      id: npc.id,
      npc_identity: npc.npc_identity,
      voice_id: npc.voice_id,
      type: npc.type,
      location: `${npc.spawn.x},${npc.spawn.z}`,
      greeting: npc.greeting,
      trust_score: 5,
      emotion: "NEUTRAL",
      memory: {
        short_term: [],
        long_term_summary: "",
        relationship_history: [],
      },
      conversation_history: [],
    });
  }

  /**
   * Get the runtime state for an NPC.
   */
  public getNPCState(npcId: string): NPCRuntimeState | undefined {
    return this.npcStates.get(npcId);
  }

  /**
   * Send a player message to an NPC via the backend.
   */
  public async npcReact(
    npcId: string,
    playerMessage: string,
    worldState: GameWorldState
  ): Promise<NPCReactResponse> {
    const npcState = this.npcStates.get(npcId);
    if (!npcState) {
      return this.fallbackResponse();
    }

    // Add player message to conversation history
    npcState.conversation_history.push({
      role: "user",
      content: playerMessage,
    });

    // Build the event for the NPC
    const recentEvents: NPCEvent[] = [
      {
        source: "player",
        action: playerMessage,
        time: 0,
      },
    ];

    const request: NPCReactRequest = {
      npc_id: npcState.id,
      npc_identity: npcState.npc_identity,
      voice_id: npcState.voice_id,
      memory: npcState.memory,
      trust_score: npcState.trust_score,
      emotion: npcState.emotion,
      world_state: {
        location: worldState.location,
        weather: worldState.weather,
        time_of_day: worldState.time_of_day,
        tension_level: worldState.tension_level,
      },
      recent_events: recentEvents,
      conversation_history: npcState.conversation_history,
    };

    try {
      const response = await fetch("/api/npc/react", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`NPC API error: ${response.status}`);
      }

      const data = (await response.json()) as NPCReactResponse;

      // Update NPC state with response
      npcState.trust_score = data.trust_score;
      npcState.emotion = data.emotion;
      npcState.conversation_history.push({
        role: "assistant",
        content: data.dialogue,
      });

      // Keep conversation history manageable (last 20 messages)
      if (npcState.conversation_history.length > 20) {
        npcState.conversation_history = npcState.conversation_history.slice(-20);
      }

      // Update short-term memory
      npcState.memory.short_term.push(
        `Player said: "${playerMessage}" → NPC responded with ${data.emotion}`
      );
      if (npcState.memory.short_term.length > 10) {
        npcState.memory.short_term = npcState.memory.short_term.slice(-10);
      }

      return data;
    } catch (err) {
      console.error("[BackendService] npcReact failed:", err);
      // Remove the player message we added since the call failed
      npcState.conversation_history.pop();
      return this.fallbackResponse();
    }
  }

  /**
   * Run a world tick via the backend.
   */
  public async worldTick(
    worldState: GameWorldState,
    recentEvents: unknown[]
  ): Promise<WorldTickResponse> {
    // Build active_npcs map from our NPC states
    const activeNpcs: Record<string, NPCTickData> = {};
    for (const [id, state] of this.npcStates) {
      activeNpcs[id] = {
        npc_identity: state.npc_identity,
        voice_id: state.voice_id,
        type: state.type,
        location: state.location,
        mood: state.emotion,
        memory: state.memory,
        trust_score: state.trust_score,
        emotion: state.emotion,
        conversation_history: state.conversation_history,
      };
    }

    const request: WorldTickRequest = {
      world_state: worldState as unknown as Record<string, unknown>,
      recent_events: recentEvents,
      active_npcs: activeNpcs,
    };

    try {
      const response = await fetch("/api/world/tick", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(request),
      });

      if (!response.ok) {
        throw new Error(`World tick API error: ${response.status}`);
      }

      const data = (await response.json()) as WorldTickResponse;

      // Update NPC states from any npc_responses
      for (const npcResp of data.npc_responses) {
        if (npcResp.error) continue;
        const state = this.npcStates.get(npcResp.npc_id);
        if (state && npcResp.emotion) {
          state.emotion = npcResp.emotion;
        }
        if (state && npcResp.trust_score != null) {
          state.trust_score = npcResp.trust_score;
        }
      }

      return data;
    } catch (err) {
      console.error("[BackendService] worldTick failed:", err);
      return {
        actions: [],
        narrator: "",
        npc_directives: [],
        npc_responses: [],
        validation_status: "ERROR",
      };
    }
  }

  /**
   * Check if the backend is reachable.
   */
  public async healthCheck(): Promise<boolean> {
    try {
      const response = await fetch("/api/npc/health");
      return response.ok;
    } catch {
      return false;
    }
  }

  private fallbackResponse(): NPCReactResponse {
    return {
      dialogue: "Hmm, I seem to have lost my train of thought. Could you say that again?",
      emotion: "NEUTRAL",
      trust_score: 5,
      action_trigger: "NONE",
      audio_url: null,
    };
  }
}
