import { Engine, Scene, Vector3, KeyboardEventTypes, Color4 } from "@babylonjs/core";
import { Environment } from "./Environment";
import { AssetLoader } from "./AssetLoader";
import { CityBuilder } from "./CityBuilder";
import { PlayerController } from "./PlayerController";
import { NPCController } from "./NPCController";
import { AIService } from "./AIService";
import { ChatUI } from "./ChatUI";

export class Game {
  private engine: Engine;
  private scene: Scene;
  private canvas: HTMLCanvasElement;

  private environment!: Environment;
  private cityBuilder!: CityBuilder;
  private playerController!: PlayerController;
  private npcController!: NPCController;
  private aiService!: AIService;
  private chatUI!: ChatUI;

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

    // 3. AI Service
    this.aiService = new AIService();
    await this.aiService.loadConfig();

    // 4. Chat UI
    this.chatUI = new ChatUI(this.aiService);

    // 5. Load assets
    const assetLoader = new AssetLoader(this.scene);

    const [playerAsset, npcAsset] = await Promise.all([
      assetLoader.loadModel("player.glb", "player"),
      assetLoader.loadModel("npc.glb", "npc"),
    ]);

    // 5. Player — keep the Y offset from AssetLoader, only set XZ
    playerAsset.rootMesh.position.x = 0;
    playerAsset.rootMesh.position.z = 0;

    // Debug: log available animations so we can see what the GLB contains
    console.log("[Game] Player animation groups:", playerAsset.animationGroups.map(g => g.name));
    console.log("[Game] NPC animation groups:", npcAsset.animationGroups.map(g => g.name));

    this.playerController = new PlayerController(
      this.scene,
      playerAsset.rootMesh,
      playerAsset.animationGroups,
      this.canvas,
      this.environment.shadowGenerator
    );

    // 6. NPC
    this.npcController = new NPCController(
      this.scene,
      npcAsset.rootMesh,
      npcAsset.animationGroups,
      new Vector3(5, 0, 5),
      this.environment.shadowGenerator
    );

    // 7. Interaction input (E key)
    this.setupInteractionInput();

    // 8. Chat close callback — re-enable game input
    this.chatUI.onClose(() => {
      // Nothing extra needed; input is already filtered when chat is open
    });

    // 9. Register the game update loop
    this.scene.onBeforeRenderObservable.add(() => {
      if (!this.chatUI.getIsOpen()) {
        this.playerController.update();
      }
      this.npcController.update(this.playerController.getPosition());
    });

    // 10. Start render loop
    this.engine.runRenderLoop(() => {
      this.scene.render();
    });

    // Hide loading screen
    const loadingEl = document.getElementById("loading-screen");
    if (loadingEl) {
      loadingEl.style.opacity = "0";
      setTimeout(() => loadingEl.remove(), 500);
    }
  }

  private setupInteractionInput(): void {
    this.scene.onKeyboardObservable.add((kbInfo) => {
      if (kbInfo.type === KeyboardEventTypes.KEYDOWN && kbInfo.event.key.toLowerCase() === "e") {
        if (this.chatUI.getIsOpen()) {
          return; // Don't re-open while already open
        }
        if (this.npcController.getIsPlayerNear()) {
          this.npcController.hidePromptForce();
          document.exitPointerLock();
          this.chatUI.open();
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
