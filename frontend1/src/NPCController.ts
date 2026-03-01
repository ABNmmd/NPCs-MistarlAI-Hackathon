import { Scene, Mesh, Vector3, ShadowGenerator, AnimationGroup } from "@babylonjs/core";

export class NPCController {
  private interactionRadius = 3.5;
  private isPlayerNear = false;

  // UI elements
  private promptEl: HTMLElement;

  // Animation
  private idleAnim: AnimationGroup | null = null;

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
    for (const group of this.animationGroups) {
      const name = group.name.toLowerCase();
      if (name.includes("idle")) {
        this.idleAnim = group;
      }
    }
    this.animationGroups.forEach((g) => g.stop());
    this.idleAnim?.start(true);
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
