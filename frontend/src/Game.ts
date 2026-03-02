import { Engine, Scene, Vector3, KeyboardEventTypes, Color4, StandardMaterial, Color3, MeshBuilder, TransformNode, Mesh } from "@babylonjs/core";
import { worldService } from "./WorldService";
import { Environment } from "./Environment";
import { WorldManager } from "./WorldManager";
import { NPCManager } from "./NPCManager";
import { ManagementUI } from "./ManagementUI";
import { PlayerController } from "./PlayerController";
import { AIService } from "./AIService";
import { ChatUI } from "./ChatUI";
import { questManager, type DeferredNpc } from "./QuestManager";
import { TownBuilder } from "./TownBuilder";

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

    // ── 3.5. Town Builder — procedural town with NPC-specific buildings ──────
    const townBuilder = new TownBuilder(this.scene, this.environment.shadowGenerator);
    const npcPlacements = townBuilder.build();
    console.log("[Game] Town built. NPC placements:", npcPlacements);

    // ── 4. AI Service (LLM / mistral API) ────────────────────────────────────
    this.aiService = new AIService();
    await this.aiService.loadConfig();

    // ── 4.5. World Orchestrator Service ──────────────────────────────────────
    worldService.init(this.aiService.getConfig().backend_url);

    // ── 5. Chat UI ────────────────────────────────────────────────────────────
    this.chatUI = new ChatUI(this.aiService);

    // ── 6. Player (Procedural mesh matching NPC physique) ────────────────────
    const spawnKey = playerConfig?.spawnPoint ?? "default";
    const spawnPos: [number, number, number] = worldConfig?.spawnPoints?.[spawnKey] ?? [0, 0, 0];
    
    const playerMesh = this._buildProceduralPlayer();
    playerMesh.position.x = spawnPos[0];
    playerMesh.position.z = spawnPos[2];

    console.log("[Game] Player created with procedural mesh (same physique as NPCs)");

    this.playerController = new PlayerController(
      this.scene,
      playerMesh,
      [], // No animation groups for procedural mesh
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

    // Skip GLB preloading to use procedural character meshes with unique appearances
    // await this.npcManager.preloadModels(["npc.glb"]);

    if (npcsConfig && (npcsConfig.instances || npcsConfig.templates)) {
      this.npcManager.initialize(npcsConfig);
    }

    // ── 7.5. Reposition NPCs to stand in front of their town buildings ───────
    // TownBuilder computed placement positions; apply them to matching NPCs.
    if (npcPlacements.length > 0) {
      for (const placement of npcPlacements) {
        // Find an NPC whose template matches this building's npcTemplate
        const npcRoots = this.npcManager.getNPCRoots();
        const npcRoot = npcRoots.find((r) => {
          const npcData = this.npcManager.getNPC(r.id);
          return npcData?.template === placement.npcTemplate;
        });
        if (npcRoot) {
          this.npcManager.teleportNPC(npcRoot.id, placement.position);
          console.log(`[Game] Placed ${npcRoot.id} at ${placement.buildingLabel}: [${placement.position[0].toFixed(1)}, ${placement.position[2].toFixed(1)}]`);
        }
      }
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

    // ── 8. Deferred NPC Spawning (NPCs spawn as quests progress) ──────────────
    if (npcsConfig?.deferredNpcs) {
      questManager.setDeferredNpcs(npcsConfig.deferredNpcs as DeferredNpc[]);
      
      // Listen for NPC spawn requests from quest system
      questManager.onEvent((event, data) => {
        if (event === "npcSpawnRequested" && data.npc) {
          const npc = data.npc as DeferredNpc;
          console.log(`[Game] Spawning deferred NPC: ${npc.name}`);
          
          // Spawn in the game world
          this.npcManager.spawnNPC({
            id: npc.id,
            name: npc.name,
            template: npc.template,
            position: npc.position,
            npc_identity: npc.npc_identity,
            voice_id: npc.voice_id,
            overrides: npc.overrides,
          });
          
          // Register with WorldService
          worldService.registerNPC(npc.id, {
            npc_identity:         npc.npc_identity,
            voice_id:             npc.voice_id ?? "aura-luna-en",
            type:                 npc.template,
            memory:               { short_term: [], long_term_summary: "", relationship_history: [] },
            trust_score:          5,
            emotion:              "NEUTRAL",
            location:             `${npc.position[0]},${npc.position[2]}`,
            conversation_history: [],
          });
        }
      });
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
        // Check karma-based quest objectives
        questManager.checkKarmaObjectives(worldService.getPlayerKarma());
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
        
        // Update quest indicators on NPCs
        this._updateQuestIndicators();
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

          // ── Quest system: track NPC conversation ────────────────────────
          const npcTemplate = npcInfo?.template ?? rawInst?.template ?? "villager";
          console.log(`[Game] Talked to NPC: id="${this._activeNpcId}", template="${npcTemplate}", npcInfo=`, npcInfo);
          questManager.onTalkToNPC(this._activeNpcId, npcTemplate);
          questManager.checkKarmaObjectives(worldService.getPlayerKarma());
          // ────────────────────────────────────────────────────────────────

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

  /** Update quest indicators (!, ?, ✓) above NPC heads based on quest states */
  private _updateQuestIndicators(): void {
    const indicators = questManager.getQuestIndicators();
    for (const [npcId, indicatorType] of indicators) {
      this.npcManager.setQuestIndicator(npcId, indicatorType);
    }
  }

  private _randomNearPlayerPosition(): [number, number, number] {
    const pos   = this.playerController.getPosition();
    const angle = Math.random() * Math.PI * 2;
    const dist  = 8 + Math.random() * 12;
    return [pos.x + Math.cos(angle) * dist, 0, pos.z + Math.sin(angle) * dist];
  }

  /**
   * Build procedural player mesh with same physique as NPCs but hero colors/accessories.
   * Returns a Mesh (invisible collision capsule) as root to support moveWithCollisions.
   */
  private _buildProceduralPlayer(): Mesh {
    // Create an invisible collision capsule as the root mesh
    // This is needed because PlayerController uses mesh.moveWithCollisions()
    const root = MeshBuilder.CreateCapsule("player_root", 
      { height: 1.8, radius: 0.4, tessellation: 8 }, this.scene);
    root.isVisible = false; // Invisible - only for collision
    root.position.y = 0.9; // Center the capsule
    
    // Create a visual container that will hold all visible parts
    const visualRoot = new TransformNode("player_visual", this.scene);
    visualRoot.position.y = -0.9; // Offset to align with collision capsule
    visualRoot.parent = root;
    
    // Same body dimensions as NPCs
    const bh = 1.75; // body height
    const bw = 0.5;  // body width
    const hd = 0.38; // head diameter

    // Hero color scheme - royal blue armor with gold accents
    const heroArmor: [number, number, number] = [0.15, 0.28, 0.55];
    const heroAccent: [number, number, number] = [0.75, 0.55, 0.20]; // Gold
    const heroSkin: [number, number, number] = [0.85, 0.70, 0.58];
    const heroHair: [number, number, number] = [0.18, 0.12, 0.08];
    const heroGlow: [number, number, number] = [0.03, 0.05, 0.10];

    // === TORSO (same as NPC) ===
    const torso = MeshBuilder.CreateCapsule("player_torso",
      { height: bh * 0.55, radius: bw * 0.32, tessellation: 16, subdivisions: 4 }, this.scene);
    torso.position.y = bh * 0.45;
    torso.parent = visualRoot;
    const torsoMat = new StandardMaterial("player_torso_mat", this.scene);
    torsoMat.diffuseColor = new Color3(heroArmor[0], heroArmor[1], heroArmor[2]);
    torsoMat.specularColor = new Color3(0.35, 0.38, 0.45);
    torsoMat.emissiveColor = new Color3(heroGlow[0], heroGlow[1], heroGlow[2]);
    torso.material = torsoMat;

    // === LEGS (same as NPC) ===
    const legHeight = bh * 0.35;
    const legRadius = bw * 0.12;
    const leftLeg = MeshBuilder.CreateCapsule("player_leg_l",
      { height: legHeight, radius: legRadius, tessellation: 12 }, this.scene);
    leftLeg.position.set(-bw * 0.18, legHeight / 2, 0);
    leftLeg.parent = visualRoot;
    const rightLeg = MeshBuilder.CreateCapsule("player_leg_r",
      { height: legHeight, radius: legRadius, tessellation: 12 }, this.scene);
    rightLeg.position.set(bw * 0.18, legHeight / 2, 0);
    rightLeg.parent = visualRoot;
    const legMat = new StandardMaterial("player_leg_mat", this.scene);
    legMat.diffuseColor = new Color3(heroArmor[0] * 0.75, heroArmor[1] * 0.75, heroArmor[2] * 0.75);
    leftLeg.material = legMat;
    rightLeg.material = legMat;

    // === ARMS (same as NPC) ===
    const armHeight = bh * 0.32;
    const armRadius = bw * 0.09;
    const leftArm = MeshBuilder.CreateCapsule("player_arm_l",
      { height: armHeight, radius: armRadius, tessellation: 10 }, this.scene);
    leftArm.position.set(-bw * 0.42, bh * 0.52, 0);
    leftArm.rotation.z = 0.2;
    leftArm.parent = visualRoot;
    const rightArm = MeshBuilder.CreateCapsule("player_arm_r",
      { height: armHeight, radius: armRadius, tessellation: 10 }, this.scene);
    rightArm.position.set(bw * 0.42, bh * 0.52, 0);
    rightArm.rotation.z = -0.2;
    rightArm.parent = visualRoot;
    const armMat = new StandardMaterial("player_arm_mat", this.scene);
    armMat.diffuseColor = new Color3(heroSkin[0], heroSkin[1], heroSkin[2]);
    leftArm.material = armMat;
    rightArm.material = armMat;

    // === HEAD (same as NPC) ===
    const head = MeshBuilder.CreateSphere("player_head",
      { diameter: hd, segments: 20 }, this.scene);
    head.position.y = bh + hd * 0.3;
    head.parent = visualRoot;
    const headMat = new StandardMaterial("player_head_mat", this.scene);
    headMat.diffuseColor = new Color3(heroSkin[0], heroSkin[1], heroSkin[2]);
    headMat.specularColor = new Color3(0.08, 0.06, 0.05);
    head.material = headMat;

    // === EYES (same as NPC) ===
    const eyeOffset = hd * 0.18;
    const eyeSize = hd * 0.12;
    const leftEye = MeshBuilder.CreateSphere("player_eye_l", { diameter: eyeSize, segments: 8 }, this.scene);
    leftEye.position.set(-eyeOffset, bh + hd * 0.35, hd * 0.38);
    leftEye.parent = visualRoot;
    const rightEye = MeshBuilder.CreateSphere("player_eye_r", { diameter: eyeSize, segments: 8 }, this.scene);
    rightEye.position.set(eyeOffset, bh + hd * 0.35, hd * 0.38);
    rightEye.parent = visualRoot;
    const eyeMat = new StandardMaterial("player_eye_mat", this.scene);
    eyeMat.diffuseColor = new Color3(0.95, 0.95, 0.95);
    eyeMat.emissiveColor = new Color3(0.1, 0.1, 0.1);
    leftEye.material = eyeMat;
    rightEye.material = eyeMat;

    // Pupils
    const pupilSize = eyeSize * 0.5;
    const leftPupil = MeshBuilder.CreateSphere("player_pupil_l", { diameter: pupilSize, segments: 6 }, this.scene);
    leftPupil.position.set(-eyeOffset, bh + hd * 0.35, hd * 0.42);
    leftPupil.parent = visualRoot;
    const rightPupil = MeshBuilder.CreateSphere("player_pupil_r", { diameter: pupilSize, segments: 6 }, this.scene);
    rightPupil.position.set(eyeOffset, bh + hd * 0.35, hd * 0.42);
    rightPupil.parent = visualRoot;
    const pupilMat = new StandardMaterial("player_pupil_mat", this.scene);
    pupilMat.diffuseColor = new Color3(0.12, 0.35, 0.55); // Blue eyes for hero
    leftPupil.material = pupilMat;
    rightPupil.material = pupilMat;

    // === HAIR (hero style - short styled) ===
    const hairMat = new StandardMaterial("player_hair_mat", this.scene);
    hairMat.diffuseColor = new Color3(heroHair[0], heroHair[1], heroHair[2]);
    hairMat.specularColor = new Color3(0.18, 0.15, 0.12);
    const hair = MeshBuilder.CreateSphere("player_hair",
      { diameter: hd * 1.05, segments: 12, slice: 0.55 }, this.scene);
    hair.position.y = bh + hd * 0.42;
    hair.rotation.x = 0.1;
    hair.parent = visualRoot;
    hair.material = hairMat;

    // =====================================================
    // HERO-SPECIFIC ACCESSORIES (different from NPCs)
    // =====================================================

    // === GOLD SHOULDER PAULDRONS ===
    const pauldronMat = new StandardMaterial("player_pauldron_mat", this.scene);
    pauldronMat.diffuseColor = new Color3(heroAccent[0], heroAccent[1], heroAccent[2]);
    pauldronMat.specularColor = new Color3(0.9, 0.75, 0.4);
    pauldronMat.emissiveColor = new Color3(0.08, 0.06, 0.02);
    pauldronMat.specularPower = 64;
    
    const leftPauldron = MeshBuilder.CreateSphere("player_pauldron_l",
      { diameter: bw * 0.45, segments: 10 }, this.scene);
    leftPauldron.scaling.set(1.0, 0.6, 0.8);
    leftPauldron.position.set(-bw * 0.42, bh * 0.72, 0);
    leftPauldron.parent = visualRoot;
    leftPauldron.material = pauldronMat;
    
    const rightPauldron = MeshBuilder.CreateSphere("player_pauldron_r",
      { diameter: bw * 0.45, segments: 10 }, this.scene);
    rightPauldron.scaling.set(1.0, 0.6, 0.8);
    rightPauldron.position.set(bw * 0.42, bh * 0.72, 0);
    rightPauldron.parent = visualRoot;
    rightPauldron.material = pauldronMat;

    // === HERO CAPE (blue with gold trim) ===
    const capeMat = new StandardMaterial("player_cape_mat", this.scene);
    capeMat.diffuseColor = new Color3(heroArmor[0] * 0.8, heroArmor[1] * 0.8, heroArmor[2] * 0.8);
    capeMat.backFaceCulling = false;
    const cape = MeshBuilder.CreateCylinder("player_cape",
      { height: bh * 0.65, diameterTop: bw * 0.75, diameterBottom: bw * 1.0, tessellation: 8 }, this.scene);
    cape.position.set(0, bh * 0.42, -bw * 0.18);
    cape.scaling = new Vector3(1, 1, 0.4);
    cape.parent = visualRoot;
    cape.material = capeMat;

    // === GLOWING CHEST GEM (cyan/blue magical gem) ===
    const gemMat = new StandardMaterial("player_gem_mat", this.scene);
    gemMat.diffuseColor = new Color3(0.25, 0.75, 0.95);
    gemMat.emissiveColor = new Color3(0.12, 0.35, 0.45);
    gemMat.specularColor = new Color3(0.8, 0.9, 1.0);
    gemMat.specularPower = 128;
    const chestGem = MeshBuilder.CreatePolyhedron("player_gem",
      { type: 1, size: bw * 0.12 }, this.scene);
    chestGem.position.set(0, bh * 0.58, bw * 0.32);
    chestGem.rotation.y = Math.PI / 4;
    chestGem.parent = visualRoot;
    chestGem.material = gemMat;

    // === GLOWING AURA RING AT FEET ===
    const auraRing = MeshBuilder.CreateTorus("player_aura",
      { diameter: 1.8, thickness: 0.06, tessellation: 32 }, this.scene);
    const auraMat = new StandardMaterial("player_aura_mat", this.scene);
    auraMat.diffuseColor = new Color3(0.3, 0.5, 0.9);
    auraMat.emissiveColor = new Color3(0.15, 0.28, 0.55);
    auraMat.alpha = 0.5;
    auraRing.material = auraMat;
    auraRing.position.y = 0.03;
    auraRing.parent = visualRoot;

    // === GOLD BELT/SASH ===
    const beltMat = new StandardMaterial("player_belt_mat", this.scene);
    beltMat.diffuseColor = new Color3(heroAccent[0], heroAccent[1], heroAccent[2]);
    beltMat.specularColor = new Color3(0.85, 0.7, 0.35);
    const belt = MeshBuilder.CreateTorus("player_belt",
      { diameter: bw * 0.72, thickness: bw * 0.08, tessellation: 24 }, this.scene);
    belt.rotation.x = Math.PI / 2;
    belt.position.y = bh * 0.28;
    belt.parent = visualRoot;
    belt.material = beltMat;

    // Add shadows to all meshes
    if (this.environment.shadowGenerator) {
      const childMeshes = root.getChildMeshes();
      for (const mesh of childMeshes) {
        this.environment.shadowGenerator.addShadowCaster(mesh);
        (mesh as Mesh).receiveShadows = true;
      }
    }

    return root;
  }

  private handleResize(): void {
    window.addEventListener("resize", () => this.engine.resize());
  }
}

