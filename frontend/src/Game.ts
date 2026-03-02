import { Engine, Scene, Vector3, KeyboardEventTypes, Color4 } from "@babylonjs/core";
import { worldService } from "./WorldService";
import { Environment } from "./Environment";
import { AssetLoader } from "./AssetLoader";
import { WorldManager } from "./WorldManager";
import { NPCManager } from "./NPCManager";
import { ManagementUI } from "./ManagementUI";
import { PlayerController } from "./PlayerController";
import { AIService } from "./AIService";
import { ChatUI } from "./ChatUI";

// ConfigManager and AIBridge are plain ES-module JS files in the project root.
// @ts-ignore
import { ConfigManager } from "./ConfigManager.js";
// @ts-ignore
import { AIBridge } from "./AIBridge.js";

// ── NPC type identity templates (used when orchestrator spawns new NPCs) ──────
const NPC_TYPE_IDENTITIES: Record<string, string> = {
  merchant:   "A shrewd traveling merchant with an eye for rare goods and a gift for persuasion. They have seen many lands and heard many secrets.",
  guard:      "A stern and vigilant guard, sworn to protect the settlement. Suspicious of strangers but fair in their judgments.",
  wanderer:   "A weathered traveler who has walked many roads. They carry stories of distant places and seem to be searching for something.",
  villager:   "A hardworking local who knows the rhythms of the land. Friendly but cautious, they value community above all.",
  healer:     "A gentle healer who tends to the sick and wounded. They speak softly but carry deep wisdom about the natural world.",
  blacksmith: "A burly artisan who shapes metal with practiced hands. Gruff but reliable, they take pride in their craft above all.",
};

export class Game {
  private engine: Engine;
  private scene: Scene;
  private canvas: HTMLCanvasElement;

  private environment!: Environment;
  private worldManager!: WorldManager;
  private npcManager!: NPCManager;
  private managementUI?: ManagementUI;
  private playerController!: PlayerController;
  private aiService!: AIService;
  private chatUI!: ChatUI;

  // AI integration
  private configManager: any;
  private aiBridge: any;

  constructor(canvasId: string) {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    this.engine = new Engine(this.canvas, true, { preserveDrawingBuffer: true, stencil: true });
    this.scene = new Scene(this.engine);

    // Default sky — overridden by world.json
    this.scene.clearColor = new Color4(0.55, 0.72, 0.92, 1);

    this.scene.collisionsEnabled = true;
    this.scene.gravity = new Vector3(0, -0.05, 0);

    this.handleResize();
  }

  /** Initialize all systems and start the game loop. */
  public async start(): Promise<void> {

    // ── 1. Load configs (world / player / npcs) via ConfigManager ────────────
    this.configManager = new ConfigManager();
    let worldConfig: any = {};
    let playerConfig: any = {};
    let npcsConfig: any = {};

    try {
      // Files in /public are served at root — basePath '' yields "/world.json" etc.
      await this.configManager.loadAll("");
      worldConfig  = this.configManager.get("world")  ?? {};
      playerConfig = this.configManager.get("player") ?? {};
      npcsConfig   = this.configManager.get("npcs")   ?? {};
      console.log("[Game] Configs loaded:", Object.keys(worldConfig));
    } catch (e) {
      console.warn("[Game] ConfigManager failed, using defaults.", e);
    }

    // ── 2. Environment (lighting / fog / sky / grass ground) ─────────────────
    this.environment = new Environment(this.scene);
    this.environment.setup(worldConfig);

    // ── 3. World Manager — builds forest from world.json objects ─────────────
    this.worldManager = new WorldManager(this.scene, this.environment.shadowGenerator);
    this.worldManager.setLightRefs(this.environment.hemiLight, this.environment.dirLight);

    if (Array.isArray(worldConfig.objects) && worldConfig.objects.length > 0) {
      this.worldManager.buildFromConfig(worldConfig.objects);
    }

    // ── 4. AI Service (LLM / mistral API) ────────────────────────────────────
    this.aiService = new AIService();
    await this.aiService.loadConfig();

    // ── 4.5. World Orchestrator Service ──────────────────────────────────────
    worldService.init(this.aiService.getConfig().backend_url);

    // ── 5. Chat UI ────────────────────────────────────────────────────────────
    this.chatUI = new ChatUI(this.aiService);

    // ── 6. Player ─────────────────────────────────────────────────────────────
    const assetLoader = new AssetLoader(this.scene);
    const playerAsset = await assetLoader.loadModel("player.glb", "player");

    // Spawn point from config
    const spawnKey = playerConfig?.spawnPoint ?? "default";
    const spawnPos: [number, number, number] = worldConfig?.spawnPoints?.[spawnKey] ?? [0, 0, 0];
    playerAsset.rootMesh.position.x = spawnPos[0];
    playerAsset.rootMesh.position.z = spawnPos[2];
    // Y is managed by AssetLoader's bounding-box correction

    console.log("[Game] Player animation groups:", playerAsset.animationGroups.map((g: any) => g.name));

    this.playerController = new PlayerController(
      this.scene,
      playerAsset.rootMesh,
      playerAsset.animationGroups,
      this.canvas,
      this.environment.shadowGenerator
    );

    // Apply stats from player.json
    if (playerConfig?.stats) {
      this.playerController.updateStats(playerConfig.stats);
    }

    // ── 7. NPC Manager ────────────────────────────────────────────────────────
    this.npcManager = new NPCManager(this.scene, this.environment.shadowGenerator);
    this.npcManager.setPlayerPositionGetter(() => this.playerController.getPosition());

    // Pre-load real NPC 3D model
    await this.npcManager.preloadModels(["npc.glb"]);

    if (npcsConfig && (npcsConfig.instances || npcsConfig.templates)) {
      this.npcManager.initialize(npcsConfig);
    }

    // Register live NPC instances with WorldService for orchestrator context
    if (npcsConfig?.instances) {
      for (const inst of npcsConfig.instances) {
        const pos = inst.position ?? [0, 0, 0];
        worldService.registerNPC(inst.id, {
          npc_identity:         inst.npc_identity ?? this.aiService.getConfig().default_npc.npc_identity,
          voice_id:             inst.voice_id     ?? this.aiService.getConfig().default_npc.voice_id,
          type:                 inst.template     ?? "villager",
          memory:               { short_term: [], long_term_summary: "", relationship_history: [] },
          trust_score:          5,
          emotion:              "NEUTRAL",
          location:             `${(pos as number[])[0]},${(pos as number[])[2]}`,
          conversation_history: [],
        });
      }
    }

    // ── 9. AI Bridge — exposes window.GameAI ──────────────────────────────────
    const gameEngine = {
      configManager: this.configManager,
      worldManager:  this.worldManager,
      npcManager:    this.npcManager,
      playerController: this.playerController,
    };

    this.aiBridge = new AIBridge(gameEngine);
    this.aiBridge.initialize();

    // Mirror config updates back to ConfigManager so getConfigs() stays fresh
    this.configManager.onChange((event: string, data: any) => {
      console.log("[Game] Config changed:", event, data);
    });

    // ── 10. Interaction input (E = chat, ESC = close, M = management UI) ─────
    this.managementUI = new ManagementUI(this.scene);
    this.setupInteractionInput();

    // ── 10.5. WorldService callbacks (orchestrator actions) ────────────────────
    worldService.onAction((action) => {
      // Backend sends { "action": "spawn_npc", ... } — the discriminator field is "action", not "type"
      switch (action.action as string) {
        case "spawn_npc": {
          const loc = action.location as any;
          // location from the orchestrator is a string area name (e.g. "downtown"), not an {x,z} object
          const pos: [number, number, number] = (loc && typeof loc === "object")
            ? [loc.x ?? 0, 0, loc.z ?? 0]
            : this._randomNearPlayerPosition();
          const spawnId = (action.npc_id as string) ?? `npc_${Date.now()}`;
          const npcType = (action.npc_type as string) ?? "wanderer";
          this.npcManager.spawnNPC({
            id:       spawnId,
            template: npcType,
            name:     npcType.charAt(0).toUpperCase() + npcType.slice(1),
            position: pos,
          });
          worldService.registerNPC(spawnId, {
            npc_identity:         NPC_TYPE_IDENTITIES[npcType] ?? `A ${npcType} who recently appeared in the area. Not much is known about them yet.`,
            voice_id:             "",
            type:                 npcType,
            memory:               { short_term: [], long_term_summary: "", relationship_history: [] },
            trust_score:          5,
            emotion:              "NEUTRAL",
            location:             `${pos[0]},${pos[2]}`,
            conversation_history: [],
          });
          this._showEventBanner(`A ${(action.npc_type as string) ?? "stranger"} appears!`);
          break;
        }
        case "remove_npc":
          if (action.npc_id) this.npcManager.removeNPC(action.npc_id as string);
          break;
        case "change_weather": {
          const condition = ((action.weather ?? action.condition ?? "clear") as string);
          this.environment.setWeather(condition, "gradual");
          worldService.setWeather(condition);
          this._showEventBanner(`The weather shifts: ${condition.replace("_", " ")}`);
          break;
        }
        case "trigger_event":
          this._showEventBanner(
            // Backend field is "event_name" (TriggerEventAction schema)
            (action.event_name ?? action.description ?? action.event ?? "Something stirs in the world...") as string
          );
          break;
        case "update_tension": {
          const level = typeof action.level === "number" ? action.level : 5;
          worldService.setTensionLevel(level);
          this.environment.hemiLight.intensity = Math.max(0.20, 0.55 - (level / 10) * 0.25);
          break;
        }
        default:
          break;
      }
    });

    worldService.onNarrator((text) => {
      this._showNarrator(text);
    });

    // Max distance at which a player can hear an NPC's orchestrator speech (units)
    const NPC_HEARING_RANGE = 12;

    worldService.onNPCDirective((result) => {
      const { npc_id, dialogue, audio_url } = result;
      if (!dialogue) return;
      // Skip speech if the player is too far away
      const dist = this.npcManager.getDistanceToNPC(npc_id, this.playerController.getPosition());
      if (dist > NPC_HEARING_RANGE) return;
      this.npcManager.npcSay(npc_id, dialogue);
      this.npcManager.startTalking(npc_id, 3500);
      // Guard against browser autoplay policy: audio from a timer (auto-tick) is blocked
      // until the user has interacted with the page at least once.
      if (audio_url && this._audioUnlocked) {
        try { new Audio(audio_url).play().catch((e) => console.warn("[Game] NPC audio play blocked:", e)); } catch {}
      }
    });

    // ── 11. Chat callbacks ────────────────────────────────────────────────────────
    this.chatUI.onClose(() => {
      if (this._activeNpcId) {
        this.npcManager.stopTalking(this._activeNpcId);
        worldService.setActiveChatNpc(null);
        this._activeNpcId = null;
      }
    });
    // NPC listens while player is typing, talks when responding
    this.chatUI.onPlayerSend((msg: string) => {
      if (this._activeNpcId) this.npcManager.startListening(this._activeNpcId);
      worldService.addEvent("player", `said to ${this._activeNpcId}: ${msg}`);
    });
    this.chatUI.onNPCResponse((_dialogue: string) => {
      if (this._activeNpcId) this.npcManager.startTalking(this._activeNpcId, 3500);
    });
    this.chatUI.onConversationEnd((npcId, trustBefore, trustAfter, emotion, memory) => {
      worldService.updateNPCState(npcId, { emotion, trust_score: trustAfter, memory });
      const delta = trustAfter - trustBefore;
      if (delta !== 0) {
        worldService.adjustPlayerKarma(delta * 2);
        this._updateKarmaHUD(worldService.getPlayerKarma());
      }
    });
    // ── 11.5. Start orchestrator auto-tick (every 45 s) ───────────────────
    worldService.startAutoTick(45_000);
    // ── 12. Game loop ─────────────────────────────────────────────────────────
    this.scene.onBeforeRenderObservable.add(() => {
      const dt = this.engine.getDeltaTime() / 1000;

      // Player movement always runs — WASD works while chat is open.
      // Mouse camera rotation requires pointer lock; WASD uses canvas keyboard events.
      this.playerController.update();

      this.npcManager.update(dt, this.playerController.getPosition());

      // Reposition speech bubbles
      const cam = this.scene.activeCamera;
      if (cam) this.npcManager.updateBubblePositions(cam);

      // Emit player position events periodically for AI systems
      // (every ~2s using accumulated time)
      this._posEventAccum = (this._posEventAccum ?? 0) + dt;
      if (this._posEventAccum >= 2) {
        this._posEventAccum = 0;
        const pos = this.playerController.getPosition();
        this.aiBridge?.emitPlayerEvent("playerMoved", { position: [pos.x, pos.y, pos.z] });
      }
    });

    // ── 13. Render ────────────────────────────────────────────────────────────
    this.engine.runRenderLoop(() => this.scene.render());

    // ── 14. Hide loading ──────────────────────────────────────────────────────
    const loadingEl = document.getElementById("loading-screen");
    if (loadingEl) {
      loadingEl.style.opacity = "0";
      setTimeout(() => loadingEl.remove(), 500);
    }

    console.log("[Game] Ready. AI API available at window.GameAI  |  Press M for Management UI");
  }

  // Track which NPC the player is currently chatting with
  private _activeNpcId: string | null = null;

  // Accumulated time for periodic events
  private _posEventAccum = 0;

  // Becomes true after the first user interaction; guards orchestrator audio against
  // browser autoplay policy (Audio.play() from a timer is blocked without prior gesture)
  private _audioUnlocked = false;

  // ──────────────────────────────────────────────────────────────────────────

  private setupInteractionInput(): void {
    // Track interaction prompt state
    const promptEl = document.getElementById("interaction-prompt");

    this.scene.onKeyboardObservable.add((kbInfo) => {
      if (kbInfo.type !== KeyboardEventTypes.KEYDOWN) return;
      const key = kbInfo.event.key;

      // Unlock audio on first key press so orchestrator NPC audio can play
      if (!this._audioUnlocked) this._audioUnlocked = true;

      // E — interact with nearest NPC
      if (key.toLowerCase() === "e") {
        if (this.chatUI.getIsOpen()) return;

        const nearby = this.npcManager.getNearbyNPCs(this.playerController.getPosition());
        if (nearby.length > 0) {
          this._activeNpcId = nearby[0];
          promptEl?.classList.remove("visible");
          document.exitPointerLock();

          // ── Resolve per-NPC identity and prime AIService ────────────────
          const npcInfo = this.npcManager.getNPC(this._activeNpcId);
          const rawNpcs = this.configManager.get("npcs");
          const rawInst = rawNpcs?.instances?.find((i: any) => i.id === this._activeNpcId);
          const npcIdentity =
            rawInst?.npc_identity ??
            this.aiService.getConfig().default_npc.npc_identity;
          const npcName    = npcInfo?.name    ?? this._activeNpcId;
          const greeting   = npcInfo?.greeting || this.aiService.getConfig().default_npc.greeting;
          const voiceId    = rawInst?.voice_id;
          this.aiService.setActiveNPC(this._activeNpcId, npcName, npcIdentity, greeting, voiceId);

          // Restore persisted trust / emotion / memory from WorldService
          const storedNpc = worldService.getNPCState(this._activeNpcId);
          if (storedNpc) {
            this.aiService.restoreState(
              storedNpc.trust_score,
              storedNpc.emotion,
              storedNpc.memory,
            );
          }
          // ───────────────────────────────────────────────────────────────

          this.npcManager.startTalking(this._activeNpcId, 2500); // greeting → auto listen
          worldService.setActiveChatNpc(this._activeNpcId);
          this.chatUI.open();
          // Emit event so AI systems know an interaction started
          this.aiBridge?.emitPlayerEvent("playerInteracted", {
            npcId: nearby[0],
            position: (() => { const p = this.playerController.getPosition(); return [p.x, p.y, p.z]; })()
          });
        }
      }

      // Escape — close chat
      if (key === "Escape" && this.chatUI.getIsOpen()) {
        this.chatUI.close();
      }

      // M — toggle management panel
      if (
        key.toLowerCase() === "m" &&
        !kbInfo.event.ctrlKey && !kbInfo.event.altKey &&
        document.activeElement?.tagName !== "INPUT" &&
        document.activeElement?.tagName !== "TEXTAREA"
      ) {
        this.managementUI?.toggle();
      }
    });

    // Update interaction prompt every frame
    this.scene.onBeforeRenderObservable.add(() => {
      if (this.chatUI.getIsOpen()) return;
      const nearby = this.npcManager.getNearbyNPCs(this.playerController.getPosition());
      if (nearby.length > 0) {
        promptEl?.classList.add("visible");
      } else {
        promptEl?.classList.remove("visible");
      }
    });
  }

  private _showNarrator(text: string): void {
    const el = document.getElementById("narrator-bar");
    if (!el) return;
    el.textContent = text;
    el.classList.add("visible");
    setTimeout(() => el.classList.remove("visible"), 6000);
  }

  private _showEventBanner(text: string): void {
    const el = document.getElementById("event-banner");
    if (!el) return;
    el.textContent = text;
    el.classList.add("visible");
    setTimeout(() => el.classList.remove("visible"), 4000);
  }

  private _updateKarmaHUD(karma: number): void {
    const el = document.getElementById("karma-value");
    if (!el) return;
    el.textContent = (karma >= 0 ? "+" : "") + karma.toFixed(0);
    el.style.color = karma > 20 ? "#4cdf70" : karma < -20 ? "#df4c4c" : "#ccc";
  }

  private _randomNearPlayerPosition(): [number, number, number] {
    const pos   = this.playerController.getPosition();
    const angle = Math.random() * Math.PI * 2;
    const dist  = 8 + Math.random() * 12;
    return [pos.x + Math.cos(angle) * dist, 0, pos.z + Math.sin(angle) * dist];
  }

  private handleResize(): void {
    window.addEventListener("resize", () => this.engine.resize());
  }
}

