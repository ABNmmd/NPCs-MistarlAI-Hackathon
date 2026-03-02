import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Vector3,
  TransformNode,
  ShadowGenerator,
  Camera,
  Matrix,
  AnimationGroup,
  AssetContainer,
  SceneLoader,
  AbstractMesh,
  Quaternion,
} from "@babylonjs/core";
import "@babylonjs/loaders/glTF";

// ──── Types ──────────────────────────────────────────────────────────────────

type BehaviorType = "idle" | "wander" | "patrol" | "follow" | "moveTo";

interface NPCBehavior {
  type: BehaviorType;
  wanderRadius?: number;
  speed?: number;
  idleDurationMin?: number;
  idleDurationMax?: number;
  patrolPoints?: [number, number, number][];
  waitTimeAtPoint?: number;
  targetId?: string;
  distance?: number;
  destination?: Vector3;
  /** If true, wander around spawn position instead of drifting freely. */
  anchorToSpawn?: boolean;
}

interface NPCAppearance {
  bodyHeight?: number;
  bodyWidth?: number;
  headDiameter?: number;
  material?: { diffuseColor?: number[]; specularColor?: number[] };
}

interface NPCDialogue {
  greeting?: string;
  idle?: string[];
}

interface NPCStats {
  health: number;
  maxHealth: number;
}

interface NPCInstance {
  id: string;
  name: string;
  template: string;
  position: [number, number, number];
  appearance: Required<NPCAppearance>;
  behavior: NPCBehavior;
  dialogue: NPCDialogue;
  stats: NPCStats;
  interactable: boolean;
  interactDistance: number;

  // Babylon objects
  root: TransformNode;
  animGroups: AnimationGroup[];
  idleAnim: AnimationGroup | null;
  walkAnim: AnimationGroup | null;
  talkAnim: AnimationGroup | null;

  // Animation state
  _isMoving: boolean;
  _isTalking: boolean;
  _talkTimer: ReturnType<typeof setTimeout> | null;

  /** Speech bubble shown by npcSay */
  bubbleEl: HTMLElement | null;
  bubbleTimeout?: ReturnType<typeof setTimeout>;

  // Spawn anchor (used by wander to prevent drift)
  _spawnPosition: [number, number, number];

  /** Persistent nameplate above head */
  nameplateEl: HTMLElement | null;
  /** Quest indicator icon (!, ?) above name */
  questIndicator: HTMLElement | null;

  // Wander state
  _wanderTimer: number;
  _wanderTarget: Vector3 | null;
  // Patrol state
  _patrolIdx: number;
  _patrolWait: number;
  // MoveTo state
  _moveToTarget: Vector3 | null;
}

type EventCallback = (event: string, data: any) => void;

// ──── NPCManager ──────────────────────────────────────────────────────────────

/**
 * NPCManager — manages all NPCs in the scene.
 *
 * Each NPC is instantiated from a real GLB asset (npc.glb / npc1.glb) via
 * AssetContainer.instantiateModelsToScene(), giving each NPC its own
 * independent mesh hierarchy and animation groups.
 * Falls back to a procedural capsule if no GLB was pre-loaded.
 */
export class NPCManager {
  private npcs = new Map<string, NPCInstance>();
  private templates: Record<string, any> = {};
  private shadowGenerator?: ShadowGenerator;
  private _eventCbs: EventCallback[] = [];
  private _idCounter = 0;
  private _spawnCounter = 0;

  /** Pre-loaded GLB containers keyed by filename */
  private _containers = new Map<string, AssetContainer>();
  private _containerKeys: string[] = [];

  /** Getter for the live player position (used by follow behaviour). */
  private _getPlayerPosition?: () => Vector3;

  /** Cached collidable meshes from the scene (buildings, walls, etc.) */
  private _collidableMeshes: AbstractMesh[] = [];
  private _collidableCacheDirty = true;
  /** NPC collision radius (world units) */
  private readonly NPC_COLLISION_RADIUS = 0.6;

  constructor(private scene: Scene, shadowGenerator?: ShadowGenerator) {
    this.shadowGenerator = shadowGenerator;
  }

  public setPlayerPositionGetter(getter: () => Vector3): void {
    this._getPlayerPosition = getter;
  }

  // ──────────────────────── Model Pre-loading ─────────────────────────────────

  /**
   * Load GLB files into AssetContainers (kept disabled — never rendered directly).
   * Must be awaited BEFORE initialize() / spawnNPC().
   * @param files  e.g. ["npc.glb", "npc1.glb"]
   */
  public async preloadModels(files: string[]): Promise<void> {
    for (const file of files) {
      try {
        const container = await SceneLoader.LoadAssetContainerAsync(
          "/assets/models/", file, this.scene
        );
        container.meshes.forEach((m: AbstractMesh) => m.setEnabled(false));
        this._containers.set(file, container);
        this._containerKeys.push(file);
        console.log(`[NPCManager] Loaded model template: ${file}`);
      } catch (err) {
        console.warn(`[NPCManager] Could not load "${file}", will use procedural fallback.`, err);
      }
    }
  }

  // ────────────────────────── Initialization ──────────────────────────────────

  /** Initialize NPCs from the npcs.json config (templates + instances). */
  public initialize(npcsConfig: any): void {
    if (npcsConfig?.templates) {
      for (const [name, tmpl] of Object.entries(npcsConfig.templates)) {
        this.templates[name] = tmpl;
      }
    }
    if (npcsConfig?.instances) {
      for (const inst of npcsConfig.instances) {
        this.spawnNPC(inst);
      }
    }
    console.log(`[NPCManager] Initialized ${this.npcs.size} NPCs.`);
  }

  // ────────────────────────── Spawn / Remove ──────────────────────────────────

  /** Spawn an NPC. Merges template + instance overrides. */
  public spawnNPC(params: any): NPCInstance | null {
    const id = params.id ?? `npc_${++this._idCounter}`;

    // Resolve template
    const template = params.template ? (this.templates[params.template] ?? {}) : {};
    const overrides = params.overrides ?? {};

    const appearance: Required<NPCAppearance> = {
      bodyHeight: params.appearance?.bodyHeight ?? template.appearance?.bodyHeight ?? 1.1,
      bodyWidth: params.appearance?.bodyWidth ?? template.appearance?.bodyWidth ?? 0.55,
      headDiameter: params.appearance?.headDiameter ?? template.appearance?.headDiameter ?? 0.45,
      material: params.appearance?.material ?? template.appearance?.material ?? {},
    };

    const behavior: NPCBehavior = this._deepMerge(
      template.behavior ?? { type: "idle" },
      overrides.behavior ?? params.behavior ?? {}
    );

    const dialogue: NPCDialogue = this._deepMerge(
      template.dialogue ?? {},
      overrides.dialogue ?? params.dialogue ?? {}
    );

    const stats: NPCStats = this._deepMerge(
      template.stats ?? { health: 50, maxHealth: 50 },
      params.stats ?? {}
    );

    const pos: [number, number, number] = params.position ?? [0, 0, 0];

    // Pick a model file (round-robin or explicit)
    const modelFile: string | undefined = params.model ?? this._pickModelFile();
    const templateName: string = params.template ?? "villager";

    // Build mesh (GLB clone or procedural fallback)
    const { root, animGroups } = this._buildNPCMesh(id, appearance, modelFile, templateName);
    root.position = new Vector3(pos[0], pos[1], pos[2]);

    // Build animation map once (was called 3× per NPC via _find*Anim helpers)
    const animMap = this._buildAnimMap(animGroups, id);
    const idleAnim = animMap.get("idle") ?? null;
    const walkAnim = animMap.get("walk") ?? null;
    const talkAnim = animMap.get("talkIdle") ?? null;
    animGroups.forEach((g) => g.stop());
    if (idleAnim) idleAnim.start(true, 1.0);

    const inst: NPCInstance = {
      id,
      name: params.name ?? id,
      template: params.template ?? "custom",
      position: pos,
      appearance,
      behavior,
      dialogue,
      stats,
      interactable: params.interactable ?? template.interactable ?? true,
      interactDistance: params.interactDistance ?? template.interactDistance ?? 3.5,
      root,
      animGroups,
      idleAnim,
      walkAnim,
      talkAnim,
      _isMoving: false,
      _isTalking: false,
      _talkTimer: null,
      bubbleEl: null,
      _spawnPosition: [...pos] as [number, number, number],
      nameplateEl: null,
      questIndicator: null,
      _wanderTimer: 0,
      _wanderTarget: null,
      _patrolIdx: 0,
      _patrolWait: 0,
      _moveToTarget: null,
    };

    this.npcs.set(id, inst);
    this._spawnCounter++;
    this._collidableCacheDirty = true;
    
    // Create nameplate above NPC head
    this._createNameplate(inst);
    
    this._emitEvent("npcSpawned", { id, name: inst.name, position: pos });
    return inst;
  }

  /** Remove an NPC from the scene. */
  public removeNPC(id: string): boolean {
    const inst = this.npcs.get(id);
    if (!inst) return false;

    // Stop & dispose animation groups (independent copies from instantiation)
    inst.animGroups.forEach((ag) => { ag.stop(); ag.dispose(); });

    inst.root.getChildMeshes().forEach((m) => m.dispose());
    inst.root.dispose();
    inst.bubbleEl?.remove();
    inst.nameplateEl?.remove();
    inst.questIndicator?.remove();

    this.npcs.delete(id);
    this._collidableCacheDirty = true;
    this._emitEvent("npcRemoved", { id });
    return true;
  }

  // ────────────────────────── Commands ────────────────────────────────────────

  public moveNPCTo(id: string, position: [number, number, number], speed?: number): boolean {
    const inst = this.npcs.get(id);
    if (!inst) return false;
    inst._moveToTarget = new Vector3(position[0], position[1], position[2]);
    inst.behavior = { type: "moveTo", speed: speed ?? inst.behavior.speed ?? 2, destination: inst._moveToTarget };
    return true;
  }

  public npcSay(id: string, message: string): boolean {
    const inst = this.npcs.get(id);
    if (!inst) return false;
    this._showSpeechBubble(inst, message);
    this._emitEvent("npcSpoke", { id, message });
    return true;
  }

  public updateNPCBehavior(id: string, behavior: any): boolean {
    const inst = this.npcs.get(id);
    if (!inst) return false;
    inst.behavior = { ...inst.behavior, ...behavior };
    inst._wanderTimer = 0;
    inst._wanderTarget = null;
    inst._patrolIdx = 0;
    return true;
  }

  public updateNPCDialogue(id: string, dialogue: any): boolean {
    const inst = this.npcs.get(id);
    if (!inst) return false;
    inst.dialogue = this._deepMerge(inst.dialogue, dialogue);
    return true;
  }

  public setNPCFollow(id: string, target: any, distance?: number): boolean {
    const inst = this.npcs.get(id);
    if (!inst) return false;
    inst.behavior = { type: "follow", distance: distance ?? 3, targetId: target };
    return true;
  }

  /** Switch the NPC to talking animation. If autoDurationMs is set, auto-switches to listening after that time. */
  public startTalking(id: string, autoDurationMs = 0): void {
    const inst = this.npcs.get(id);
    if (!inst) return;
    // Cancel any pending auto-switch
    if (inst._talkTimer) { clearTimeout(inst._talkTimer); inst._talkTimer = null; }
    inst._isTalking = true;
    inst.idleAnim?.stop();
    inst.walkAnim?.stop();
    if (inst.talkAnim) {
      if (!inst.talkAnim.isPlaying) inst.talkAnim.start(true, 1.0);
    } else if (inst.idleAnim) {
      inst.idleAnim.start(true, 1.0);
    }
    if (autoDurationMs > 0) {
      inst._talkTimer = setTimeout(() => this.startListening(id), autoDurationMs);
    }
  }

  /** Switch the NPC to a listening/attentive idle while the player is speaking. */
  public startListening(id: string): void {
    const inst = this.npcs.get(id);
    if (!inst) return;
    if (inst._talkTimer) { clearTimeout(inst._talkTimer); inst._talkTimer = null; }
    inst._isTalking = true; // still frozen from wandering
    inst.talkAnim?.stop();
    inst.walkAnim?.stop();
    if (inst.idleAnim && !inst.idleAnim.isPlaying) inst.idleAnim.start(true, 1.0);
  }

  /** Return the NPC to its normal behaviour after chat closes. */
  public stopTalking(id: string): void {
    const inst = this.npcs.get(id);
    if (!inst) return;
    if (inst._talkTimer) { clearTimeout(inst._talkTimer); inst._talkTimer = null; }
    inst._isTalking = false;
    inst.talkAnim?.stop();
    if (inst.idleAnim && !inst.idleAnim.isPlaying) inst.idleAnim.start(true, 1.0);
  }

  public registerTemplate(name: string, template: any): void {
    this.templates[name] = template;
  }

  // ────────────────────────── Serialization ───────────────────────────────────

  public serializeNPC(id: string): any | null {
    const inst = this.npcs.get(id);
    if (!inst) return null;
    return this._serializeInst(inst);
  }

  public serializeAll(): any[] {
    return Array.from(this.npcs.values()).map((inst) => this._serializeInst(inst));
  }

  private _serializeInst(inst: NPCInstance): any {
    const p = inst.root.position;
    return {
      id: inst.id,
      name: inst.name,
      template: inst.template,
      position: [p.x, p.y, p.z],
      behavior: inst.behavior,
      dialogue: inst.dialogue,
      stats: inst.stats,
    };
  }

  // ────────────────────────── Events ──────────────────────────────────────────

  public onEvent(callback: EventCallback): () => void {
    this._eventCbs.push(callback);
    return () => { this._eventCbs = this._eventCbs.filter((c) => c !== callback); };
  }

  private _emitEvent(event: string, data: any): void {
    for (const cb of this._eventCbs) {
      try { cb(event, data); } catch (e) { /* skip */ }
    }
  }

  // ────────────────────────── Update Loop ─────────────────────────────────────

  public update(dt: number, playerPosition: Vector3): void {
    for (const inst of this.npcs.values()) {
      this._updateBehavior(inst, dt, playerPosition);
      const p = inst.root.position;
      inst.position = [p.x, p.y, p.z];
    }
  }

  private _updateBehavior(inst: NPCInstance, dt: number, playerPos: Vector3): void {
    // Freeze movement while the player is chatting with this NPC
    if (inst._isTalking) return;

    const speed = inst.behavior.speed ?? 1.5;

    // Reset movement flag each frame; _moveToward will set it to true if we move
    inst._isMoving = false;

    switch (inst.behavior.type) {
      case "wander":
        this._behaviorWander(inst, dt, speed);
        break;
      case "patrol":
        this._behaviorPatrol(inst, dt, speed);
        break;
      case "follow":
        this._behaviorFollow(inst, dt, playerPos, speed);
        break;
      case "moveTo":
        this._behaviorMoveTo(inst, dt, speed);
        break;
      case "idle":
      default:
        break;
    }

    // Swap animations based on whether the NPC moved this frame
    this._updateAnimationState(inst);
  }

  private _behaviorWander(inst: NPCInstance, dt: number, speed: number): void {
    inst._wanderTimer -= dt;
    if (inst._wanderTimer <= 0 || !inst._wanderTarget) {
      const radius = inst.behavior.wanderRadius ?? 8;
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * radius;
      // Non-anchored NPCs wander freely from their current position.
      // Anchored NPCs (e.g. guard) stay near their spawn.
      const anchored = inst.behavior.anchorToSpawn === true;
      const anchor = anchored ? inst._spawnPosition : [inst.root.position.x, 0, inst.root.position.z] as [number, number, number];
      inst._wanderTarget = new Vector3(
        anchor[0] + Math.cos(angle) * dist,
        0,
        anchor[2] + Math.sin(angle) * dist
      );
      const idleMin = inst.behavior.idleDurationMin ?? 2;
      const idleMax = inst.behavior.idleDurationMax ?? 6;
      inst._wanderTimer = idleMin + Math.random() * (idleMax - idleMin);
    }
    if (inst._wanderTarget) {
      this._moveToward(inst, inst._wanderTarget, speed, dt);
    }
  }

  private _behaviorPatrol(inst: NPCInstance, dt: number, speed: number): void {
    const pts = inst.behavior.patrolPoints;
    if (!pts || pts.length === 0) return;

    if (inst._patrolWait > 0) {
      inst._patrolWait -= dt;
      return;
    }

    const pt = pts[inst._patrolIdx];
    const target = new Vector3(pt[0], pt[1], pt[2]);
    const dist = Vector3.Distance(inst.root.position, target);

    if (dist < 0.5) {
      inst._patrolIdx = (inst._patrolIdx + 1) % pts.length;
      inst._patrolWait = inst.behavior.waitTimeAtPoint ?? 3;
    } else {
      this._moveToward(inst, target, speed, dt);
    }
  }

  private _behaviorFollow(inst: NPCInstance, dt: number, playerPos: Vector3, speed: number): void {
    // If targetId is 'player' or unset → follow player; otherwise try to resolve via getter
    const targetId = inst.behavior.targetId;
    let targetPos: Vector3;
    if (!targetId || targetId === "player") {
      targetPos = this._getPlayerPosition ? this._getPlayerPosition() : playerPos;
    } else {
      // Check if another NPC shares this id and use its position
      const otherNPC = this.npcs.get(targetId);
      targetPos = otherNPC ? otherNPC.root.position : playerPos;
    }
    const dist = Vector3.Distance(inst.root.position, targetPos);
    const desiredDist = inst.behavior.distance ?? 3;
    if (dist > desiredDist + 0.5) {
      this._moveToward(inst, targetPos, speed, dt);
    }
  }

  private _behaviorMoveTo(inst: NPCInstance, dt: number, speed: number): void {
    if (!inst._moveToTarget) return;
    const dist = Vector3.Distance(inst.root.position, inst._moveToTarget);
    if (dist < 0.4) {
      inst._moveToTarget = null;
      inst.behavior = { type: "idle" };
      this._emitEvent("npcArrivedAtDestination", { id: inst.id });
    } else {
      this._moveToward(inst, inst._moveToTarget, speed, dt);
    }
  }

  // ────────────────────────── Collision Helpers ───────────────────────────────

  /** Refresh the cached list of collidable meshes from the scene. */
  private _refreshCollidableCache(): void {
    const npcRootIds = new Set<string>();
    for (const inst of this.npcs.values()) {
      npcRootIds.add(inst.root.uniqueId.toString());
      inst.root.getChildMeshes(false).forEach((m) => npcRootIds.add(m.uniqueId.toString()));
    }

    this._collidableMeshes = this.scene.meshes.filter((m) => {
      if (!m.checkCollisions) return false;
      // Exclude NPC's own meshes
      if (npcRootIds.has(m.uniqueId.toString())) return false;
      // Exclude the ground plane (NPCs walk on it)
      if (m.name === "ground") return false;
      // Must have valid bounding info
      if (!m.getBoundingInfo()) return false;
      return true;
    });
    this._collidableCacheDirty = false;
  }

  /**
   * Check whether a sphere at `pos` with `radius` overlaps any collidable mesh
   * in the scene. Uses AABB-sphere intersection for speed.
   */
  private _checkCollision(pos: Vector3, radius: number): boolean {
    if (this._collidableCacheDirty) this._refreshCollidableCache();

    for (const mesh of this._collidableMeshes) {
      const bi = mesh.getBoundingInfo();
      if (!bi) continue;
      const bb = bi.boundingBox;
      // AABB-sphere intersection: find closest point on AABB to sphere center
      const minW = bb.minimumWorld;
      const maxW = bb.maximumWorld;
      const cx = Math.max(minW.x, Math.min(pos.x, maxW.x));
      const cy = Math.max(minW.y, Math.min(pos.y + 0.9, maxW.y)); // offset y to torso height
      const cz = Math.max(minW.z, Math.min(pos.z, maxW.z));
      const dx = pos.x - cx;
      const dz = pos.z - cz;
      const dy = (pos.y + 0.9) - cy;
      const distSq = dx * dx + dy * dy + dz * dz;
      if (distSq < radius * radius) return true;
    }
    return false;
  }

  /** Mark collision cache as stale (call after spawning/removing NPCs or building new geometry). */
  public invalidateCollisionCache(): void {
    this._collidableCacheDirty = true;
  }

  private _moveToward(inst: NPCInstance, target: Vector3, speed: number, dt: number): void {
    const dir = target.subtract(inst.root.position);
    dir.y = 0;
    const len = dir.length();
    if (len < 0.01) return;
    dir.scaleInPlace(1 / len);

    const step = speed * dt;
    const radius = this.NPC_COLLISION_RADIUS;

    // If the NPC is already overlapping geometry (e.g. spawned inside a building),
    // let them move freely until they escape the overlap.
    const alreadyOverlapping = this._checkCollision(inst.root.position, radius);

    // Try full movement first
    const fullMove = dir.scale(step);
    const newPos = inst.root.position.add(fullMove);
    newPos.y = 0;

    if (alreadyOverlapping || !this._checkCollision(newPos, radius)) {
      // No collision, or escaping from overlap — apply full move
      inst.root.position.copyFrom(newPos);
      inst._isMoving = true;
    } else {
      // Try sliding along X axis only
      const slideX = inst.root.position.clone();
      slideX.x += dir.x * step;
      slideX.y = 0;
      const canSlideX = !this._checkCollision(slideX, radius);

      // Try sliding along Z axis only
      const slideZ = inst.root.position.clone();
      slideZ.z += dir.z * step;
      slideZ.y = 0;
      const canSlideZ = !this._checkCollision(slideZ, radius);

      if (canSlideX && canSlideZ) {
        // Both axes ok — pick the one closer to desired direction
        if (Math.abs(dir.x) >= Math.abs(dir.z)) {
          inst.root.position.copyFrom(slideX);
        } else {
          inst.root.position.copyFrom(slideZ);
        }
        inst._isMoving = true;
      } else if (canSlideX) {
        inst.root.position.copyFrom(slideX);
        inst._isMoving = true;
      } else if (canSlideZ) {
        inst.root.position.copyFrom(slideZ);
        inst._isMoving = true;
      } else {
        // Completely blocked — don't move, pick a new wander target if wandering
        if (inst.behavior.type === "wander") {
          inst._wanderTarget = null;
          inst._wanderTimer = 0;
        }
      }
    }

    inst.root.position.y = 0; // keep on ground

    // Smooth quaternion rotation toward movement direction — same as player
    if (!inst.root.rotationQuaternion) {
      inst.root.rotationQuaternion = Quaternion.Identity();
    }
    const targetAngle = Math.atan2(dir.x, dir.z) + Math.PI;
    const targetQuat = Quaternion.FromEulerAngles(0, targetAngle, 0);
    Quaternion.SlerpToRef(
      inst.root.rotationQuaternion,
      targetQuat,
      0.55,
      inst.root.rotationQuaternion
    );
  }

  // ────────────────────────── Mesh Builder ────────────────────────────────────

  /**
   * Build the NPC root node.
   * Uses instantiateModelsToScene() if a GLB container is loaded,
   * giving each NPC its own independent mesh + animation groups.
   */
  private _buildNPCMesh(
    id: string,
    appearance: Required<NPCAppearance>,
    modelFile?: string,
    templateName?: string
  ): { root: TransformNode; animGroups: AnimationGroup[] } {
    const container = modelFile
      ? this._containers.get(modelFile)
      : this._anyContainer();

    if (container) {
      const entries = container.instantiateModelsToScene(
        (sourceName: string) => `npc_${id}_${sourceName}`,
        false,
        { doNotInstantiate: true }
      );

      const root = entries.rootNodes[0] as TransformNode;

      // Re-enable: template meshes were disabled; instances inherit that state
      root.setEnabled(true);
      root.getChildMeshes(false).forEach((m) => m.setEnabled(true));

      // Force world matrices so bounding boxes are accurate
      root.computeWorldMatrix(true);

      // Lift so feet sit at y = 0
      let minY = Infinity;
      root.getChildMeshes(false).forEach((child) => {
        child.computeWorldMatrix(true);
        const bounds = child.getBoundingInfo();
        if (bounds) {
          const worldMinY = bounds.boundingBox.minimumWorld.y;
          if (worldMinY < minY) minY = worldMinY;
        }
      });
      if (minY !== Infinity && minY < 0) root.position.y -= minY;

      // Shadows
      root.getChildMeshes().forEach((m) => {
        m.receiveShadows = true;
        if (this.shadowGenerator) {
          try { this.shadowGenerator.addShadowCaster(m, true); } catch (_) { /* skip */ }
        }
      });

      console.log(
        `[NPCManager] Instantiated "${modelFile}" for NPC "${id}"`,
        `— anims: [${entries.animationGroups.map((a: AnimationGroup) => a.name).join(", ")}]`
      );

      return { root, animGroups: entries.animationGroups };
    }

    // Procedural fallback with template-based styling
    console.warn(`[NPCManager] No GLB for NPC "${id}", using procedural mesh.`);
    return { root: this._buildProceduralMesh(id, appearance, templateName ?? "villager"), animGroups: [] };
  }

  private _buildProceduralMesh(id: string, appearance: Required<NPCAppearance>, templateName: string): TransformNode {
    const root = new TransformNode(`npc_root_${id}`, this.scene);
    const bh = appearance.bodyHeight;
    const bw = appearance.bodyWidth;
    const hd = appearance.headDiameter;
    const _dc = appearance.material?.diffuseColor ?? [0.6, 0.6, 0.6]; // Default color, used by template styles
    const sc = appearance.material?.specularColor ?? [0.1, 0.1, 0.1];

    // Template-specific character designs
    const characterStyles: Record<string, {
      bodyColor: [number,number,number];
      accentColor: [number,number,number];
      skinTone: [number,number,number];
      hairColor: [number,number,number];
      glowColor: [number,number,number];
      hasHelmet: boolean;
      hasHood: boolean;
      hasHat: boolean;
      hasBeard: boolean;
      hasStaff: boolean;
      hasShield: boolean;
      hasApron: boolean;
      hasCape: boolean;
      hairStyle: "none" | "short" | "long" | "ponytail" | "bun";
    }> = {
      villager: {
        bodyColor: [0.55, 0.45, 0.35], accentColor: [0.45, 0.38, 0.28],
        skinTone: [0.82, 0.68, 0.55], hairColor: [0.35, 0.25, 0.18],
        glowColor: [0, 0, 0], hasHelmet: false, hasHood: false, hasHat: true,
        hasBeard: false, hasStaff: false, hasShield: false, hasApron: false,
        hasCape: false, hairStyle: "short"
      },
      guard: {
        bodyColor: [0.35, 0.38, 0.50], accentColor: [0.55, 0.50, 0.42],
        skinTone: [0.75, 0.62, 0.52], hairColor: [0.20, 0.15, 0.12],
        glowColor: [0.02, 0.02, 0.04], hasHelmet: true, hasHood: false, hasHat: false,
        hasBeard: false, hasStaff: false, hasShield: true, hasApron: false,
        hasCape: true, hairStyle: "none"
      },
      merchant: {
        bodyColor: [0.60, 0.35, 0.50], accentColor: [0.75, 0.60, 0.25],
        skinTone: [0.78, 0.65, 0.50], hairColor: [0.25, 0.18, 0.15],
        glowColor: [0.03, 0.02, 0.02], hasHelmet: false, hasHood: false, hasHat: true,
        hasBeard: true, hasStaff: false, hasShield: false, hasApron: false,
        hasCape: true, hairStyle: "short"
      },
      wanderer: {
        bodyColor: [0.40, 0.50, 0.55], accentColor: [0.35, 0.42, 0.45],
        skinTone: [0.72, 0.58, 0.48], hairColor: [0.42, 0.35, 0.28],
        glowColor: [0.01, 0.02, 0.03], hasHelmet: false, hasHood: true, hasHat: false,
        hasBeard: true, hasStaff: true, hasShield: false, hasApron: false,
        hasCape: true, hairStyle: "long"
      },
      healer: {
        bodyColor: [0.45, 0.60, 0.55], accentColor: [0.85, 0.82, 0.75],
        skinTone: [0.85, 0.72, 0.60], hairColor: [0.75, 0.68, 0.55],
        glowColor: [0.04, 0.06, 0.05], hasHelmet: false, hasHood: true, hasHat: false,
        hasBeard: false, hasStaff: true, hasShield: false, hasApron: false,
        hasCape: false, hairStyle: "bun"
      },
      blacksmith: {
        bodyColor: [0.45, 0.35, 0.30], accentColor: [0.30, 0.28, 0.25],
        skinTone: [0.70, 0.55, 0.45], hairColor: [0.15, 0.12, 0.10],
        glowColor: [0.04, 0.02, 0.01], hasHelmet: false, hasHood: false, hasHat: false,
        hasBeard: true, hasStaff: false, hasShield: false, hasApron: true,
        hasCape: false, hairStyle: "short"
      }
    };

    const style = characterStyles[templateName] ?? characterStyles.villager;

    // === BODY (Torso) ===
    const torso = MeshBuilder.CreateCapsule(`npc_torso_${id}`,
      { height: bh * 0.55, radius: bw * 0.32, tessellation: 16, subdivisions: 4 }, this.scene);
    torso.position.y = bh * 0.45;
    torso.parent = root;
    const torsoMat = new StandardMaterial(`npc_torso_mat_${id}`, this.scene);
    torsoMat.diffuseColor = new Color3(style.bodyColor[0], style.bodyColor[1], style.bodyColor[2]);
    torsoMat.specularColor = new Color3(sc[0], sc[1], sc[2]);
    torsoMat.emissiveColor = new Color3(style.glowColor[0], style.glowColor[1], style.glowColor[2]);
    torso.material = torsoMat;

    // === LEGS ===
    const legHeight = bh * 0.35;
    const legRadius = bw * 0.12;
    const leftLeg = MeshBuilder.CreateCapsule(`npc_leg_l_${id}`,
      { height: legHeight, radius: legRadius, tessellation: 12 }, this.scene);
    leftLeg.position.set(-bw * 0.18, legHeight / 2, 0);
    leftLeg.parent = root;
    const rightLeg = MeshBuilder.CreateCapsule(`npc_leg_r_${id}`,
      { height: legHeight, radius: legRadius, tessellation: 12 }, this.scene);
    rightLeg.position.set(bw * 0.18, legHeight / 2, 0);
    rightLeg.parent = root;
    const legMat = new StandardMaterial(`npc_leg_mat_${id}`, this.scene);
    legMat.diffuseColor = new Color3(style.accentColor[0] * 0.7, style.accentColor[1] * 0.7, style.accentColor[2] * 0.7);
    leftLeg.material = legMat;
    rightLeg.material = legMat;

    // === ARMS ===
    const armHeight = bh * 0.32;
    const armRadius = bw * 0.09;
    const leftArm = MeshBuilder.CreateCapsule(`npc_arm_l_${id}`,
      { height: armHeight, radius: armRadius, tessellation: 10 }, this.scene);
    leftArm.position.set(-bw * 0.42, bh * 0.52, 0);
    leftArm.rotation.z = 0.2;
    leftArm.parent = root;
    const rightArm = MeshBuilder.CreateCapsule(`npc_arm_r_${id}`,
      { height: armHeight, radius: armRadius, tessellation: 10 }, this.scene);
    rightArm.position.set(bw * 0.42, bh * 0.52, 0);
    rightArm.rotation.z = -0.2;
    rightArm.parent = root;
    const armMat = new StandardMaterial(`npc_arm_mat_${id}`, this.scene);
    armMat.diffuseColor = new Color3(style.skinTone[0], style.skinTone[1], style.skinTone[2]);
    leftArm.material = armMat;
    rightArm.material = armMat;

    // === HEAD ===
    const head = MeshBuilder.CreateSphere(`npc_head_${id}`,
      { diameter: hd, segments: 20 }, this.scene);
    head.position.y = bh + hd * 0.3;
    head.parent = root;
    const headMat = new StandardMaterial(`npc_head_mat_${id}`, this.scene);
    headMat.diffuseColor = new Color3(style.skinTone[0], style.skinTone[1], style.skinTone[2]);
    headMat.specularColor = new Color3(0.06, 0.05, 0.04);
    head.material = headMat;

    // === EYES ===
    const eyeOffset = hd * 0.18;
    const eyeSize = hd * 0.12;
    const leftEye = MeshBuilder.CreateSphere(`npc_eye_l_${id}`, { diameter: eyeSize, segments: 8 }, this.scene);
    leftEye.position.set(-eyeOffset, bh + hd * 0.35, hd * 0.38);
    leftEye.parent = root;
    const rightEye = MeshBuilder.CreateSphere(`npc_eye_r_${id}`, { diameter: eyeSize, segments: 8 }, this.scene);
    rightEye.position.set(eyeOffset, bh + hd * 0.35, hd * 0.38);
    rightEye.parent = root;
    const eyeMat = new StandardMaterial(`npc_eye_mat_${id}`, this.scene);
    eyeMat.diffuseColor = new Color3(0.95, 0.95, 0.95);
    eyeMat.emissiveColor = new Color3(0.1, 0.1, 0.1);
    leftEye.material = eyeMat;
    rightEye.material = eyeMat;
    
    // Pupils
    const pupilSize = eyeSize * 0.5;
    const leftPupil = MeshBuilder.CreateSphere(`npc_pupil_l_${id}`, { diameter: pupilSize, segments: 6 }, this.scene);
    leftPupil.position.set(-eyeOffset, bh + hd * 0.35, hd * 0.42);
    leftPupil.parent = root;
    const rightPupil = MeshBuilder.CreateSphere(`npc_pupil_r_${id}`, { diameter: pupilSize, segments: 6 }, this.scene);
    rightPupil.position.set(eyeOffset, bh + hd * 0.35, hd * 0.42);
    rightPupil.parent = root;
    const pupilMat = new StandardMaterial(`npc_pupil_mat_${id}`, this.scene);
    pupilMat.diffuseColor = new Color3(0.15, 0.12, 0.10);
    leftPupil.material = pupilMat;
    rightPupil.material = pupilMat;

    // === HAIR STYLES ===
    if (style.hairStyle !== "none" && !style.hasHelmet && !style.hasHood) {
      const hairMat = new StandardMaterial(`npc_hair_mat_${id}`, this.scene);
      hairMat.diffuseColor = new Color3(style.hairColor[0], style.hairColor[1], style.hairColor[2]);
      hairMat.specularColor = new Color3(0.15, 0.12, 0.10);

      if (style.hairStyle === "short") {
        const hair = MeshBuilder.CreateSphere(`npc_hair_${id}`,
          { diameter: hd * 1.05, segments: 12, slice: 0.55 }, this.scene);
        hair.position.y = bh + hd * 0.42;
        hair.rotation.x = 0.1;
        hair.parent = root;
        hair.material = hairMat;
      } else if (style.hairStyle === "long") {
        const hairTop = MeshBuilder.CreateSphere(`npc_hair_top_${id}`,
          { diameter: hd * 1.08, segments: 12, slice: 0.5 }, this.scene);
        hairTop.position.y = bh + hd * 0.45;
        hairTop.parent = root;
        hairTop.material = hairMat;
        const hairBack = MeshBuilder.CreateCapsule(`npc_hair_back_${id}`,
          { height: bh * 0.35, radius: hd * 0.25 }, this.scene);
        hairBack.position.set(0, bh * 0.72, -hd * 0.3);
        hairBack.parent = root;
        hairBack.material = hairMat;
      } else if (style.hairStyle === "ponytail") {
        const hairTop = MeshBuilder.CreateSphere(`npc_hair_${id}`,
          { diameter: hd * 1.05, segments: 12, slice: 0.6 }, this.scene);
        hairTop.position.y = bh + hd * 0.4;
        hairTop.parent = root;
        hairTop.material = hairMat;
        const ponytail = MeshBuilder.CreateCylinder(`npc_ponytail_${id}`,
          { height: bh * 0.28, diameterTop: hd * 0.12, diameterBottom: hd * 0.18 }, this.scene);
        ponytail.position.set(0, bh * 0.82, -hd * 0.35);
        ponytail.rotation.x = 0.4;
        ponytail.parent = root;
        ponytail.material = hairMat;
      } else if (style.hairStyle === "bun") {
        const hairTop = MeshBuilder.CreateSphere(`npc_hair_${id}`,
          { diameter: hd * 1.02, segments: 12, slice: 0.55 }, this.scene);
        hairTop.position.y = bh + hd * 0.4;
        hairTop.parent = root;
        hairTop.material = hairMat;
        const bun = MeshBuilder.CreateSphere(`npc_bun_${id}`,
          { diameter: hd * 0.35, segments: 10 }, this.scene);
        bun.position.set(0, bh + hd * 0.65, -hd * 0.15);
        bun.parent = root;
        bun.material = hairMat;
      }
    }

    // === BEARD ===
    if (style.hasBeard) {
      const beardMat = new StandardMaterial(`npc_beard_mat_${id}`, this.scene);
      beardMat.diffuseColor = new Color3(style.hairColor[0] * 0.9, style.hairColor[1] * 0.9, style.hairColor[2] * 0.9);
      const beard = MeshBuilder.CreateSphere(`npc_beard_${id}`,
        { diameter: hd * 0.5, segments: 10, slice: 0.5 }, this.scene);
      beard.position.set(0, bh + hd * 0.05, hd * 0.25);
      beard.scaling = new Vector3(1, 1.3, 0.7);
      beard.rotation.x = 0.3;
      beard.parent = root;
      beard.material = beardMat;
    }

    // === HELMET (Guard) ===
    if (style.hasHelmet) {
      const helmetMat = new StandardMaterial(`npc_helmet_mat_${id}`, this.scene);
      helmetMat.diffuseColor = new Color3(0.45, 0.42, 0.38);
      helmetMat.specularColor = new Color3(0.4, 0.38, 0.35);
      const helmet = MeshBuilder.CreateSphere(`npc_helmet_${id}`,
        { diameter: hd * 1.2, segments: 14, slice: 0.6 }, this.scene);
      helmet.position.y = bh + hd * 0.38;
      helmet.parent = root;
      helmet.material = helmetMat;
      // Helmet crest
      const crest = MeshBuilder.CreateBox(`npc_crest_${id}`,
        { width: hd * 0.08, height: hd * 0.35, depth: hd * 0.6 }, this.scene);
      crest.position.set(0, bh + hd * 0.7, -hd * 0.05);
      crest.parent = root;
      const crestMat = new StandardMaterial(`npc_crest_mat_${id}`, this.scene);
      crestMat.diffuseColor = new Color3(0.7, 0.2, 0.2);
      crest.material = crestMat;
    }

    // === HOOD (Wanderer, Healer) ===
    if (style.hasHood) {
      const hoodMat = new StandardMaterial(`npc_hood_mat_${id}`, this.scene);
      hoodMat.diffuseColor = new Color3(style.accentColor[0] * 0.6, style.accentColor[1] * 0.6, style.accentColor[2] * 0.6);
      const hood = MeshBuilder.CreateSphere(`npc_hood_${id}`,
        { diameter: hd * 1.35, segments: 12, slice: 0.55 }, this.scene);
      hood.position.y = bh + hd * 0.32;
      hood.rotation.x = -0.25;
      hood.parent = root;
      hood.material = hoodMat;
    }

    // === HAT (Villager, Merchant) ===
    if (style.hasHat) {
      const hatMat = new StandardMaterial(`npc_hat_mat_${id}`, this.scene);
      hatMat.diffuseColor = new Color3(style.accentColor[0] * 0.8, style.accentColor[1] * 0.75, style.accentColor[2] * 0.7);
      // Hat brim
      const brim = MeshBuilder.CreateCylinder(`npc_hat_brim_${id}`,
        { height: hd * 0.08, diameter: hd * 1.4, tessellation: 16 }, this.scene);
      brim.position.y = bh + hd * 0.55;
      brim.parent = root;
      brim.material = hatMat;
      // Hat top
      const hatTop = MeshBuilder.CreateCylinder(`npc_hat_top_${id}`,
        { height: hd * 0.35, diameterTop: hd * 0.5, diameterBottom: hd * 0.65, tessellation: 14 }, this.scene);
      hatTop.position.y = bh + hd * 0.75;
      hatTop.parent = root;
      hatTop.material = hatMat;
    }

    // === CAPE (Guard, Merchant, Wanderer) ===
    if (style.hasCape) {
      const capeMat = new StandardMaterial(`npc_cape_mat_${id}`, this.scene);
      capeMat.diffuseColor = new Color3(style.bodyColor[0] * 0.7, style.bodyColor[1] * 0.7, style.bodyColor[2] * 0.7);
      capeMat.backFaceCulling = false;
      const cape = MeshBuilder.CreateCylinder(`npc_cape_${id}`,
        { height: bh * 0.65, diameterTop: bw * 0.7, diameterBottom: bw * 0.95, tessellation: 8 }, this.scene);
      cape.position.set(0, bh * 0.42, -bw * 0.18);
      cape.scaling = new Vector3(1, 1, 0.4);
      cape.parent = root;
      cape.material = capeMat;
    }

    // === STAFF (Wanderer, Healer) ===
    if (style.hasStaff) {
      const staffMat = new StandardMaterial(`npc_staff_mat_${id}`, this.scene);
      staffMat.diffuseColor = new Color3(0.45, 0.32, 0.22);
      const staff = MeshBuilder.CreateCylinder(`npc_staff_${id}`,
        { height: bh * 1.1, diameter: bw * 0.08, tessellation: 8 }, this.scene);
      staff.position.set(bw * 0.55, bh * 0.55, 0);
      staff.rotation.z = -0.15;
      staff.parent = root;
      staff.material = staffMat;
      // Staff orb
      const staffOrb = MeshBuilder.CreateSphere(`npc_staff_orb_${id}`,
        { diameter: bw * 0.22, segments: 10 }, this.scene);
      staffOrb.position.set(bw * 0.50, bh * 1.12, 0);
      staffOrb.parent = root;
      const orbMat = new StandardMaterial(`npc_staff_orb_mat_${id}`, this.scene);
      const orbColor = templateName === "healer" ? [0.4, 0.9, 0.6] : [0.5, 0.6, 0.9];
      orbMat.diffuseColor = new Color3(orbColor[0], orbColor[1], orbColor[2]);
      orbMat.emissiveColor = new Color3(orbColor[0] * 0.35, orbColor[1] * 0.35, orbColor[2] * 0.35);
      orbMat.alpha = 0.9;
      staffOrb.material = orbMat;
    }

    // === SHIELD (Guard) ===
    if (style.hasShield) {
      const shieldMat = new StandardMaterial(`npc_shield_mat_${id}`, this.scene);
      shieldMat.diffuseColor = new Color3(0.5, 0.48, 0.42);
      shieldMat.specularColor = new Color3(0.35, 0.32, 0.28);
      const shield = MeshBuilder.CreateCylinder(`npc_shield_${id}`,
        { height: bw * 0.12, diameter: bh * 0.45, tessellation: 16 }, this.scene);
      shield.position.set(-bw * 0.52, bh * 0.48, bw * 0.1);
      shield.rotation.z = Math.PI / 2;
      shield.rotation.y = 0.3;
      shield.parent = root;
      shield.material = shieldMat;
    }

    // === APRON (Blacksmith) ===
    if (style.hasApron) {
      const apronMat = new StandardMaterial(`npc_apron_mat_${id}`, this.scene);
      apronMat.diffuseColor = new Color3(0.35, 0.28, 0.22);
      const apron = MeshBuilder.CreateBox(`npc_apron_${id}`,
        { width: bw * 0.65, height: bh * 0.45, depth: bw * 0.08 }, this.scene);
      apron.position.set(0, bh * 0.35, bw * 0.28);
      apron.parent = root;
      apron.material = apronMat;
    }

    // Add shadows to all meshes
    root.getChildMeshes().forEach((m) => {
      m.receiveShadows = true;
      if (this.shadowGenerator) {
        try { this.shadowGenerator.addShadowCaster(m, true); } catch (_) { /* skip */ }
      }
    });

    return root;
  }

  // ────────────────────────── Animation Helpers ────────────────────────────────

  private _buildAnimMap(groups: AnimationGroup[], id?: string): Map<string, AnimationGroup> {
    // Exact name map — identical to PlayerController
    const nameMap: Record<string, string> = {
      "Idle_Loop":           "idle",
      "Idle_Talking_Loop":   "talkIdle",
      "Walk_Loop":           "walk",
      "Jog_Fwd_Loop":       "jog",
      "Sprint_Loop":        "sprint",
      "Jump_Start":         "jumpStart",
      "Jump_Loop":          "jumpLoop",
      "Jump_Land":          "jumpLand",
      "Dance_Loop":         "dance",
      "Crouch_Idle_Loop":   "crouchIdle",
      "Crouch_Fwd_Loop":    "crouchWalk",
    };

    // instantiateModelsToScene prefixes every anim name with "npc_${id}_".
    // Strip that prefix so exact matching against the raw clip names works.
    const prefix = id ? `npc_${id}_` : "";
    const baseName = (name: string) =>
      prefix && name.startsWith(prefix) ? name.slice(prefix.length) : name;

    const map = new Map<string, AnimationGroup>();
    for (const group of groups) {
      const role = nameMap[baseName(group.name)];
      if (role && !map.has(role)) {
        map.set(role, group);
        console.log(`[NPCManager] Anim mapped: "${group.name}" → "${role}"`);
      }
    }

    // Fuzzy fallbacks — skip contextual variants (sitting / crouching / swimming etc.)
    const isContextual = (name: string) =>
      /(sitting|crouch|swim|torch|talking|pistol|spell|sword|driving|fixing)/i.test(name);

    if (!map.has("idle")) {
      const fb = groups.find((g) => {
        const base = baseName(g.name).toLowerCase();
        return base.includes("idle") && !isContextual(base);
      }) ?? groups.find((g) => baseName(g.name).toLowerCase().includes("idle"));
      if (fb) map.set("idle", fb);
    }
    if (!map.has("walk")) {
      const fb = groups.find((g) => {
        const base = baseName(g.name).toLowerCase();
        return base.includes("walk") && !isContextual(base);
      }) ?? groups.find((g) => baseName(g.name).toLowerCase().includes("run"));
      if (fb) map.set("walk", fb);
    }
    return map;
  }

  private _findIdleAnimLegacy(groups: AnimationGroup[], id?: string): AnimationGroup | null {
    return this._buildAnimMap(groups, id).get("idle") ?? null;
  }

  private _findWalkAnimLegacy(groups: AnimationGroup[], id?: string): AnimationGroup | null {
    return this._buildAnimMap(groups, id).get("walk") ?? null;
  }

  private _findTalkAnimLegacy(groups: AnimationGroup[], id?: string): AnimationGroup | null {
    return this._buildAnimMap(groups, id).get("talkIdle") ?? null;
  }

  /**
   * Switch between idle and walk animations depending on whether the NPC
   * moved this frame.  Only triggers a change when the state actually flips
   * to avoid restarting the same clip every frame.
   */
  private _updateAnimationState(inst: NPCInstance): void {
    // Don't touch animations while the NPC is in talking mode
    if (inst._isTalking) return;

    if (inst._isMoving) {
      // ── WALKING ──
      if (inst.walkAnim) {
        if (!inst.walkAnim.isPlaying) {
          inst.idleAnim?.stop();
          inst.walkAnim.start(true, 1.0);
        }
      } else {
        // No walk clip available — just keep idle going so the NPC doesn't T-pose
        if (inst.idleAnim && !inst.idleAnim.isPlaying) {
          inst.idleAnim.start(true, 1.0);
        }
      }
    } else {
      // ── IDLE ──
      if (inst.walkAnim?.isPlaying) {
        inst.walkAnim.stop();
      }
      if (inst.idleAnim && !inst.idleAnim.isPlaying) {
        inst.idleAnim.start(true, 1.0);
      }
    }
  }

  private _anyContainer(): AssetContainer | undefined {
    if (this._containerKeys.length === 0) return undefined;
    return this._containers.get(
      this._containerKeys[this._spawnCounter % this._containerKeys.length]
    );
  }

  private _pickModelFile(): string | undefined {
    if (this._containerKeys.length === 0) return undefined;
    return this._containerKeys[this._spawnCounter % this._containerKeys.length];
  }

  // ────────────────────────── Nameplates ──────────────────────────────────────

  /** Create a persistent nameplate above the NPC's head */
  private _createNameplate(inst: NPCInstance): void {
    const nameplate = document.createElement("div");
    nameplate.className = "npc-nameplate";
    nameplate.innerHTML = `<span class="npc-name">${inst.name}</span>`;
    document.body.appendChild(nameplate);
    inst.nameplateEl = nameplate;
    
    // Add CSS if not already added
    if (!document.getElementById("npc-nameplate-styles")) {
      const style = document.createElement("style");
      style.id = "npc-nameplate-styles";
      style.textContent = `
        .npc-nameplate {
          position: fixed;
          transform: translateX(-50%);
          pointer-events: none;
          z-index: 50;
          text-align: center;
          font-family: 'Segoe UI', sans-serif;
        }
        .npc-name {
          display: inline-block;
          padding: 3px 10px;
          background: rgba(0, 0, 0, 0.7);
          border-radius: 4px;
          color: #fff;
          font-size: 12px;
          font-weight: 500;
          text-shadow: 0 1px 2px rgba(0,0,0,0.8);
          white-space: nowrap;
        }
        .npc-nameplate.villager .npc-name { color: #9cd49c; }
        .npc-nameplate.guard .npc-name { color: #7eb8e8; }
        .npc-nameplate.merchant .npc-name { color: #e8c87e; }
        .npc-nameplate.wanderer .npc-name { color: #c8a8e8; }
        .npc-nameplate.healer .npc-name { color: #a8e8d8; }
        .npc-nameplate.blacksmith .npc-name { color: #e8a88a; }
        
        .quest-indicator {
          display: block;
          font-size: 18px;
          font-weight: bold;
          text-shadow: 0 0 8px currentColor;
          animation: quest-pulse 1.5s ease-in-out infinite;
          margin-bottom: 2px;
        }
        .quest-indicator.quest-available { color: #ffd700; }
        .quest-indicator.quest-progress { color: #87ceeb; }
        .quest-indicator.quest-complete { color: #90ee90; }
        
        @keyframes quest-pulse {
          0%, 100% { transform: scale(1); opacity: 1; }
          50% { transform: scale(1.2); opacity: 0.8; }
        }
      `;
      document.head.appendChild(style);
    }
    
    // Add template class for color coding
    nameplate.classList.add(inst.template);
  }

  /** Set quest indicator above NPC (!= quest available, ?= in progress, ✓= can turn in) */
  public setQuestIndicator(npcId: string, type: "available" | "progress" | "complete" | null): void {
    const inst = this.npcs.get(npcId);
    if (!inst || !inst.nameplateEl) return;
    
    // Remove existing indicator
    if (inst.questIndicator) {
      inst.questIndicator.remove();
      inst.questIndicator = null;
    }
    
    if (type) {
      const indicator = document.createElement("span");
      indicator.className = `quest-indicator quest-${type}`;
      indicator.textContent = type === "available" ? "!" : type === "progress" ? "?" : "✓";
      inst.nameplateEl.insertBefore(indicator, inst.nameplateEl.firstChild);
      inst.questIndicator = indicator;
    }
  }

  // ────────────────────────── Speech Bubbles ──────────────────────────────────

  private _showSpeechBubble(inst: NPCInstance, message: string): void {
    if (inst.bubbleEl) {
      inst.bubbleEl.remove();
      if (inst.bubbleTimeout) clearTimeout(inst.bubbleTimeout);
    }
    const bubble = document.createElement("div");
    bubble.className = "npc-speech-bubble";
    bubble.textContent = `${inst.name}: ${message}`;
    document.body.appendChild(bubble);
    inst.bubbleEl = bubble;
    inst.bubbleTimeout = setTimeout(() => {
      bubble.remove();
      inst.bubbleEl = null;
    }, 5000);
  }

  /** Called every frame to reposition speech bubbles and nameplates using screen coords. */
  public updateBubblePositions(camera: Camera): void {
    const engine = this.scene.getEngine();
    const renderW = engine.getRenderWidth();
    const renderH = engine.getRenderHeight();

    // Camera transform matrix (view * projection)
    const transform = camera.getTransformationMatrix();
    const viewport = camera.viewport.toGlobal(renderW, renderH);

    for (const inst of this.npcs.values()) {
      const headY = inst.root.position.y +
        inst.appearance.bodyHeight +
        inst.appearance.headDiameter * 0.6;
      const worldPos = new Vector3(
        inst.root.position.x,
        headY,
        inst.root.position.z
      );

      const projected = Vector3.Project(
        worldPos,
        Matrix.Identity(),
        transform,
        viewport
      );

      // projected.z > 1 means behind camera
      const isBehindCamera = projected.z < 0 || projected.z > 1;

      // Update nameplate position
      if (inst.nameplateEl) {
        if (isBehindCamera) {
          inst.nameplateEl.style.display = "none";
        } else {
          inst.nameplateEl.style.display = "";
          inst.nameplateEl.style.left = `${projected.x}px`;
          inst.nameplateEl.style.top = `${projected.y - 30}px`;
        }
      }

      // Update bubble position (above nameplate)
      if (inst.bubbleEl) {
        if (isBehindCamera) {
          inst.bubbleEl.style.display = "none";
        } else {
          inst.bubbleEl.style.display = "";
          inst.bubbleEl.style.left = `${projected.x}px`;
          inst.bubbleEl.style.top = `${projected.y - 70}px`;
        }
      }
    }
  }

  // ────────────────────────── Proximity Check ─────────────────────────────────

  /** Returns list of NPC IDs within interact range of the given position. */
  public getNearbyNPCs(pos: Vector3): string[] {
    const nearby: string[] = [];
    for (const inst of this.npcs.values()) {
      if (!inst.interactable) continue;
      const d = Vector3.Distance(inst.root.position, pos);
      if (d <= inst.interactDistance) nearby.push(inst.id);
    }
    return nearby;
  }

  /**
   * Returns the world-space distance from the given position to a specific NPC.
   * Returns Infinity if the NPC doesn't exist.
   */
  public getDistanceToNPC(id: string, pos: Vector3): number {
    const inst = this.npcs.get(id);
    if (!inst) return Infinity;
    return Vector3.Distance(inst.root.position, pos);
  }

  /** Returns all NPC ids and their root TransformNodes (used by CollisionSystem). */
  public getNPCRoots(): { id: string; root: TransformNode }[] {
    const result: { id: string; root: TransformNode }[] = [];
    for (const inst of this.npcs.values()) {
      result.push({ id: inst.id, root: inst.root });
    }
    return result;
  }

  /** Teleport an NPC to a new position and update its spawn anchor. */
  public teleportNPC(id: string, position: [number, number, number]): boolean {
    const inst = this.npcs.get(id);
    if (!inst) return false;
    inst.root.position.x = position[0];
    inst.root.position.y = position[1];
    inst.root.position.z = position[2];
    inst.position = [...position] as [number, number, number];
    inst._spawnPosition = [...position] as [number, number, number];
    inst._wanderTarget = null;
    inst._wanderTimer = 0;
    return true;
  }

  /** Returns basic display info for an NPC by id (used to prime AIService). */
  public getNPC(id: string): { id: string; name: string; greeting: string; template: string } | null {
    const inst = this.npcs.get(id);
    if (!inst) return null;
    return {
      id:       inst.id,
      name:     inst.name,
      greeting: inst.dialogue.greeting ?? "",
      template: inst.template,
    };
  }

  // ────────────────────────── Utilities ───────────────────────────────────────

  private _deepMerge(target: any, source: any): any {
    if (!source) return target;
    const result = { ...target };
    for (const key of Object.keys(source)) {
      if (
        source[key] && typeof source[key] === "object" &&
        !Array.isArray(source[key]) &&
        target[key] && typeof target[key] === "object"
      ) {
        result[key] = this._deepMerge(target[key], source[key]);
      } else {
        result[key] = source[key];
      }
    }
    return result;
  }
}
