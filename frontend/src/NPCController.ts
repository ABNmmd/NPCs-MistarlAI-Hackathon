import { Scene, Mesh, Vector3, ShadowGenerator, AnimationGroup } from "@babylonjs/core";

export class NPCController {
  private interactionRadius = 3.5;
  private isPlayerNear = false;

  // UI elements
  private promptEl: HTMLElement;

  // Animation — same nameMap as PlayerController
  private anims: Map<string, AnimationGroup> = new Map();
  private _isPlaying: "idle" | "walk" | "none" = "none";

  constructor(
    _scene: Scene,
    private mesh: Mesh,
    private animationGroups: AnimationGroup[],
    spawnPosition: Vector3,
    shadowGenerator?: ShadowGenerator
  ) {
    // Position the NPC — preserve the Y offset from AssetLoader, only set XZ
    this.mesh.position.x = spawnPosition.x;
    this.mesh.position.z = spawnPosition.z;

    // Collision
    this.mesh.checkCollisions = true;
    this.mesh.ellipsoid = new Vector3(0.5, 0.9, 0.5);
    this.mesh.ellipsoidOffset = new Vector3(0, 0.9, 0);

    // Shadow
    if (shadowGenerator) {
      this.mesh.getChildMeshes().forEach((child) => {
        shadowGenerator.addShadowCaster(child);
      });
      shadowGenerator.addShadowCaster(this.mesh);
    }

    // Setup idle animation
    this.setupAnimations();

    // Create interaction prompt (hidden by default)
    this.promptEl = document.getElementById("interaction-prompt")!;
  }

  private setupAnimations(): void {
    // Exact name map — mirrors PlayerController
    const nameMap: Record<string, string> = {
      "Idle_Loop":        "idle",
      "Walk_Loop":        "walk",
      "Jog_Fwd_Loop":    "jog",
      "Sprint_Loop":     "sprint",
      "Jump_Start":      "jumpStart",
      "Jump_Loop":       "jumpLoop",
      "Jump_Land":       "jumpLand",
      "Dance_Loop":      "dance",
      "Crouch_Idle_Loop": "crouchIdle",
      "Crouch_Fwd_Loop": "crouchWalk",
    };

    for (const group of this.animationGroups) {
      const role = nameMap[group.name];
      if (role) {
        this.anims.set(role, group);
        console.log(`[NPCController] Mapped "${group.name}" → "${role}"`);
      }
    }

    // Fuzzy fallbacks if exact names were not found
    if (!this.anims.has("idle")) {
      const fallback = this.animationGroups.find((g) => g.name.toLowerCase().includes("idle"));
      if (fallback) this.anims.set("idle", fallback);
    }
    if (!this.anims.has("walk")) {
      const fallback = this.animationGroups.find((g) =>
        g.name.toLowerCase().includes("walk") || g.name.toLowerCase().includes("run"));
      if (fallback) this.anims.set("walk", fallback);
    }

    this.animationGroups.forEach((g) => g.stop());
    this._playIdle();
  }

  /** Start the idle animation (looped). */
  private _playIdle(): void {
    if (this._isPlaying === "idle") return;
    this.anims.get("walk")?.stop();
    const idle = this.anims.get("idle");
    if (idle) idle.start(true, 1.0);
    this._isPlaying = "idle";
  }

  /** Start the walk animation (looped). */
  public playWalk(): void {
    if (this._isPlaying === "walk") return;
    this.anims.get("idle")?.stop();
    const walk = this.anims.get("walk");
    if (walk) {
      walk.start(true, 1.0);
    } else {
      // No walk clip — keep idle so NPC doesn't T-pose
      const idle = this.anims.get("idle");
      if (idle && !idle.isPlaying) idle.start(true, 1.0);
    }
    this._isPlaying = "walk";
  }

  /** Return to idle animation. */
  public playIdle(): void {
    this._playIdle();
  }

  /**
   * Check proximity to the player and show/hide interaction prompt.
   * Returns true if the player is within interaction range.
   */
  public update(playerPosition: Vector3): boolean {
    const distance = Vector3.Distance(this.mesh.position, playerPosition);
    const near = distance <= this.interactionRadius;

    if (near && !this.isPlayerNear) {
      this.isPlayerNear = true;
      this.showPrompt();
    } else if (!near && this.isPlayerNear) {
      this.isPlayerNear = false;
      this.hidePrompt();
    }

    return this.isPlayerNear;
  }

  private showPrompt(): void {
    this.promptEl.classList.add("visible");
  }

  private hidePrompt(): void {
    this.promptEl.classList.remove("visible");
  }

  public hidePromptForce(): void {
    this.promptEl.classList.remove("visible");
  }

  public getIsPlayerNear(): boolean {
    return this.isPlayerNear;
  }

  public getNPCPosition(): Vector3 {
    return this.mesh.position;
  }
}
