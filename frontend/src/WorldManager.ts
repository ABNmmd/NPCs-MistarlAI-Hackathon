import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Texture,
  Vector3,
  TransformNode,
  Mesh,
  ShadowGenerator,
  HemisphericLight,
  DirectionalLight,
  Color4,
} from "@babylonjs/core";

interface WorldObject {
  id: string;
  type: "tree" | "rock" | "building" | "box" | "sphere" | "cylinder" | "cone";
  position: [number, number, number];
  scale?: [number, number, number];
  rotation?: [number, number, number];
  material?: Record<string, any>;
  node: TransformNode | Mesh;
}

interface AddObjectParams {
  id?: string;
  type: WorldObject["type"];
  position: [number, number, number];
  scale?: [number, number, number];
  rotation?: [number, number, number];
  material?: Record<string, any>;
}

// Shared materials (created once, reused)
const _treeMats: { trunk?: StandardMaterial; foliage?: StandardMaterial } = {};
const _crystalMats: StandardMaterial[] = [];

function getTreeMaterials(scene: Scene) {
  if (!_treeMats.trunk) {
    const trunk = new StandardMaterial("tree_trunk_mat", scene);
    // Natural brown bark
    trunk.diffuseColor = new Color3(0.45, 0.30, 0.18);
    trunk.specularColor = new Color3(0.1, 0.08, 0.06);
    _treeMats.trunk = trunk;
  }
  if (!_treeMats.foliage) {
    const foliage = new StandardMaterial("tree_foliage_mat", scene);
    // Natural green foliage
    foliage.diffuseColor = new Color3(0.25, 0.55, 0.22);
    foliage.specularColor = new Color3(0.08, 0.12, 0.08);
    _treeMats.foliage = foliage;
  }
  return { trunk: _treeMats.trunk!, foliage: _treeMats.foliage! };
}

// Get or create natural rock materials
function getRockMaterial(scene: Scene, index: number): StandardMaterial {
  if (!_crystalMats[index]) {
    const mat = new StandardMaterial(`rock_mat_${index}`, scene);
    // Natural rock color palette: gray, brown, slate variations
    const colors = [
      { diffuse: [0.52, 0.50, 0.48], specular: [0.12, 0.12, 0.12] },
      { diffuse: [0.48, 0.45, 0.40], specular: [0.10, 0.10, 0.08] },
      { diffuse: [0.55, 0.52, 0.50], specular: [0.15, 0.14, 0.13] },
      { diffuse: [0.45, 0.42, 0.38], specular: [0.08, 0.08, 0.07] },
      { diffuse: [0.58, 0.55, 0.52], specular: [0.14, 0.13, 0.12] },
    ];
    const c = colors[index % colors.length];
    mat.diffuseColor = new Color3(c.diffuse[0], c.diffuse[1], c.diffuse[2]);
    mat.specularColor = new Color3(c.specular[0], c.specular[1], c.specular[2]);
    mat.specularPower = 32;
    _crystalMats[index] = mat;
  }
  return _crystalMats[index];
}

export class WorldManager {
  private objects = new Map<string, WorldObject>();
  private _objCounter = 0;
  private shadowGenerator?: ShadowGenerator;
  private hemiLight?: HemisphericLight;
  private dirLight?: DirectionalLight;

  constructor(private scene: Scene, shadowGenerator?: ShadowGenerator) {
    this.shadowGenerator = shadowGenerator;
  }

  /** Register light references so updateWorld can modify them. */
  public setLightRefs(hemi: HemisphericLight, dir: DirectionalLight): void {
    this.hemiLight = hemi;
    this.dirLight = dir;
  }

  /** Build all objects defined in world.json objects array. */
  public buildFromConfig(objects: any[]): void {
    for (const obj of objects) {
      try {
        this.addObject({
          id: obj.id,
          type: obj.type,
          position: obj.position,
          scale: obj.scale,
          rotation: obj.rotation,
          material: obj.material,
        });
      } catch (e) {
        console.warn(`[WorldManager] Failed to build object "${obj.id}":`, e);
      }
    }
    console.log(`[WorldManager] Built ${this.objects.size} world objects.`);
  }

  /** Add a single object to the scene (from config or runtime). Returns the root node. */
  public addObject(params: AddObjectParams): TransformNode | Mesh | null {
    const id = params.id ?? `obj_${++this._objCounter}`;
    if (this.objects.has(id)) {
      console.warn(`[WorldManager] Object "${id}" already exists.`);
      return null;
    }

    let node: TransformNode | Mesh;

    switch (params.type) {
      case "tree":
        node = this._buildTree(id, params);
        break;
      case "rock":
        node = this._buildRock(id, params);
        break;
      case "building":
        node = this._buildBuilding(id, params);
        break;
      case "box":
        node = this._buildPrimitive("box", id, params);
        break;
      case "sphere":
        node = this._buildPrimitive("sphere", id, params);
        break;
      case "cylinder":
        node = this._buildPrimitive("cylinder", id, params);
        break;
      case "cone":
        node = this._buildPrimitive("cone", id, params);
        break;
      default:
        console.warn(`[WorldManager] Unknown object type: ${(params as any).type}`);
        return null;
    }

    this.objects.set(id, {
      id,
      type: params.type,
      position: params.position,
      scale: params.scale,
      rotation: params.rotation,
      material: params.material,
      node,
    });

    return node;
  }

  /** Remove an object from the scene. Returns true on success. */
  public removeObject(id: string): boolean {
    const obj = this.objects.get(id);
    if (!obj) return false;

    // Both TransformNode and Mesh extend TransformNode — just dispose node + children.
    obj.node.getChildMeshes().forEach((m) => m.dispose());
    (obj.node as TransformNode).dispose();

    this.objects.delete(id);
    return true;
  }

  /** Get serializable list of all world objects. */
  public serializeObjects(): any[] {
    return Array.from(this.objects.values()).map((o) => ({
      id: o.id,
      type: o.type,
      position: o.position,
      scale: o.scale ?? [1, 1, 1],
      rotation: o.rotation ?? [0, 0, 0],
    }));
  }

  /** Update world-level properties (fog, lighting, sky). */
  public updateWorld(config: any): void {
    if (config.fog) {
      if (config.fog.enabled === false) {
        this.scene.fogMode = Scene.FOGMODE_NONE;
      } else if (config.fog.density !== undefined) {
        this.scene.fogMode = Scene.FOGMODE_EXP2;
        this.scene.fogDensity = config.fog.density;
      }
      if (config.fog.color) {
        this.scene.fogColor = new Color3(
          config.fog.color[0],
          config.fog.color[1],
          config.fog.color[2]
        );
      }
    }

    if (config.sky?.clearColor) {
      const c = config.sky.clearColor;
      this.scene.clearColor = new Color4(c[0], c[1], c[2], c[3] ?? 1.0);
    }

    if (config.lighting) {
      const l = config.lighting;
      if (this.hemiLight && l.ambient?.intensity !== undefined) {
        this.hemiLight.intensity = l.ambient.intensity;
      }
      if (this.dirLight && l.directional?.intensity !== undefined) {
        this.dirLight.intensity = l.directional.intensity;
      }
    }
  }

  // ──────────────── Procedural Builders ────────────────────────────────────

  private _buildTree(id: string, params: AddObjectParams): TransformNode {
    const root = new TransformNode(`tree_${id}`, this.scene);
    const pos = params.position;
    root.position = new Vector3(pos[0], pos[1], pos[2]);

    // Optional overall scale factor (use first component or 1)
    const sf = params.scale ? params.scale[0] : 1.0;

    const { trunk: trunkMat, foliage: foliageMat } = getTreeMaterials(this.scene);

    // Taller trunk to elevate foliage above NPCs
    const trunk = MeshBuilder.CreateCylinder(
      `tree_trunk_${id}`,
      { height: 5.0 * sf, diameterTop: 0.22 * sf, diameterBottom: 0.45 * sf, tessellation: 12 },
      this.scene
    );
    trunk.material = trunkMat;
    trunk.position.y = (5.0 * sf) / 2;
    trunk.parent = root;
    trunk.receiveShadows = true;
    if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(trunk);

    // Foliage raised higher so NPCs are visible below
    const foliageDefs = [
      { y: 5.0 * sf, radius: 2.2 * sf, offset: { x: 0, z: 0 } },
      { y: 6.0 * sf, radius: 1.8 * sf, offset: { x: 0.4 * sf, z: 0.3 * sf } },
      { y: 5.5 * sf, radius: 1.6 * sf, offset: { x: -0.5 * sf, z: 0.2 * sf } },
      { y: 6.5 * sf, radius: 1.4 * sf, offset: { x: 0.2 * sf, z: -0.4 * sf } },
      { y: 7.2 * sf, radius: 1.0 * sf, offset: { x: 0, z: 0 } },
    ];

    foliageDefs.forEach((def, i) => {
      const sphere = MeshBuilder.CreateSphere(
        `tree_foliage${i}_${id}`,
        { diameter: def.radius * 2, segments: 12 },
        this.scene
      );
      // Natural green variations per layer
      const varMat = foliageMat.clone(`tree_foliage${i}_mat_${id}`);
      const variation = 0.03 * i;
      (varMat as StandardMaterial).diffuseColor = new Color3(
        0.22 + variation * 0.5,
        0.52 + variation,
        0.20 + variation * 0.3
      );
      sphere.material = varMat;
      sphere.position.y = def.y;
      sphere.position.x = def.offset.x;
      sphere.position.z = def.offset.z;
      sphere.parent = root;
      sphere.receiveShadows = true;
      if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(sphere);
    });

    return root;
  }

  private _buildRock(id: string, params: AddObjectParams): TransformNode {
    const root = new TransformNode(`rock_${id}`, this.scene);
    const pos = params.position;
    root.position = new Vector3(pos[0], pos[1] + 0.1, pos[2]);

    const sc = params.scale ?? [1, 0.7, 1];
    const rockIndex = Math.floor(Math.random() * 5);
    const mat = getRockMaterial(this.scene, rockIndex);

    // Main rock - smooth rounded boulder
    const mainRock = MeshBuilder.CreateSphere(
      `rock_main_${id}`,
      { diameter: 1.0 * sc[0], segments: 8 },
      this.scene
    );
    mainRock.scaling = new Vector3(sc[0] * 1.2, sc[1] * 0.7, sc[2] * 1.0);
    mainRock.position.y = 0.25 * sc[1];
    mainRock.rotation.y = Math.random() * Math.PI;
    mainRock.material = mat;
    mainRock.parent = root;
    mainRock.checkCollisions = true;
    mainRock.receiveShadows = true;
    if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(mainRock);

    // Add smaller rocks around for natural cluster look
    const smallRockCount = 1 + Math.floor(Math.random() * 2);
    for (let i = 0; i < smallRockCount; i++) {
      const angle = (i / smallRockCount) * Math.PI * 2 + Math.random() * 0.8;
      const dist = 0.4 + Math.random() * 0.3;
      const smallMat = getRockMaterial(this.scene, (rockIndex + i + 1) % 5);
      
      const smallRock = MeshBuilder.CreateSphere(
        `rock_small_${id}_${i}`,
        { diameter: 0.4 + Math.random() * 0.3, segments: 6 },
        this.scene
      );
      smallRock.scaling = new Vector3(
        0.8 + Math.random() * 0.4,
        0.5 + Math.random() * 0.3,
        0.8 + Math.random() * 0.4
      );
      smallRock.position.x = Math.cos(angle) * dist * sc[0];
      smallRock.position.z = Math.sin(angle) * dist * sc[2];
      smallRock.position.y = 0.1 * sc[1];
      smallRock.material = smallMat;
      smallRock.parent = root;
      smallRock.receiveShadows = true;
      if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(smallRock);
    }

    return root;
  }

  private _buildBuilding(id: string, params: AddObjectParams): TransformNode {
    const root = new TransformNode(`building_${id}`, this.scene);
    const pos = params.position;
    root.position = new Vector3(pos[0], pos[1], pos[2]);
    const sc = params.scale ?? [1, 1, 1];
    const wallColor = params.material?.wallColor ?? [0.85, 0.8, 0.7];
    const roofColor = params.material?.roofColor ?? [0.5, 0.25, 0.2];

    // Walls
    const walls = MeshBuilder.CreateBox(`building_walls_${id}`, {
      width: 6 * sc[0], height: 4 * sc[1], depth: 6 * sc[2]
    }, this.scene);
    walls.position.y = 2 * sc[1];
    walls.parent = root;
    const wallMat = new StandardMaterial(`building_wall_mat_${id}`, this.scene);
    wallMat.diffuseColor = new Color3(wallColor[0], wallColor[1], wallColor[2]);
    walls.material = wallMat;
    walls.checkCollisions = true;
    walls.receiveShadows = true;
    if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(walls);

    // Roof
    const roof = MeshBuilder.CreateCylinder(`building_roof_${id}`, {
      height: 2 * sc[1], diameterBottom: 8 * sc[0], diameterTop: 0, tessellation: 4
    }, this.scene);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 4 * sc[1] + sc[1];
    roof.parent = root;
    const roofMat = new StandardMaterial(`building_roof_mat_${id}`, this.scene);
    roofMat.diffuseColor = new Color3(roofColor[0], roofColor[1], roofColor[2]);
    roof.material = roofMat;
    roof.receiveShadows = true;
    if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(roof);

    return root;
  }

  private _buildPrimitive(type: string, id: string, params: AddObjectParams): Mesh {
    const sc = params.scale ?? [1, 1, 1];
    const pos = params.position;
    let mesh: Mesh;

    switch (type) {
      case "box":
        mesh = MeshBuilder.CreateBox(`box_${id}`, { width: sc[0], height: sc[1], depth: sc[2] }, this.scene);
        break;
      case "sphere":
        mesh = MeshBuilder.CreateSphere(`sphere_${id}`, { diameter: sc[0] }, this.scene);
        break;
      case "cylinder":
        mesh = MeshBuilder.CreateCylinder(`cyl_${id}`, { height: sc[1] * 2, diameter: sc[0] }, this.scene);
        break;
      case "cone":
        mesh = MeshBuilder.CreateCylinder(`cone_${id}`, { height: sc[1] * 2, diameterBottom: sc[0], diameterTop: 0 }, this.scene);
        break;
      default:
        mesh = MeshBuilder.CreateBox(`prim_${id}`, {}, this.scene);
    }

    mesh.position = new Vector3(pos[0], pos[1] + sc[1] / 2, pos[2]);

    if (params.material?.diffuseColor) {
      const c = params.material.diffuseColor;
      const mat = new StandardMaterial(`prim_mat_${id}`, this.scene);
      mat.diffuseColor = new Color3(c[0], c[1], c[2]);
      mesh.material = mat;
    }

    mesh.receiveShadows = true;
    if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(mesh);
    return mesh;
  }

  /** Apply grass ground material using world.json terrain config. */
  public applyGrassTexture(groundMesh: Mesh, terrainConfig?: any): void {
    const diffuse = terrainConfig?.material?.diffuseColor ?? [0.35, 0.55, 0.25];
    const specular = terrainConfig?.material?.specularColor ?? [0.05, 0.05, 0.05];

    const mat = new StandardMaterial("grass_ground_mat", this.scene);
    mat.diffuseColor = new Color3(diffuse[0], diffuse[1], diffuse[2]);
    mat.specularColor = new Color3(specular[0], specular[1], specular[2]);

    // Procedural grass texture
    const texCanvas = document.createElement("canvas");
    texCanvas.width = 256;
    texCanvas.height = 256;
    const ctx = texCanvas.getContext("2d")!;

    // Base green
    ctx.fillStyle = `rgb(${Math.round(diffuse[0] * 220)},${Math.round(diffuse[1] * 220)},${Math.round(diffuse[2] * 200)})`;
    ctx.fillRect(0, 0, 256, 256);

    // Grass blade-like noise
    for (let i = 0; i < 3000; i++) {
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      const brightness = (Math.random() * 40) - 20;
      const r = Math.max(0, Math.min(255, Math.round(diffuse[0] * 220 + brightness)));
      const g = Math.max(0, Math.min(255, Math.round(diffuse[1] * 220 + brightness)));
      const b = Math.max(0, Math.min(255, Math.round(diffuse[2] * 200 + brightness)));
      ctx.fillStyle = `rgb(${r},${g},${b})`;
      ctx.fillRect(x, y, 1, Math.random() * 4 + 1);
    }

    const tex = new Texture(texCanvas.toDataURL(), this.scene);
    tex.uScale = 60;
    tex.vScale = 60;
    mat.diffuseTexture = tex;

    groundMesh.material = mat;
  }
}
