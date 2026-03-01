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

  /** Speech bubble shown by npcSay */
  bubbleEl: HTMLElement | null;
  bubbleTimeout?: ReturnType<typeof setTimeout>;

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

    // Build mesh (GLB clone or procedural fallback)
    const { root, animGroups } = this._buildNPCMesh(id, appearance, modelFile);
    root.position = new Vector3(pos[0], pos[1], pos[2]);

    // Find and start idle animation
    const idleAnim = this._findIdleAnim(animGroups);
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
      bubbleEl: null,
      _wanderTimer: 0,
      _wanderTarget: null,
      _patrolIdx: 0,
      _patrolWait: 0,
      _moveToTarget: null,
    };

    this.npcs.set(id, inst);
    this._spawnCounter++;
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

    this.npcs.delete(id);
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
    const speed = inst.behavior.speed ?? 1.5;

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
  }

  private _behaviorWander(inst: NPCInstance, dt: number, speed: number): void {
    inst._wanderTimer -= dt;
    if (inst._wanderTimer <= 0 || !inst._wanderTarget) {
      const radius = inst.behavior.wanderRadius ?? 8;
      const angle = Math.random() * Math.PI * 2;
      const dist = Math.random() * radius;
      inst._wanderTarget = new Vector3(
        inst.position[0] + Math.cos(angle) * dist,
        0,
        inst.position[2] + Math.sin(angle) * dist
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

  private _moveToward(inst: NPCInstance, target: Vector3, speed: number, dt: number): void {
    const dir = target.subtract(inst.root.position);
    dir.y = 0;
    const len = dir.length();
    if (len < 0.01) return;
    dir.scaleInPlace(1 / len);

    inst.root.position.addInPlace(dir.scale(speed * dt));
    inst.root.position.y = 0; // keep on ground

    // Face direction of movement
    const angle = Math.atan2(dir.x, dir.z);
    inst.root.rotation.y = angle;
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
    modelFile?: string
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

    // Procedural fallback
    console.warn(`[NPCManager] No GLB for NPC "${id}", using procedural mesh.`);
    return { root: this._buildProceduralMesh(id, appearance), animGroups: [] };
  }

  private _buildProceduralMesh(id: string, appearance: Required<NPCAppearance>): TransformNode {
    const root = new TransformNode(`npc_root_${id}`, this.scene);
    const bh = appearance.bodyHeight;
    const bw = appearance.bodyWidth;
    const hd = appearance.headDiameter;
    const dc = appearance.material?.diffuseColor ?? [0.6, 0.6, 0.6];
    const sc = appearance.material?.specularColor ?? [0.1, 0.1, 0.1];

    const body = MeshBuilder.CreateCylinder(`npc_body_${id}`,
      { height: bh, diameterTop: bw * 0.75, diameterBottom: bw, tessellation: 10 }, this.scene);
    body.position.y = bh / 2;
    body.parent = root;
    const bodyMat = new StandardMaterial(`npc_body_mat_${id}`, this.scene);
    bodyMat.diffuseColor = new Color3(dc[0], dc[1], dc[2]);
    bodyMat.specularColor = new Color3(sc[0], sc[1], sc[2]);
    body.material = bodyMat;

    const head = MeshBuilder.CreateSphere(`npc_head_${id}`,
      { diameter: hd, segments: 8 }, this.scene);
    head.position.y = bh + hd * 0.5;
    head.parent = root;
    const headMat = new StandardMaterial(`npc_head_mat_${id}`, this.scene);
    headMat.diffuseColor = new Color3(
      Math.min(1, dc[0] + 0.15), Math.min(1, dc[1] + 0.08), Math.min(1, dc[2] * 0.85));
    headMat.specularColor = new Color3(0.05, 0.05, 0.05);
    head.material = headMat;

    if (this.shadowGenerator) {
      this.shadowGenerator.addShadowCaster(body);
      this.shadowGenerator.addShadowCaster(head);
    }
    body.receiveShadows = true;
    head.receiveShadows = true;
    return root;
  }

  // ────────────────────────── Animation Helpers ────────────────────────────────

  private _findIdleAnim(groups: AnimationGroup[]): AnimationGroup | null {
    if (groups.length === 0) return null;
    const priority = ["Idle_Loop", "idle", "Idle", "idle_loop", "stand", "Stand"];
    for (const name of priority) {
      const found = groups.find((g) => g.name.toLowerCase() === name.toLowerCase());
      if (found) return found;
    }
    const idleLike = groups.find((g) => g.name.toLowerCase().includes("idle"));
    return idleLike ?? groups[0];
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

  /** Called every frame to reposition speech bubbles using screen coords. */
  public updateBubblePositions(camera: Camera): void {
    const engine = this.scene.getEngine();
    const renderW = engine.getRenderWidth();
    const renderH = engine.getRenderHeight();

    // Camera transform matrix (view * projection)
    const transform = camera.getTransformationMatrix();
    const viewport = camera.viewport.toGlobal(renderW, renderH);

    for (const inst of this.npcs.values()) {
      if (!inst.bubbleEl) continue;

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
      if (projected.z < 0 || projected.z > 1) {
        inst.bubbleEl.style.display = "none";
        continue;
      }

      inst.bubbleEl.style.display = "";
      inst.bubbleEl.style.left = `${projected.x}px`;
      inst.bubbleEl.style.top = `${projected.y - 48}px`;
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
