import { Scene, Mesh, ArcRotateCamera, Vector3, Quaternion, AnimationGroup, KeyboardEventTypes, ShadowGenerator } from "@babylonjs/core";

interface InputMap {
  [key: string]: boolean;
}

type AnimState = "idle" | "walk" | "sprint" | "jump" | "dance";

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
    const clickToPlay = document.getElementById("click-to-play")!;

    // Click either the overlay or the canvas to engage pointer lock
    const requestLock = () => this.canvas.requestPointerLock();
    clickToPlay.addEventListener("click", requestLock);
    this.canvas.addEventListener("click", requestLock);

    // Show/hide overlay based on pointer lock state
    document.addEventListener("pointerlockchange", () => {
      if (document.pointerLockElement === this.canvas) {
        clickToPlay.classList.add("hidden");
      } else {
        clickToPlay.classList.remove("hidden");
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
      const targetAngle = Math.atan2(dx, dz) + Math.PI;
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
}
