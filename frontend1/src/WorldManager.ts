import type { BackendService } from "./BackendService";
import type { HUD } from "./HUD";
import type { GameWorldState, WorldTickResponse, WorldAction } from "./types";

export type ActionHandler = (action: WorldAction) => void;

export class WorldManager {
  private worldState: GameWorldState;
  private recentEvents: unknown[] = [];
  private tickTimer: ReturnType<typeof setInterval> | null = null;
  private actionHandlers: Map<string, ActionHandler> = new Map();

  constructor(
    private backendService: BackendService,
    private hud: HUD,
    defaults?: Partial<GameWorldState>
  ) {
    this.worldState = {
      location: defaults?.location ?? "city_center",
      weather: defaults?.weather ?? "clear",
      time_of_day: defaults?.time_of_day ?? "noon",
      tension_level: defaults?.tension_level ?? 0,
      player_karma: defaults?.player_karma ?? 0,
      active_npcs: defaults?.active_npcs ?? [],
    };
  }

  /**
   * Register a handler for a specific action type (e.g. "change_weather").
   */
  public onAction(actionType: string, handler: ActionHandler): void {
    this.actionHandlers.set(actionType, handler);
  }

  /**
   * Start the periodic world tick loop.
   */
  public startTickLoop(intervalMs = 30000): void {
    if (this.tickTimer) return;
    console.log(`[WorldManager] Starting tick loop (${intervalMs / 1000}s interval)`);
    this.tickTimer = setInterval(() => this.tick(), intervalMs);
  }

  /**
   * Stop the tick loop.
   */
  public stopTickLoop(): void {
    if (this.tickTimer) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
  }

  /**
   * Run a single world tick manually.
   */
  public async tick(): Promise<WorldTickResponse | null> {
    console.log("[WorldManager] Running world tick...");
    const events = this.drainEvents();

    const response = await this.backendService.worldTick(this.worldState, events);

    if (response.validation_status === "ERROR") {
      console.warn("[WorldManager] Tick failed (backend unreachable)");
      return null;
    }

    this.processTickResponse(response);
    return response;
  }

  /**
   * Add an event to the buffer (will be sent on next tick).
   */
  public addEvent(event: unknown): void {
    this.recentEvents.push(event);
  }

  /**
   * Adjust the player's karma score.
   */
  public adjustKarma(delta: number): void {
    this.worldState.player_karma = Math.max(
      -100,
      Math.min(100, this.worldState.player_karma + delta)
    );
    this.hud.updateKarma(this.worldState.player_karma);
  }

  /**
   * Get the current world state (read-only).
   */
  public getWorldState(): GameWorldState {
    return { ...this.worldState };
  }

  /**
   * Update the active NPCs list (called by Game when NPCs change).
   */
  public setActiveNPCs(
    npcs: { id: string; type: string; location: string; mood: string }[]
  ): void {
    this.worldState.active_npcs = npcs;
  }

  private drainEvents(): unknown[] {
    const events = [...this.recentEvents];
    this.recentEvents = [];
    return events;
  }

  private processTickResponse(response: WorldTickResponse): void {
    // Show narrator text
    if (response.narrator) {
      this.hud.showNarrator(response.narrator);
    }

    // Execute actions
    for (const action of response.actions) {
      const handler = this.actionHandlers.get(action.action);
      if (handler) {
        try {
          handler(action);
        } catch (err) {
          console.error(`[WorldManager] Action handler error for "${action.action}":`, err);
        }
      }

      // Update internal state for known action types
      if (action.action === "change_weather" && typeof action.condition === "string") {
        this.worldState.weather = action.condition;
        this.hud.updateWeather(action.condition);
      }
      if (action.action === "update_tension" && typeof action.level === "number") {
        this.worldState.tension_level = action.level;
      }
    }

    // Process NPC responses from world events
    for (const npcResp of response.npc_responses) {
      if (npcResp.error) {
        console.warn(`[WorldManager] NPC ${npcResp.npc_id} error:`, npcResp.error);
        continue;
      }
      if (npcResp.dialogue) {
        console.log(`[WorldManager] NPC ${npcResp.npc_id} says: "${npcResp.dialogue}"`);
      }
      // Play audio if available
      if (npcResp.audio_url) {
        try {
          const audio = new Audio(npcResp.audio_url);
          audio.play();
        } catch (err) {
          console.warn(`[WorldManager] Failed to play NPC audio:`, err);
        }
      }
    }
  }
}
