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

function getTreeMaterials(scene: Scene) {
  if (!_treeMats.trunk) {
    const trunk = new StandardMaterial("tree_trunk_mat", scene);
    trunk.diffuseColor = new Color3(0.42, 0.26, 0.12);
    trunk.specularColor = new Color3(0.05, 0.05, 0.05);
    _treeMats.trunk = trunk;
  }
  if (!_treeMats.foliage) {
    const foliage = new StandardMaterial("tree_foliage_mat", scene);
    foliage.diffuseColor = new Color3(0.18, 0.52, 0.18);
    foliage.specularColor = new Color3(0.05, 0.1, 0.05);
    _treeMats.foliage = foliage;
  }
  return { trunk: _treeMats.trunk!, foliage: _treeMats.foliage! };
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

    // Trunk
    const trunk = MeshBuilder.CreateCylinder(
      `tree_trunk_${id}`,
      { height: 3 * sf, diameterTop: 0.25 * sf, diameterBottom: 0.4 * sf, tessellation: 8 },
      this.scene
    );
    trunk.material = trunkMat;
    trunk.position.y = (3 * sf) / 2;
    trunk.parent = root;
    trunk.receiveShadows = true;
    if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(trunk);

    // Foliage — three overlapping cone layers for a fuller tree
    const coneDefs = [
      { y: 2.2 * sf, h: 2.8 * sf, dBot: 3.2 * sf, dTop: 0 },
      { y: 3.5 * sf, h: 2.4 * sf, dBot: 2.6 * sf, dTop: 0 },
      { y: 4.6 * sf, h: 2.0 * sf, dBot: 1.8 * sf, dTop: 0 },
    ];

    coneDefs.forEach((def, i) => {
      const cone = MeshBuilder.CreateCylinder(
        `tree_foliage${i}_${id}`,
        { height: def.h, diameterBottom: def.dBot, diameterTop: def.dTop, tessellation: 8 },
        this.scene
      );
      // Slightly vary the green per layer
      const varMat = foliageMat.clone(`tree_foliage${i}_mat_${id}`);
      const variation = 0.03 * i;
      (varMat as StandardMaterial).diffuseColor = new Color3(
        0.15 + variation,
        0.48 + variation,
        0.13 + variation
      );
      cone.material = varMat;
      cone.position.y = def.y + def.h / 2;
      cone.parent = root;
      cone.receiveShadows = true;
      if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(cone);
    });

    return root;
  }

  private _buildRock(id: string, params: AddObjectParams): Mesh {
    const sc = params.scale ?? [1, 0.7, 1];
    const rock = MeshBuilder.CreateSphere(
      `rock_${id}`,
      { diameter: 1.2, segments: 6 },
      this.scene
    );
    rock.scaling = new Vector3(sc[0] * 1.0, sc[1] * 0.8, sc[2] * 1.0);
    const pos = params.position;
    rock.position = new Vector3(pos[0], pos[1] + 0.3, pos[2]);

    const mat = new StandardMaterial(`rock_mat_${id}`, this.scene);
    mat.diffuseColor = new Color3(0.55, 0.52, 0.48);
    mat.specularColor = new Color3(0.1, 0.1, 0.1);
    rock.material = mat;
    rock.checkCollisions = true;
    rock.receiveShadows = true;
    if (this.shadowGenerator) this.shadowGenerator.addShadowCaster(rock);

    return rock;
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
