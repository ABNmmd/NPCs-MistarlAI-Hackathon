import { Scene, Mesh, ArcRotateCamera, Vector3, Quaternion, AnimationGroup, KeyboardEventTypes, ShadowGenerator, Animation, AbstractMesh } from "@babylonjs/core";

interface InputMap {
  [key: string]: boolean;
}

type AnimState = "idle" | "walk" | "sprint" | "jump" | "dance";

interface PlayerStats {
  health: number;
  maxHealth: number;
  stamina: number;
  maxStamina: number;
  [key: string]: any;
}

export class PlayerController {
  private inputMap: InputMap = {};
  private camera!: ArcRotateCamera;
  private walkSpeed = 3.0;
  private sprintSpeed = 7.0;
  private rotationLerp = 0.55;

  // Animations
  private anims: Map<string, AnimationGroup> = new Map();
  private currentState: AnimState = "idle";

  // Jump
  private isJumping = false;
  private jumpVelocity = 0;
  private readonly jumpForce = 6.0;
  private readonly gravity = -15.0;

  // Chat lock
  private locked = false;
  // Ground Y offset (set by bounding box correction in AssetLoader)
  private groundY = 0;
  // Player stats (set from player.json via updateStats)
  private stats: PlayerStats = { health: 100, maxHealth: 100, stamina: 100, maxStamina: 100 };

  // Action animations for procedural mesh
  private leftArm: AbstractMesh | null = null;
  private rightArm: AbstractMesh | null = null;
  private isPerformingAction = false;
  private actionCooldown = 0;

  constructor(
    private scene: Scene,
    private mesh: Mesh,
    private animationGroups: AnimationGroup[],
    private canvas: HTMLCanvasElement,
    shadowGenerator?: ShadowGenerator
  ) {
    this.setupCamera();
    this.setupInput();
    this.setupAnimations();
    this.setupCollisions();
    this.findProceduralParts();

    // Remember the corrected Y position as ground level
    this.groundY = this.mesh.position.y;

    if (shadowGenerator) {
      const childMeshes = this.mesh.getChildMeshes();
      for (const child of childMeshes) {
        shadowGenerator.addShadowCaster(child);
      }
    }
  }

  private setupCamera(): void {
    this.camera = new ArcRotateCamera(
      "followCam",
      -Math.PI / 2,
      Math.PI / 3,
      10,
      this.mesh.position,
      this.scene
    );
    this.camera.lowerRadiusLimit = 4;
    this.camera.upperRadiusLimit = 20;
    this.camera.lowerBetaLimit = 0.3;
    this.camera.upperBetaLimit = Math.PI / 2.2;
    this.camera.lockedTarget = this.mesh;

    // Detach built-in control — we drive the camera manually via pointer lock
    // so mouse movement is captured without holding a button.
    this.setupPointerLock();
  }

  private setupPointerLock(): void {
    const sensitivity = 0.003;
    const clickToPlay = document.getElementById("click-to-play");

    const requestLock = () => this.canvas.requestPointerLock();

    // The overlay sits on top of the canvas, so listen on both
    this.canvas.addEventListener("click", requestLock);
    clickToPlay?.addEventListener("click", requestLock);

    document.addEventListener("pointerlockchange", () => {
      if (document.pointerLockElement === this.canvas) {
        // Hide overlay permanently after the first successful lock
        if (clickToPlay) {
          clickToPlay.classList.add("hidden");
        }
      }
    });

    // Drive camera alpha/beta from raw mouse deltas
    document.addEventListener("mousemove", (e: MouseEvent) => {
      if (document.pointerLockElement !== this.canvas) return;
      this.camera.alpha -= e.movementX * sensitivity;
      this.camera.beta  -= e.movementY * sensitivity;
      // Clamp beta to the allowed range
      this.camera.beta = Math.max(0.3, Math.min(Math.PI / 2.2, this.camera.beta));
    });

    // Scroll wheel to zoom
    this.canvas.addEventListener("wheel", (e: WheelEvent) => {
      e.preventDefault();
      const newRadius = this.camera.radius + e.deltaY * 0.01;
      this.camera.radius = Math.max(4, Math.min(20, newRadius));
    }, { passive: false });
  }

  private setupInput(): void {
    this.scene.onKeyboardObservable.add((kbInfo) => {
      const key = kbInfo.event.key.toLowerCase();
      if (kbInfo.type === KeyboardEventTypes.KEYDOWN) {
        this.inputMap[key] = true;
      } else {
        this.inputMap[key] = false;
      }
    });
  }

  private setupAnimations(): void {
    // Map exact names from the GLB
    const nameMap: Record<string, string> = {
      "Idle_Loop": "idle",
      "Walk_Loop": "walk",
      "Jog_Fwd_Loop": "jog",
      "Sprint_Loop": "sprint",
      "Jump_Start": "jumpStart",
      "Jump_Loop": "jumpLoop",
      "Jump_Land": "jumpLand",
      "Dance_Loop": "dance",
      "Crouch_Idle_Loop": "crouchIdle",
      "Crouch_Fwd_Loop": "crouchWalk",
    };

    for (const group of this.animationGroups) {
      const mapped = nameMap[group.name];
      if (mapped) {
        this.anims.set(mapped, group);
        console.log(`[PlayerController] Mapped "${group.name}" → "${mapped}"`);
      }
    }

    // Stop all animations and start idle
    this.animationGroups.forEach((g) => g.stop());
    this.playAnim("idle", true);
  }

  private playAnim(name: string, loop: boolean = true, speed: number = 1.0): void {
    const anim = this.anims.get(name);
    if (anim) {
      anim.start(loop, speed);
    }
  }

  private stopAnim(name: string): void {
    const anim = this.anims.get(name);
    if (anim) {
      anim.stop();
    }
  }

  /**
   * Find arm meshes for procedural animations (punch, wave, etc.)
   */
  private findProceduralParts(): void {
    const children = this.mesh.getChildMeshes(true);
    for (const child of children) {
      if (child.name.includes("arm_l")) {
        this.leftArm = child;
      } else if (child.name.includes("arm_r")) {
        this.rightArm = child;
      }
    }
    // Also check inside visualRoot for nested structure
    const allDescendants = this.mesh.getChildMeshes(false);
    for (const desc of allDescendants) {
      if (desc.name.includes("arm_l") && !this.leftArm) {
        this.leftArm = desc;
      } else if (desc.name.includes("arm_r") && !this.rightArm) {
        this.rightArm = desc;
      }
    }
    console.log(`[PlayerController] Found procedural parts - leftArm: ${!!this.leftArm}, rightArm: ${!!this.rightArm}`);
  }

  /**
   * Play a punch animation using the right arm.
   */
  public playPunchAnimation(): void {
    if (this.isPerformingAction || this.actionCooldown > 0) return;
    if (!this.rightArm) return;

    this.isPerformingAction = true;
    this.actionCooldown = 0.5; // 500ms cooldown

    const arm = this.rightArm;
    const _originalRotZ = arm.rotation.z;
    const originalRotX = arm.rotation.x;

    // Create punch animation: arm swings forward
    const punchAnim = new Animation(
      "punchAnim",
      "rotation.x",
      30,
      Animation.ANIMATIONTYPE_FLOAT,
      Animation.ANIMATIONLOOPMODE_CONSTANT
    );

    punchAnim.setKeys([
      { frame: 0, value: originalRotX },
      { frame: 5, value: originalRotX - 1.5 }, // Wind up
      { frame: 10, value: originalRotX + 0.8 }, // Punch forward
      { frame: 18, value: originalRotX }, // Return
    ]);

    this.scene.beginDirectAnimation(
      arm,
      [punchAnim],
      0,
      18,
      false,
      2.0,
      () => {
        this.isPerformingAction = false;
      }
    );
  }

  /**
   * Play a kick animation (bob the character up/down to simulate).
   */
  public playKickAnimation(): void {
    if (this.isPerformingAction || this.actionCooldown > 0) return;

    this.isPerformingAction = true;
    this.actionCooldown = 0.6;

    // Animate the whole mesh slightly forward and back
    const originalY = this.mesh.position.y;

    const kickAnim = new Animation(
      "kickAnim",
      "position.y",
      30,
      Animation.ANIMATIONTYPE_FLOAT,
      Animation.ANIMATIONLOOPMODE_CONSTANT
    );

    kickAnim.setKeys([
      { frame: 0, value: originalY },
      { frame: 4, value: originalY + 0.15 }, // slight hop
      { frame: 8, value: originalY + 0.25 }, // kick peak
      { frame: 15, value: originalY }, // land
    ]);

    this.scene.beginDirectAnimation(
      this.mesh,
      [kickAnim],
      0,
      15,
      false,
      2.0,
      () => {
        this.isPerformingAction = false;
        this.mesh.position.y = this.groundY; // Ensure back to ground
      }
    );
  }

  /**
   * Play a wave animation using the left arm.
   */
  public playWaveAnimation(): void {
    if (this.isPerformingAction || this.actionCooldown > 0) return;
    if (!this.leftArm) return;

    this.isPerformingAction = true;
    this.actionCooldown = 1.0;

    const arm = this.leftArm;
    const originalRotZ = arm.rotation.z;

    // Wave animation: arm raises and sways
    const waveAnimZ = new Animation(
      "waveAnimZ",
      "rotation.z",
      30,
      Animation.ANIMATIONTYPE_FLOAT,
      Animation.ANIMATIONLOOPMODE_CONSTANT
    );

    waveAnimZ.setKeys([
      { frame: 0, value: originalRotZ },
      { frame: 6, value: originalRotZ + 2.0 }, // Raise arm
      { frame: 10, value: originalRotZ + 1.8 }, // Wave 1
      { frame: 14, value: originalRotZ + 2.2 }, // Wave 2
      { frame: 18, value: originalRotZ + 1.8 }, // Wave 3
      { frame: 22, value: originalRotZ + 2.2 }, // Wave 4
      { frame: 30, value: originalRotZ }, // Lower
    ]);

    this.scene.beginDirectAnimation(
      arm,
      [waveAnimZ],
      0,
      30,
      false,
      1.5,
      () => {
        this.isPerformingAction = false;
      }
    );
  }

  private stopCurrentAnim(): void {
    const animMap: Record<AnimState, string> = {
      idle: "idle",
      walk: "walk",
      sprint: "sprint",
      jump: "jumpLoop",
      dance: "dance",
    };
    this.stopAnim(animMap[this.currentState]);
  }

  private switchState(newState: AnimState): void {
    if (this.currentState === newState) return;

    // Stop current animation
    const animMap: Record<AnimState, string> = {
      idle: "idle",
      walk: "walk",
      sprint: "sprint",
      jump: "jumpLoop",
      dance: "dance",
    };
    this.stopAnim(animMap[this.currentState]);

    // Start new animation
    const speedMap: Record<AnimState, number> = {
      idle: 1.0,
      walk: 1.0,
      sprint: 1.2,
      jump: 1.0,
      dance: 1.0,
    };

    this.playAnim(animMap[newState], true, speedMap[newState]);
    this.currentState = newState;
  }

  private setupCollisions(): void {
    if (!this.mesh.rotationQuaternion) {
      this.mesh.rotationQuaternion = Quaternion.Identity();
    }
    this.mesh.checkCollisions = true;
    this.mesh.ellipsoid = new Vector3(0.5, 0.9, 0.5);
    this.mesh.ellipsoidOffset = new Vector3(0, 0.9, 0);
  }

  public setLocked(locked: boolean): void {
    this.locked = locked;
    if (locked) {
      this.switchState("idle");
    }
  }

  /**
   * Called every frame from the render loop.
   */
  public update(): void {
    if (this.locked) return;

    const dt = this.scene.getEngine().getDeltaTime() / 1000;

    const forward = this.inputMap["w"] || this.inputMap["arrowup"];
    const backward = this.inputMap["s"] || this.inputMap["arrowdown"];
    const left = this.inputMap["a"] || this.inputMap["arrowleft"];
    const right = this.inputMap["d"] || this.inputMap["arrowright"];
    const sprinting = this.inputMap["shift"];
    const jumpPressed = this.inputMap[" "];

    // ---- Action cooldown ----
    if (this.actionCooldown > 0) {
      this.actionCooldown -= dt;
    }

    // ---- Action inputs (Q=punch, E=kick, F=wave) ----
    if (this.inputMap["q"] && !this.isPerformingAction) {
      this.inputMap["q"] = false; // Consume input
      this.playPunchAnimation();
    }
    if (this.inputMap["e"] && !this.isPerformingAction) {
      this.inputMap["e"] = false;
      this.playKickAnimation();
    }
    if (this.inputMap["f"] && !this.isPerformingAction) {
      this.inputMap["f"] = false;
      this.playWaveAnimation();
    }

    // ---- Jump ----
    if (jumpPressed && !this.isJumping) {
      this.isJumping = true;
      this.jumpVelocity = this.jumpForce;
      // Play jumpStart, then transition to jumpLoop
      this.stopCurrentAnim();
      this.playAnim("jumpStart", false);
      const jumpStartAnim = this.anims.get("jumpStart");
      if (jumpStartAnim) {
        jumpStartAnim.onAnimationGroupEndObservable.addOnce(() => {
          if (this.isJumping) {
            this.playAnim("jumpLoop", true);
          }
        });
      } else {
        // No jumpStart anim — go straight to jumpLoop
        this.playAnim("jumpLoop", true);
      }
      this.currentState = "jump";
    }

    if (this.isJumping) {
      this.jumpVelocity += this.gravity * dt;
      this.mesh.position.y += this.jumpVelocity * dt;

      if (this.mesh.position.y <= this.groundY) {
        this.mesh.position.y = this.groundY;
        this.isJumping = false;
        this.jumpVelocity = 0;
        // Play landing animation briefly, then return to idle/walk
        this.stopCurrentAnim();
        this.playAnim("jumpLand", false);
        const jumpLandAnim = this.anims.get("jumpLand");
        if (jumpLandAnim) {
          jumpLandAnim.onAnimationGroupEndObservable.addOnce(() => {
            this.currentState = "idle";
            this.switchState("idle");
          });
        } else {
          this.currentState = "idle";
          this.switchState("idle");
        }
        this.currentState = "jump"; // keep as jump until land anim ends
      }
    }

    // ---- Camera-relative movement (raycaster style) ----
    // The camera's alpha is the "view angle". We derive forward/strafe from it,
    // just like: cos(angle) for forward, cos(angle + PI/2) for strafe.
    const angle = this.camera.alpha;
    let dx = 0;
    let dz = 0;

    // Forward / backward: use cos(angle), sin(angle)
    if (forward) {
      dx -= Math.cos(angle);
      dz -= Math.sin(angle);
    }
    if (backward) {
      dx += Math.cos(angle);
      dz += Math.sin(angle);
    }
    // Strafe left / right: use cos(angle + PI/2), sin(angle + PI/2)
    if (right) {
      dx += Math.cos(angle + Math.PI / 2);
      dz += Math.sin(angle + Math.PI / 2);
    }
    if (left) {
      dx -= Math.cos(angle + Math.PI / 2);
      dz -= Math.sin(angle + Math.PI / 2);
    }

    // Normalize diagonal movement
    const len = Math.sqrt(dx * dx + dz * dz);
    const isMoving = len > 0.001;

    if (isMoving) {
      dx /= len;
      dz /= len;

      // Choose speed and animation state
      let speed: number;
      let targetState: AnimState;

      if (sprinting) {
        speed = this.sprintSpeed;
        targetState = "sprint";
      } else {
        speed = this.walkSpeed;
        targetState = "walk";
      }

      if (!this.isJumping) {
        this.switchState(targetState);
      }

      // Apply movement
      const displacement = new Vector3(dx * speed * dt, 0, dz * speed * dt);
      this.mesh.moveWithCollisions(displacement);

      // Rotate player to face movement direction
      const targetAngle = Math.atan2(dx, dz);
      const targetQuat = Quaternion.FromEulerAngles(0, targetAngle, 0);
      Quaternion.SlerpToRef(
        this.mesh.rotationQuaternion!,
        targetQuat,
        this.rotationLerp,
        this.mesh.rotationQuaternion!
      );
    } else {
      if (!this.isJumping) {
        this.switchState("idle");
      }
    }

    // Keep on ground — preserve the initial Y offset (set by AssetLoader)
    if (this.mesh.position.y < this.groundY) {
      this.mesh.position.y = this.groundY;
    }
  }

  public getPosition(): Vector3 {
    return this.mesh.position;
  }

  /** Return the player's root mesh (used by AIBridge follow commands). */
  public getMesh(): Mesh {
    return this.mesh;
  }

  /** Teleport the player to a position. Accepts [x,y,z] array or {x,y,z} object. */
  public teleport(position: [number, number, number] | { x: number; y: number; z: number }): void {
    if (Array.isArray(position)) {
      this.mesh.position = new Vector3(position[0], position[1] !== undefined ? position[1] : this.groundY, position[2]);
    } else {
      this.mesh.position = new Vector3(position.x, position.y ?? this.groundY, position.z);
    }
    this.groundY = this.mesh.position.y;
  }

  /** Update player stats from an object (merged into existing stats). */
  public updateStats(stats: Partial<PlayerStats>): void {
    this.stats = { ...this.stats, ...stats };
  }

  /** Get current stats. */
  public getStats(): PlayerStats {
    return { ...this.stats };
  }

  /**
   * Serialize the player state for AIBridge / getWorldState().
   */
  public serialize(): any {
    const p = this.mesh.position;
    const r = this.mesh.rotation;
    return {
      id: "player",
      position: [p.x, p.y, p.z],
      rotation: [r.x, r.y, r.z],
      stats: this.getStats(),
      state: this.currentState,
    };
  }
}
