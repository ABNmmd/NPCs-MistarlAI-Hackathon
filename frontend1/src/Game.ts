import { Engine, Scene, Vector3, KeyboardEventTypes, Color4 } from "@babylonjs/core";
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
import { ConfigManager } from "../ConfigManager.js";
// @ts-ignore
import { AIBridge } from "../AIBridge.js";

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

    // ── 11. Chat close callback ───────────────────────────────────────────────
    this.chatUI.onClose(() => {
      if (this._activeNpcId) {
        this.npcManager.stopTalking(this._activeNpcId);
        this._activeNpcId = null;
      }
    });
    // NPC listens while player is typing, talks when responding
    this.chatUI.onPlayerSend(() => {
      if (this._activeNpcId) this.npcManager.startListening(this._activeNpcId);
    });
    this.chatUI.onNPCResponse(() => {
      if (this._activeNpcId) this.npcManager.startTalking(this._activeNpcId, 3500);
    });

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

  // ──────────────────────────────────────────────────────────────────────────

  private setupInteractionInput(): void {
    // Track interaction prompt state
    const promptEl = document.getElementById("interaction-prompt");

    this.scene.onKeyboardObservable.add((kbInfo) => {
      if (kbInfo.type !== KeyboardEventTypes.KEYDOWN) return;
      const key = kbInfo.event.key;

      // E — interact with nearest NPC
      if (key.toLowerCase() === "e") {
        if (this.chatUI.getIsOpen()) return;

        const nearby = this.npcManager.getNearbyNPCs(this.playerController.getPosition());
        if (nearby.length > 0) {
          this._activeNpcId = nearby[0];
          promptEl?.classList.remove("visible");
          document.exitPointerLock();
          this.npcManager.startTalking(this._activeNpcId, 2500); // greeting → auto listen
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

  private handleResize(): void {
    window.addEventListener("resize", () => this.engine.resize());
  }
}

