import { worldService } from "./WorldService";

// ── Config shape (matches npc_config.json) ────────────────────────────────────
export interface NPCConfig {
  backend_url: string;
  default_npc: {
    npc_id: string;
    npc_name: string;
    npc_identity: string;
    voice_id: string;
    greeting: string;
  };
}

// ── Backend request / response types ─────────────────────────────────────────
interface BackendNPCResponse {
  dialogue: string;
  emotion: string;
  trust_score: number;
  action_trigger: string;
  audio_url: string | null;
}

interface ConversationEntry {
  role: string;
  content: string;
}

interface NPCMemory {
  short_term: string[];
  long_term_summary: string;
  relationship_history: string[];
}

// ── Service ───────────────────────────────────────────────────────────────────
export class AIService {
  private config!: NPCConfig;
  private isLoaded = false;

  // ── Active NPC (set per-interaction via setActiveNPC) ────────────────────
  private activeNpcId = "";
  private activeNpcName = "";
  private activeNpcIdentity = "";
  private activeNpcGreeting = "";
  private activeVoiceId = "";

  // ── Persistent NPC state (reset each new conversation) ───────────────────
  private trustScore = 5;
  private emotion = "NEUTRAL";
  private memory: NPCMemory = { short_term: [], long_term_summary: "", relationship_history: [] };
  private conversationHistory: ConversationEntry[] = [];

  // ─────────────────────────────────────────────────────────────────────────

  /** Load npc_config.json and prime the default NPC. */
  public async loadConfig(): Promise<void> {
    try {
      const response = await fetch("/npc_config.json");
      this.config = (await response.json()) as NPCConfig;
      this.isLoaded = true;

      // Prime active NPC with defaults so the service is usable immediately
      const d = this.config.default_npc;
      this.activeNpcId       = d.npc_id;
      this.activeNpcName     = d.npc_name;
      this.activeNpcIdentity = d.npc_identity;
      this.activeNpcGreeting = d.greeting;
      this.activeVoiceId     = d.voice_id;

      console.log("[AIService] Config loaded. Backend:", this.config.backend_url);
    } catch (err) {
      console.error("[AIService] Failed to load npc_config.json:", err);
      throw err;
    }
  }

  /**
   * Switch the active NPC before opening chat.
   * Only clears the conversation history; trust/emotion/memory are
   * restored separately via restoreState() from WorldService.
   */
  public setActiveNPC(
    npcId: string,
    npcName: string,
    npcIdentity: string,
    greeting: string,
    voiceId?: string,
  ): void {
    this.activeNpcId       = npcId;
    this.activeNpcName     = npcName;
    this.activeNpcIdentity = npcIdentity;
    this.activeNpcGreeting = greeting;
    this.activeVoiceId     = voiceId ?? this.config?.default_npc?.voice_id ?? "";
    // Only clear dialogue history — trust/emotion/memory persist via WorldService
    this.conversationHistory = [];
    console.log(`[AIService] Active NPC → ${npcName} (${npcId})`);
  }

  /**
   * Restore persisted NPC state (trust, emotion, memory) — typically
   * loaded from WorldService when re-opening a conversation.
   */
  public restoreState(trust: number, emotion: string, memory: NPCMemory): void {
    this.trustScore = trust;
    this.emotion    = emotion;
    this.memory     = { ...memory };
    console.log(`[AIService] State restored | trust=${trust} | emotion=${emotion} | memory_short=${memory.short_term.length}`);
  }

  public getConfig(): NPCConfig        { return this.config; }
  public getGreeting(): string         { return this.activeNpcGreeting; }
  public getNPCName(): string          { return this.activeNpcName; }
  public getEmotion(): string          { return this.emotion; }
  public getTrustScore(): number       { return this.trustScore; }
  public getActiveNpcId(): string      { return this.activeNpcId; }
  public getMemory(): NPCMemory        { return { ...this.memory }; }

  /** Send a player message and return the NPC's dialogue. */
  public async sendMessage(userMessage: string): Promise<string> {
    if (!this.isLoaded) {
      throw new Error("AIService config not loaded. Call loadConfig() first.");
    }

    try {
      const result = await this.callBackend(userMessage);

      // Update NPC state from response
      this.trustScore = result.trust_score;
      this.emotion    = result.emotion;

      // Grow short-term memory (capped at 20 entries)
      this.memory.short_term.push(`Player: ${userMessage}`);
      this.memory.short_term.push(`NPC: ${result.dialogue}`);
      if (this.memory.short_term.length > 20) {
        this.memory.short_term = this.memory.short_term.slice(-20);
      }

      // Keep conversation history for follow-up context
      this.conversationHistory.push({ role: "player", content: userMessage });
      this.conversationHistory.push({ role: "npc",    content: result.dialogue });

      // Play TTS audio if the backend provided a URL
      if (result.audio_url) {
        this.playAudio(result.audio_url);
      }

      console.log(`[AIService] NPC response | emotion=${result.emotion} | trust=${result.trust_score} | action=${result.action_trigger}`);
      return result.dialogue;

    } catch (err) {
      console.error("[AIService] Backend call failed, using fallback:", err);
      return this.getMockResponse(userMessage);
    }
  }

  /** POST to /api/npc/react and return the parsed response. */
  private async callBackend(userMessage: string): Promise<BackendNPCResponse> {
    const baseUrl = this.config.backend_url.replace(/\/$/, "");

    const payload = {
      npc_id:               this.activeNpcId,
      npc_identity:         this.activeNpcIdentity,
      voice_id:             this.activeVoiceId,
      memory:               this.memory,
      trust_score:          this.trustScore,
      emotion:              this.emotion,
      world_state:          worldService.getWorldState(),
      recent_events:        [{ source: "player", action: userMessage, time: Math.floor(Date.now() / 1000) }],
      conversation_history: this.conversationHistory,
    };

    const response = await fetch(`${baseUrl}/api/npc/react`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      throw new Error(`Backend error: ${response.status} ${response.statusText}`);
    }

    return response.json() as Promise<BackendNPCResponse>;
  }

  private playAudio(url: string): void {
    try {
      const audio = new Audio(url);
      audio.play().catch((e) => console.warn("[AIService] Audio play failed:", e));
    } catch (e) {
      console.warn("[AIService] Could not create Audio element:", e);
    }
  }

  /** Fallback responses when the backend is unreachable. */
  private getMockResponse(userMessage: string): string {
    const lower = userMessage.toLowerCase();
    if (lower.includes("hello") || lower.includes("hi") || lower.includes("hey")) {
      return "Greetings, traveler. The road has been long, but you've found your way here. What questions weigh upon your mind?";
    }
    if (lower.includes("name")) {
      return `I am called ${this.activeNpcName}. A name given to me by the old winds of the eastern valleys.`;
    }
    if (lower.includes("quest") || lower.includes("help")) {
      return "Seek the three ancient stones hidden across this land. Only then will the path forward reveal itself. But beware — not all paths are meant to be walked.";
    }
    if (lower.includes("bye") || lower.includes("goodbye")) {
      return "Safe travels, wanderer. May the stars guide your way through the darkest of nights.";
    }
    return "Hmm, an interesting thought. The world holds many mysteries, and I sense you are destined to unravel more than a few of them.";
  }
}
