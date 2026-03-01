import { Engine, Scene, Vector3, KeyboardEventTypes, Color4 } from "@babylonjs/core";
import { Environment } from "./Environment";
import { AssetLoader } from "./AssetLoader";
import type { LoadedAsset } from "./AssetLoader";
import { CityBuilder } from "./CityBuilder";
import { PlayerController } from "./PlayerController";
import { NPCController } from "./NPCController";
import { BackendService } from "./BackendService";
import { ChatUI } from "./ChatUI";
import { WorldManager } from "./WorldManager";
import { HUD } from "./HUD";
import type { GameConfig } from "./types";

export class Game {
  private engine: Engine;
  private scene: Scene;
  private canvas: HTMLCanvasElement;

  private environment!: Environment;
  private cityBuilder!: CityBuilder;
  private playerController!: PlayerController;
  private npcs: Map<string, NPCController> = new Map();
  private backendService!: BackendService;
  private chatUI!: ChatUI;
  private worldManager!: WorldManager;
  private hud!: HUD;
  private assetLoader!: AssetLoader;

  constructor(canvasId: string) {
    this.canvas = document.getElementById(canvasId) as HTMLCanvasElement;
    this.engine = new Engine(this.canvas, true, { preserveDrawingBuffer: true, stencil: true });
    this.scene = new Scene(this.engine);

    // Sky color
    this.scene.clearColor = new Color4(0.53, 0.7, 0.85, 1);

    // Enable collisions globally
    this.scene.collisionsEnabled = true;
    this.scene.gravity = new Vector3(0, -0.05, 0);

    this.handleResize();
  }

  /**
   * Initialize all systems and start the game loop.
   */
  public async start(): Promise<void> {
    // 1. Environment
    this.environment = new Environment(this.scene);
    this.environment.setup();

    // 2. City
    this.cityBuilder = new CityBuilder(this.scene, this.environment.shadowGenerator);
    await this.cityBuilder.build();

    // 3. Backend Service
    this.backendService = new BackendService();
    const config = await this.backendService.loadConfig();

    // 4. HUD
    this.hud = new HUD();

    // 5. World Manager
    this.worldManager = new WorldManager(
      this.backendService,
      this.hud,
      config.world_defaults
    );
    this.setupWorldActionHandlers();

    // 6. Chat UI
    this.chatUI = new ChatUI(this.backendService);
    this.chatUI.setWorldStateGetter(() => this.worldManager.getWorldState());

    // 7. Load assets
    this.assetLoader = new AssetLoader(this.scene);

    const [playerAsset, npcAsset] = await Promise.all([
      this.assetLoader.loadModel("player.glb", "player"),
      this.assetLoader.loadModel("npc.glb", "npc"),
    ]);

    // Player — keep the Y offset from AssetLoader, only set XZ
    playerAsset.rootMesh.position.x = 0;
    playerAsset.rootMesh.position.z = 0;

    console.log("[Game] Player animation groups:", playerAsset.animationGroups.map(g => g.name));
    console.log("[Game] NPC animation groups:", npcAsset.animationGroups.map(g => g.name));

    this.playerController = new PlayerController(
      this.scene,
      playerAsset.rootMesh,
      playerAsset.animationGroups,
      this.canvas,
      this.environment.shadowGenerator
    );

    // 8. Spawn NPCs from config
    this.spawnNPCsFromConfig(config, npcAsset);

    // 9. Interaction input (E key)
    this.setupInteractionInput();

    // 10. Chat close callback
    this.chatUI.onClose(() => {
      // Nothing extra needed; input is already filtered when chat is open
    });

    // 11. Register the game update loop
    this.scene.onBeforeRenderObservable.add(() => {
      if (!this.chatUI.getIsOpen()) {
        this.playerController.update();
      }
      const playerPos = this.playerController.getPosition();
      for (const npc of this.npcs.values()) {
        npc.update(playerPos);
      }
    });

    // 12. Start render loop
    this.engine.runRenderLoop(() => {
      this.scene.render();
    });

    // 13. Start world tick loop (every 30 seconds)
    this.worldManager.startTickLoop(30000);

    // 14. Check backend health
    const backendOk = await this.backendService.healthCheck();
    if (!backendOk) {
      console.warn("[Game] Backend not reachable — NPC chat will use fallback responses");
    }

    // Hide loading screen
    const loadingEl = document.getElementById("loading-screen");
    if (loadingEl) {
      loadingEl.style.opacity = "0";
      setTimeout(() => loadingEl.remove(), 500);
    }
  }

  /**
   * Spawn NPCs from the config file. First NPC uses the loaded asset directly,
   * subsequent NPCs use cloned meshes.
   */
  private spawnNPCsFromConfig(config: GameConfig, firstNpcAsset: LoadedAsset): void {
    for (let i = 0; i < config.npcs.length; i++) {
      const npcConfig = config.npcs[i];

      // Use the original asset for the first NPC, clone for subsequent
      const asset = i === 0
        ? firstNpcAsset
        : this.assetLoader.cloneModel(firstNpcAsset, npcConfig.id);

      const npc = new NPCController(
        this.scene,
        asset.rootMesh,
        asset.animationGroups,
        new Vector3(npcConfig.spawn.x, 0, npcConfig.spawn.z),
        npcConfig,
        this.environment.shadowGenerator
      );

      this.npcs.set(npcConfig.id, npc);
      this.backendService.registerNPC(npcConfig);

      console.log(`[Game] Spawned NPC "${npcConfig.id}" at (${npcConfig.spawn.x}, ${npcConfig.spawn.z})`);
    }

    // Update world manager with active NPCs
    this.updateWorldManagerNPCs();
  }

  /**
   * Sync the NPC list to the WorldManager.
   */
  private updateWorldManagerNPCs(): void {
    const npcList = Array.from(this.npcs.entries()).map(([id, npc]) => ({
      id,
      type: npc.getConfig().type,
      location: `${npc.getNPCPosition().x.toFixed(0)},${npc.getNPCPosition().z.toFixed(0)}`,
      mood: this.backendService.getNPCState(id)?.emotion ?? "NEUTRAL",
    }));
    this.worldManager.setActiveNPCs(npcList);
  }

  /**
   * Register handlers for world orchestrator actions.
   */
  private setupWorldActionHandlers(): void {
    this.worldManager.onAction("change_weather", (action) => {
      const condition = action.condition as string;
      if (condition) {
        this.environment.setWeather(condition);
      }
    });

    this.worldManager.onAction("update_tension", (action) => {
      console.log(`[Game] Tension updated to ${action.level}`);
    });

    this.worldManager.onAction("trigger_event", (action) => {
      console.log(`[Game] Event triggered: ${action.event_name} at ${action.location}`);
    });

    this.worldManager.onAction("spawn_npc", (action) => {
      console.log(`[Game] NPC spawn requested: ${action.npc_type} at ${action.location}`);
      // Dynamic NPC spawning could be implemented here in the future
    });

    this.worldManager.onAction("remove_npc", (action) => {
      console.log(`[Game] NPC removal requested: ${action.npc_id}`);
    });
  }

  private setupInteractionInput(): void {
    this.scene.onKeyboardObservable.add((kbInfo) => {
      if (kbInfo.type === KeyboardEventTypes.KEYDOWN && kbInfo.event.key.toLowerCase() === "e") {
        if (this.chatUI.getIsOpen()) {
          return;
        }

        // Find the nearest NPC that is in range
        for (const npc of this.npcs.values()) {
          if (npc.getIsPlayerNear()) {
            npc.hidePromptForce();
            document.exitPointerLock();
            this.chatUI.open(
              npc.getId(),
              npc.getNPCName(),
              npc.getGreeting()
            );

            // Add interaction event for the world manager
            this.worldManager.addEvent({
              source: "player",
              action: `Player approached and started talking to ${npc.getNPCName()}`,
              time: 0,
            });
            break;
          }
        }
      }

      // ESC to close chat
      if (kbInfo.type === KeyboardEventTypes.KEYDOWN && kbInfo.event.key === "Escape") {
        if (this.chatUI.getIsOpen()) {
          this.chatUI.close();
        }
      }
    });
  }

  private handleResize(): void {
    window.addEventListener("resize", () => {
      this.engine.resize();
    });
  }
}
