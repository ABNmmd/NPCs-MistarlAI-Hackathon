import {
  Scene,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Color4,
  Vector3,
  TransformNode,
  Mesh,
  ShadowGenerator,
  Texture,
} from "@babylonjs/core";

// ── Building definition for each NPC place ───────────────────────────────────

export interface BuildingDef {
  id: string;
  /** Label shown above the building */
  label: string;
  /** Which NPC template this place belongs to (matches npcs.json template key) */
  npcTemplate: string;
  /** World position of the building center */
  position: [number, number, number];
  /** [width, height, depth] of the main structure */
  size: [number, number, number];
  /** Wall colour RGB 0-1 */
  wallColor: [number, number, number];
  /** Roof colour RGB 0-1 */
  roofColor: [number, number, number];
  /** Extra decoration builder (forge, garden, stall, etc.) */
  extras?: (root: TransformNode, scene: Scene, sg?: ShadowGenerator) => void;
}

export interface NPCPlacement {
  npcTemplate: string;
  /** Suggested position for the NPC (just outside the front door) */
  position: [number, number, number];
  /** Building label for reference */
  buildingLabel: string;
}

// ── Town Layout ──────────────────────────────────────────────────────────────

const TOWN_CENTER: [number, number, number] = [0, 0, 0];

const BUILDINGS: BuildingDef[] = [
  // ─── NPC buildings (spread out wider) ──────────────────────────────────────
  {
    id: "farm_house",
    label: "Farm House",
    npcTemplate: "villager",
    position: [32, 0, -14],
    size: [8, 4, 7],
    wallColor: [0.78, 0.68, 0.52],
    roofColor: [0.55, 0.35, 0.18],
    extras: buildFarmExtras,
  },
  {
    id: "guard_tower",
    label: "Guard Tower",
    npcTemplate: "guard",
    position: [-28, 0, 24],
    size: [6, 7, 6],
    wallColor: [0.55, 0.55, 0.60],
    roofColor: [0.35, 0.30, 0.28],
    extras: buildGuardTowerExtras,
  },
  {
    id: "merchant_shop",
    label: "Merchant's Shop",
    npcTemplate: "merchant",
    position: [14, 0, 26],
    size: [8, 4, 7],
    wallColor: [0.72, 0.58, 0.70],
    roofColor: [0.50, 0.28, 0.45],
    extras: buildMerchantExtras,
  },
  {
    id: "wanderer_inn",
    label: "The Wanderer's Inn",
    npcTemplate: "wanderer",
    position: [-18, 0, -26],
    size: [10, 4.5, 8],
    wallColor: [0.65, 0.55, 0.42],
    roofColor: [0.42, 0.22, 0.15],
    extras: buildInnExtras,
  },
  {
    id: "healer_hut",
    label: "Healer's Hut",
    npcTemplate: "healer",
    position: [30, 0, 16],
    size: [6, 3.5, 6],
    wallColor: [0.62, 0.75, 0.65],
    roofColor: [0.30, 0.50, 0.35],
    extras: buildHealerExtras,
  },
  {
    id: "blacksmith_forge",
    label: "Blacksmith's Forge",
    npcTemplate: "blacksmith",
    position: [-32, 0, -10],
    size: [8, 4, 7],
    wallColor: [0.48, 0.38, 0.32],
    roofColor: [0.30, 0.20, 0.15],
    extras: buildForgeExtras,
  },
];

/**
 * Non-NPC ambient buildings that fill out the town.
 * Same shape as NPC buildings but no NPC placement.
 */
interface AmbientBuildingDef {
  id: string;
  label: string;
  position: [number, number, number];
  size: [number, number, number];
  wallColor: [number, number, number];
  roofColor: [number, number, number];
  extras?: (root: TransformNode, scene: Scene, sg?: ShadowGenerator) => void;
}

const AMBIENT_BUILDINGS: AmbientBuildingDef[] = [
  {
    id: "church",
    label: "Chapel of Light",
    position: [0, 0, 30],
    size: [8, 6, 12],
    wallColor: [0.82, 0.80, 0.75],
    roofColor: [0.40, 0.35, 0.30],
    extras: buildChurchExtras,
  },
  {
    id: "library",
    label: "Town Library",
    position: [-14, 0, 14],
    size: [7, 4, 6],
    wallColor: [0.65, 0.58, 0.52],
    roofColor: [0.35, 0.28, 0.22],
    extras: buildLibraryExtras,
  },
  {
    id: "storehouse",
    label: "Storehouse",
    position: [22, 0, -30],
    size: [9, 3.5, 7],
    wallColor: [0.58, 0.52, 0.42],
    roofColor: [0.38, 0.28, 0.18],
  },
  {
    id: "stables",
    label: "Stables",
    position: [36, 0, 0],
    size: [10, 3, 7],
    wallColor: [0.62, 0.50, 0.38],
    roofColor: [0.42, 0.30, 0.20],
    extras: buildStablesExtras,
  },
  {
    id: "watchtower_east",
    label: "East Watchtower",
    position: [42, 0, 22],
    size: [4, 8, 4],
    wallColor: [0.52, 0.52, 0.56],
    roofColor: [0.32, 0.28, 0.26],
  },
  {
    id: "watchtower_west",
    label: "West Watchtower",
    position: [-42, 0, -22],
    size: [4, 8, 4],
    wallColor: [0.52, 0.52, 0.56],
    roofColor: [0.32, 0.28, 0.26],
  },
  {
    id: "bathhouse",
    label: "Bathhouse",
    position: [-30, 0, 8],
    size: [7, 3, 6],
    wallColor: [0.70, 0.72, 0.78],
    roofColor: [0.25, 0.30, 0.40],
  },
  {
    id: "bakery",
    label: "Bakery",
    position: [6, 0, -24],
    size: [6, 3.5, 6],
    wallColor: [0.80, 0.70, 0.55],
    roofColor: [0.50, 0.32, 0.18],
    extras: buildBakeryExtras,
  },
  {
    id: "town_hall",
    label: "Town Hall",
    position: [-8, 0, 18],
    size: [10, 5, 8],
    wallColor: [0.70, 0.65, 0.58],
    roofColor: [0.45, 0.30, 0.22],
  },
  {
    id: "windmill",
    label: "Windmill",
    position: [42, 0, -20],
    size: [5, 5, 5],
    wallColor: [0.82, 0.78, 0.72],
    roofColor: [0.55, 0.40, 0.28],
    extras: buildWindmillExtras,
  },
];

// ── Main TownBuilder class ───────────────────────────────────────────────────

export class TownBuilder {
  private scene: Scene;
  private sg?: ShadowGenerator;
  private roots: TransformNode[] = [];

  constructor(scene: Scene, shadowGenerator?: ShadowGenerator) {
    this.scene = scene;
    this.sg = shadowGenerator;
  }

  /**
   * Build the entire town. Returns NPC placement suggestions so the caller
   * can reposition NPC instances to stand at their buildings.
   */
  public build(): NPCPlacement[] {
    const placements: NPCPlacement[] = [];

    // 1. Town square (cobblestone disc + central well + fountain)
    this.buildTownSquare();

    // 2. Dirt paths connecting buildings to center
    this.buildPaths();

    // 3. Each NPC building
    for (const def of BUILDINGS) {
      const root = this.buildBuilding(def);
      this.roots.push(root);

      // NPC stands in front of building (toward town center), far enough
      // to clear the walls + foundation + NPC collision sphere.
      const dx = TOWN_CENTER[0] - def.position[0];
      const dz = TOWN_CENTER[2] - def.position[2];
      const dist = Math.sqrt(dx * dx + dz * dz) || 1;
      const ndx = dx / dist;                       // normalized dir
      const ndz = dz / dist;
      // Ray–AABB exit distance from building center along the placement direction
      const halfW = (def.size[0] + 0.6) / 2;       // foundation half-width
      const halfD = (def.size[2] + 0.6) / 2;       // foundation half-depth
      const tX = Math.abs(ndx) > 0.001 ? halfW / Math.abs(ndx) : Infinity;
      const tZ = Math.abs(ndz) > 0.001 ? halfD / Math.abs(ndz) : Infinity;
      const exitDist = Math.min(tX, tZ);
      const frontOffset = exitDist + 1.2;           // +1.2 for NPC radius + margin
      placements.push({
        npcTemplate: def.npcTemplate,
        position: [
          def.position[0] + ndx * frontOffset,
          0,
          def.position[2] + ndz * frontOffset,
        ],
        buildingLabel: def.label,
      });
    }

    // 3.5. Ambient (non-NPC) buildings
    for (const amb of AMBIENT_BUILDINGS) {
      const root = this.buildAmbientBuilding(amb);
      this.roots.push(root);
    }

    // 4. Market plaza between merchant shop and town hall
    this.buildMarketPlaza();

    // 5. Ambient decorations (benches, barrels, lamp posts, fences around town)
    this.buildDecorations();

    console.log(`[TownBuilder] Town built — ${BUILDINGS.length} NPC buildings, ${AMBIENT_BUILDINGS.length} ambient buildings, ${placements.length} NPC placements.`);
    return placements;
  }

  /** Returns suggested NPC positions keyed by template name. */
  public static getNPCPositions(): Record<string, [number, number, number]> {
    const positions: Record<string, [number, number, number]> = {};
    for (const def of BUILDINGS) {
      const dx = TOWN_CENTER[0] - def.position[0];
      const dz = TOWN_CENTER[2] - def.position[2];
      const dist = Math.sqrt(dx * dx + dz * dz) || 1;
      const ndx = dx / dist;
      const ndz = dz / dist;
      const halfW = (def.size[0] + 0.6) / 2;
      const halfD = (def.size[2] + 0.6) / 2;
      const tX = Math.abs(ndx) > 0.001 ? halfW / Math.abs(ndx) : Infinity;
      const tZ = Math.abs(ndz) > 0.001 ? halfD / Math.abs(ndz) : Infinity;
      const exitDist = Math.min(tX, tZ);
      const off = exitDist + 1.2;
      positions[def.npcTemplate] = [
        def.position[0] + ndx * off,
        0,
        def.position[2] + ndz * off,
      ];
    }
    return positions;
  }

  // ────────────────────────── Town Square ─────────────────────────────────────

  private buildTownSquare(): void {
    const root = new TransformNode("town_square", this.scene);

    // Large cobblestone disc
    const disc = MeshBuilder.CreateDisc("square_ground", { radius: 12, tessellation: 64 }, this.scene);
    disc.rotation.x = Math.PI / 2;
    disc.position.y = 0.02;
    disc.parent = root;
    const discMat = new StandardMaterial("square_mat", this.scene);
    discMat.diffuseColor = new Color3(0.62, 0.58, 0.52);
    discMat.specularColor = new Color3(0.08, 0.08, 0.08);
    disc.material = discMat;
    disc.receiveShadows = true;

    // Inner decorative ring
    const innerRing = MeshBuilder.CreateTorus("sq_inner_ring", { diameter: 16, thickness: 0.25, tessellation: 48 }, this.scene);
    innerRing.rotation.x = Math.PI / 2;
    innerRing.position.y = 0.05;
    innerRing.parent = root;
    const ringMat = new StandardMaterial("sq_ring_mat", this.scene);
    ringMat.diffuseColor = new Color3(0.50, 0.46, 0.40);
    ringMat.specularColor = new Color3(0.06, 0.06, 0.06);
    innerRing.material = ringMat;

    // Central well
    this.buildWell(root);

    // Decorative ring of small stones around the square
    for (let i = 0; i < 36; i++) {
      const angle = (i / 36) * Math.PI * 2;
      const stone = MeshBuilder.CreateSphere(`sq_stone_${i}`, { diameter: 0.35, segments: 6 }, this.scene);
      stone.position.set(Math.cos(angle) * 11.8, 0.12, Math.sin(angle) * 11.8);
      stone.scaling.y = 0.5;
      stone.parent = root;
      stone.material = discMat;
      stone.receiveShadows = true;
    }

    // Flower beds around the square
    const flowerColors = [
      new Color3(0.85, 0.25, 0.30), // red
      new Color3(0.90, 0.80, 0.25), // yellow
      new Color3(0.60, 0.25, 0.75), // purple
      new Color3(0.90, 0.50, 0.65), // pink
    ];
    for (let i = 0; i < 8; i++) {
      const angle = (i / 8) * Math.PI * 2 + Math.PI / 8;
      const r = 10;
      const groupRoot = new TransformNode(`flower_group_${i}`, this.scene);
      groupRoot.position.set(Math.cos(angle) * r, 0, Math.sin(angle) * r);
      groupRoot.parent = root;

      // Dirt mound
      const mound = MeshBuilder.CreateSphere(`flowerbed_${i}`, { diameter: 1.8, segments: 8 }, this.scene);
      mound.scaling.y = 0.2;
      mound.position.y = 0.08;
      mound.parent = groupRoot;
      const dirtM = new StandardMaterial(`flowerbed_mat_${i}`, this.scene);
      dirtM.diffuseColor = new Color3(0.40, 0.30, 0.18);
      mound.material = dirtM;

      // Small flowers
      for (let f = 0; f < 5; f++) {
        const fx = (Math.random() - 0.5) * 1.2;
        const fz = (Math.random() - 0.5) * 1.2;
        const flower = MeshBuilder.CreateSphere(`flower_${i}_${f}`, { diameter: 0.18, segments: 6 }, this.scene);
        flower.position.set(fx, 0.22, fz);
        flower.parent = groupRoot;
        const fm = new StandardMaterial(`flower_mat_${i}_${f}`, this.scene);
        fm.diffuseColor = flowerColors[f % flowerColors.length];
        fm.emissiveColor = fm.diffuseColor.scale(0.05);
        flower.material = fm;
      }
    }

    this.roots.push(root);
  }

  private buildWell(parent: TransformNode): void {
    const wellRoot = new TransformNode("well", this.scene);
    wellRoot.parent = parent;

    const stoneMat = new StandardMaterial("well_stone", this.scene);
    stoneMat.diffuseColor = new Color3(0.55, 0.52, 0.48);
    stoneMat.specularColor = new Color3(0.1, 0.1, 0.1);

    // Cylindrical base wall
    const base = MeshBuilder.CreateCylinder("well_base", {
      height: 1.0, diameterTop: 1.6, diameterBottom: 1.8, tessellation: 16,
    }, this.scene);
    base.position.y = 0.5;
    base.parent = wellRoot;
    base.material = stoneMat;
    base.checkCollisions = true;
    base.receiveShadows = true;
    if (this.sg) this.sg.addShadowCaster(base);

    // Water inside
    const water = MeshBuilder.CreateDisc("well_water", { radius: 0.65, tessellation: 16 }, this.scene);
    water.rotation.x = Math.PI / 2;
    water.position.y = 0.75;
    water.parent = wellRoot;
    const waterMat = new StandardMaterial("well_water_mat", this.scene);
    waterMat.diffuseColor = new Color3(0.2, 0.4, 0.65);
    waterMat.alpha = 0.7;
    waterMat.specularPower = 128;
    water.material = waterMat;

    // Roof frame (two posts + crossbar + tiny roof)
    const woodMat = new StandardMaterial("well_wood", this.scene);
    woodMat.diffuseColor = new Color3(0.42, 0.30, 0.18);

    for (const xOff of [-0.6, 0.6]) {
      const post = MeshBuilder.CreateCylinder(`well_post_${xOff}`, {
        height: 2.2, diameter: 0.12, tessellation: 8,
      }, this.scene);
      post.position.set(xOff, 1.6, 0);
      post.parent = wellRoot;
      post.material = woodMat;
      if (this.sg) this.sg.addShadowCaster(post);
    }

    const crossbar = MeshBuilder.CreateCylinder("well_crossbar", {
      height: 1.4, diameter: 0.08, tessellation: 8,
    }, this.scene);
    crossbar.rotation.z = Math.PI / 2;
    crossbar.position.y = 2.7;
    crossbar.parent = wellRoot;
    crossbar.material = woodMat;
    if (this.sg) this.sg.addShadowCaster(crossbar);

    // Tiny roof over well
    const roofMat = new StandardMaterial("well_roof", this.scene);
    roofMat.diffuseColor = new Color3(0.45, 0.28, 0.15);
    const roof = MeshBuilder.CreateCylinder("well_roof", {
      height: 0.6, diameterBottom: 2.0, diameterTop: 0, tessellation: 4,
    }, this.scene);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 3.0;
    roof.parent = wellRoot;
    roof.material = roofMat;
    if (this.sg) this.sg.addShadowCaster(roof);
  }

  // ────────────────────────── Paths ───────────────────────────────────────────

  private buildPaths(): void {
    const pathRoot = new TransformNode("town_paths", this.scene);
    const pathMat = new StandardMaterial("path_mat", this.scene);
    pathMat.diffuseColor = new Color3(0.58, 0.52, 0.42);
    pathMat.specularColor = new Color3(0.05, 0.05, 0.04);

    // Paths from NPC buildings to center
    for (const def of BUILDINGS) {
      this._buildPathSegment(pathRoot, pathMat, def.id, def.position);
    }
    // Paths from ambient buildings to center
    for (const amb of AMBIENT_BUILDINGS) {
      this._buildPathSegment(pathRoot, pathMat, amb.id, amb.position);
    }

    // Cross-roads: horizontal and vertical through-streets
    const mainRoad = MeshBuilder.CreateGround("main_road_ew", { width: 50, height: 2.5 }, this.scene);
    mainRoad.position.set(0, 0.016, 0);
    mainRoad.material = pathMat;
    mainRoad.parent = pathRoot;
    mainRoad.receiveShadows = true;

    const mainRoadNS = MeshBuilder.CreateGround("main_road_ns", { width: 2.5, height: 50 }, this.scene);
    mainRoadNS.position.set(0, 0.016, 0);
    mainRoadNS.material = pathMat;
    mainRoadNS.parent = pathRoot;
    mainRoadNS.receiveShadows = true;

    this.roots.push(pathRoot);
  }

  private _buildPathSegment(parent: TransformNode, mat: StandardMaterial, id: string, pos: [number, number, number]): void {
    const dx = pos[0] - TOWN_CENTER[0];
    const dz = pos[2] - TOWN_CENTER[2];
    const length = Math.sqrt(dx * dx + dz * dz);
    const angle = Math.atan2(dx, dz);

    const path = MeshBuilder.CreateGround(`path_${id}`, {
      width: 2.0,
      height: length,
    }, this.scene);
    path.position.set(TOWN_CENTER[0] + dx / 2, 0.015, TOWN_CENTER[2] + dz / 2);
    path.rotation.y = angle;
    path.material = mat;
    path.parent = parent;
    path.receiveShadows = true;
  }

  // ────────────────────────── Building Factory ────────────────────────────────

  /** Build an ambient (non-NPC) building using the same factory as NPC buildings. */
  private buildAmbientBuilding(def: AmbientBuildingDef): TransformNode {
    // Re-use the same buildBuilding() by wrapping the ambient def
    const fake: BuildingDef = {
      ...def,
      npcTemplate: "",
    };
    return this.buildBuilding(fake);
  }

  // ────────────────────────── Market Plaza ────────────────────────────────────

  private buildMarketPlaza(): void {
    const root = new TransformNode("market_plaza", this.scene);
    root.position.set(8, 0, 15);

    // Cobblestone ground
    const ground = MeshBuilder.CreateGround("market_ground", { width: 14, height: 10 }, this.scene);
    ground.position.y = 0.018;
    ground.parent = root;
    const gMat = new StandardMaterial("market_ground_mat", this.scene);
    gMat.diffuseColor = new Color3(0.58, 0.54, 0.48);
    gMat.specularColor = new Color3(0.06, 0.06, 0.06);
    ground.material = gMat;
    ground.receiveShadows = true;

    // Market stalls (small open-air booths)
    const stallMat = new StandardMaterial("stall_wood_mat", this.scene);
    stallMat.diffuseColor = new Color3(0.50, 0.38, 0.25);
    const canvasColors: [number, number, number][] = [
      [0.82, 0.35, 0.25], // red
      [0.25, 0.55, 0.75], // blue
      [0.65, 0.55, 0.22], // gold
    ];

    for (let i = 0; i < 3; i++) {
      const sx = -4 + i * 4;

      // Four posts
      for (const [ox, oz] of [[-0.8, -0.8], [0.8, -0.8], [-0.8, 0.8], [0.8, 0.8]]) {
        const post = MeshBuilder.CreateCylinder(`stall_post_${i}_${ox}_${oz}`, { height: 2.5, diameter: 0.08, tessellation: 6 }, this.scene);
        post.position.set(sx + ox, 1.25, oz);
        post.parent = root;
        post.material = stallMat;
        if (this.sg) this.sg.addShadowCaster(post);
      }

      // Counter
      const counter = MeshBuilder.CreateBox(`stall_counter_${i}`, { width: 2, height: 0.1, depth: 1.8 }, this.scene);
      counter.position.set(sx, 1.0, 0);
      counter.parent = root;
      counter.material = stallMat;
      counter.receiveShadows = true;

      // Fabric canopy
      const canopy = MeshBuilder.CreateBox(`stall_canopy_${i}`, { width: 2.2, height: 0.05, depth: 2.2 }, this.scene);
      canopy.position.set(sx, 2.55, 0);
      canopy.rotation.x = -0.08;
      canopy.parent = root;
      const cm = new StandardMaterial(`stall_canopy_mat_${i}`, this.scene);
      const cc = canvasColors[i];
      cm.diffuseColor = new Color3(cc[0], cc[1], cc[2]);
      cm.backFaceCulling = false;
      canopy.material = cm;
      if (this.sg) this.sg.addShadowCaster(canopy);
    }

    this.roots.push(root);
  }

  private buildBuilding(def: BuildingDef): TransformNode {
    const root = new TransformNode(`building_${def.id}`, this.scene);
    root.position = new Vector3(def.position[0], def.position[1], def.position[2]);

    const [w, h, d] = def.size;

    // ── Foundation (slightly larger stone slab) ──
    const foundation = MeshBuilder.CreateBox(`${def.id}_foundation`, {
      width: w + 0.6, height: 0.25, depth: d + 0.6,
    }, this.scene);
    foundation.position.y = 0.125;
    foundation.parent = root;
    const foundMat = new StandardMaterial(`${def.id}_found_mat`, this.scene);
    foundMat.diffuseColor = new Color3(0.50, 0.48, 0.44);
    foundMat.specularColor = new Color3(0.06, 0.06, 0.06);
    foundation.material = foundMat;
    foundation.receiveShadows = true;
    foundation.checkCollisions = true;

    // ── Walls ──
    const walls = MeshBuilder.CreateBox(`${def.id}_walls`, {
      width: w, height: h, depth: d,
    }, this.scene);
    walls.position.y = 0.25 + h / 2;
    walls.parent = root;
    const wallMat = new StandardMaterial(`${def.id}_wall_mat`, this.scene);
    wallMat.diffuseColor = new Color3(def.wallColor[0], def.wallColor[1], def.wallColor[2]);
    wallMat.specularColor = new Color3(0.08, 0.07, 0.06);
    walls.material = wallMat;
    walls.receiveShadows = true;
    walls.checkCollisions = true;
    if (this.sg) this.sg.addShadowCaster(walls);

    // ── Roof (pyramid) ──
    const roofH = h * 0.55;
    const roof = MeshBuilder.CreateCylinder(`${def.id}_roof`, {
      height: roofH,
      diameterBottom: Math.max(w, d) * 1.35,
      diameterTop: 0,
      tessellation: 4,
    }, this.scene);
    roof.rotation.y = Math.PI / 4;
    roof.position.y = 0.25 + h + roofH / 2;
    roof.parent = root;
    const roofMat = new StandardMaterial(`${def.id}_roof_mat`, this.scene);
    roofMat.diffuseColor = new Color3(def.roofColor[0], def.roofColor[1], def.roofColor[2]);
    roofMat.specularColor = new Color3(0.06, 0.05, 0.04);
    roof.material = roofMat;
    roof.receiveShadows = true;
    if (this.sg) this.sg.addShadowCaster(roof);

    // ── Door (dark rectangle on front face toward town center) ──
    const dx = TOWN_CENTER[0] - def.position[0];
    const dz = TOWN_CENTER[2] - def.position[2];
    const facingAngle = Math.atan2(dx, dz);
    const doorDist = d / 2 + 0.01;
    const door = MeshBuilder.CreatePlane(`${def.id}_door`, { width: 1.0, height: 2.0 }, this.scene);
    door.position.set(
      Math.sin(facingAngle) * doorDist,
      0.25 + 1.0,
      Math.cos(facingAngle) * doorDist,
    );
    door.rotation.y = facingAngle + Math.PI;
    door.parent = root;
    const doorMat = new StandardMaterial(`${def.id}_door_mat`, this.scene);
    doorMat.diffuseColor = new Color3(0.28, 0.18, 0.10);
    door.material = doorMat;

    // ── Windows (small bright squares on side walls) ──
    const windowMat = new StandardMaterial(`${def.id}_win_mat`, this.scene);
    windowMat.diffuseColor = new Color3(0.85, 0.80, 0.55);
    windowMat.emissiveColor = new Color3(0.15, 0.12, 0.05);
    const winPositions = [
      { x: w / 2 + 0.01, z: 0, ry: -Math.PI / 2 },
      { x: -(w / 2 + 0.01), z: 0, ry: Math.PI / 2 },
    ];
    winPositions.forEach((wp, i) => {
      const win = MeshBuilder.CreatePlane(`${def.id}_win_${i}`, { width: 0.7, height: 0.7 }, this.scene);
      win.position.set(wp.x, 0.25 + h * 0.6, wp.z);
      win.rotation.y = wp.ry;
      win.parent = root;
      win.material = windowMat;
    });

    // ── Signpost with building label ──
    this.buildSignpost(root, def.label, facingAngle, d);

    // ── Extra decorations per building type ──
    if (def.extras) {
      def.extras(root, this.scene, this.sg);
    }

    return root;
  }

  private buildSignpost(parent: TransformNode, label: string, facingAngle: number, buildingDepth: number): void {
    const signRoot = new TransformNode("signpost", this.scene);
    const signDist = buildingDepth / 2 + 2.0;
    signRoot.position.set(
      Math.sin(facingAngle) * signDist + 1.2,
      0,
      Math.cos(facingAngle) * signDist,
    );
    signRoot.parent = parent;

    const woodMat = new StandardMaterial("sign_wood", this.scene);
    woodMat.diffuseColor = new Color3(0.42, 0.30, 0.18);

    const pole = MeshBuilder.CreateCylinder("sign_pole", { height: 2.0, diameter: 0.08, tessellation: 8 }, this.scene);
    pole.position.y = 1.0;
    pole.parent = signRoot;
    pole.material = woodMat;
    if (this.sg) this.sg.addShadowCaster(pole);

    const board = MeshBuilder.CreateBox("sign_board", { width: 1.6, height: 0.45, depth: 0.06 }, this.scene);
    board.position.y = 2.1;
    board.rotation.y = facingAngle;
    board.parent = signRoot;
    const boardMat = new StandardMaterial("sign_board_mat", this.scene);
    boardMat.diffuseColor = new Color3(0.55, 0.42, 0.25);
    board.material = boardMat;
    if (this.sg) this.sg.addShadowCaster(board);

    // Create a dynamic texture with the label text
    const textCanvas = document.createElement("canvas");
    textCanvas.width = 256;
    textCanvas.height = 64;
    const ctx = textCanvas.getContext("2d")!;
    ctx.fillStyle = "#8B6B3E";
    ctx.fillRect(0, 0, 256, 64);
    ctx.fillStyle = "#1A0E04";
    ctx.font = "bold 22px serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, 128, 32);

    const signTex = new Texture(textCanvas.toDataURL(), this.scene);
    const signFaceMat = new StandardMaterial("sign_face_mat", this.scene);
    signFaceMat.diffuseTexture = signTex;
    signFaceMat.specularColor = new Color3(0.05, 0.05, 0.05);

    const signFace = MeshBuilder.CreatePlane("sign_face", { width: 1.5, height: 0.40 }, this.scene);
    signFace.position.y = 2.1;
    signFace.position.z = 0.035;
    signFace.rotation.y = facingAngle;
    signFace.parent = signRoot;
    signFace.material = signFaceMat;
  }

  // ────────────────────────── Ambient Decorations ─────────────────────────────

  private buildDecorations(): void {
    const decoRoot = new TransformNode("town_decorations", this.scene);

    // ── Lampposts around the square and along roads ──
    const lampMat = new StandardMaterial("lamp_metal", this.scene);
    lampMat.diffuseColor = new Color3(0.25, 0.25, 0.28);
    lampMat.specularColor = new Color3(0.3, 0.3, 0.35);

    const glowMat = new StandardMaterial("lamp_glow", this.scene);
    glowMat.diffuseColor = new Color3(1.0, 0.85, 0.5);
    glowMat.emissiveColor = new Color3(0.5, 0.38, 0.15);
    glowMat.alpha = 0.85;

    // Square lamps
    const lampAngles = [0, Math.PI / 3, (2 * Math.PI) / 3, Math.PI, (4 * Math.PI) / 3, (5 * Math.PI) / 3];
    lampAngles.forEach((a, i) => {
      const lx = Math.cos(a) * 13;
      const lz = Math.sin(a) * 13;
      this._buildLamppost(decoRoot, lampMat, glowMat, `lamp_sq_${i}`, lx, lz);
    });

    // Road lamps along the cross-roads
    for (let d = -22; d <= 22; d += 11) {
      if (Math.abs(d) < 5) continue; // skip center
      this._buildLamppost(decoRoot, lampMat, glowMat, `lamp_ew_${d}`, d, 3);
      this._buildLamppost(decoRoot, lampMat, glowMat, `lamp_ns_${d}`, 3, d);
    }

    // ── Benches around the square ──
    const benchMat = new StandardMaterial("bench_mat", this.scene);
    benchMat.diffuseColor = new Color3(0.45, 0.32, 0.20);

    const benchPositions = [
      { x: 7, z: 0, ry: Math.PI / 2 },
      { x: -7, z: 0, ry: -Math.PI / 2 },
      { x: 0, z: 7, ry: 0 },
      { x: 0, z: -7, ry: Math.PI },
      { x: 5, z: 5, ry: Math.PI / 4 },
      { x: -5, z: 5, ry: -Math.PI / 4 },
      { x: 5, z: -5, ry: (3 * Math.PI) / 4 },
      { x: -5, z: -5, ry: -(3 * Math.PI) / 4 },
    ];
    benchPositions.forEach((bp, i) => {
      const bench = this.buildBench(`bench_${i}`, benchMat);
      bench.position.set(bp.x, 0, bp.z);
      bench.rotation.y = bp.ry;
      bench.parent = decoRoot;
    });

    // ── Barrels near the merchant shop ──
    const barrelMat = new StandardMaterial("barrel_mat", this.scene);
    barrelMat.diffuseColor = new Color3(0.50, 0.35, 0.20);
    const barrelPositions: [number, number, number][] = [
      [16, 0, 30], [17, 0, 31], [15.2, 0, 31.5],
      // Near storehouse
      [25, 0, -34], [26.2, 0, -33.5], [24, 0, -33],
      // Near stables
      [40, 0, 5], [41, 0, 4],
    ];
    barrelPositions.forEach((bp, i) => {
      const barrel = MeshBuilder.CreateCylinder(`barrel_${i}`, {
        height: 1.2, diameterTop: 0.55, diameterBottom: 0.6, tessellation: 12,
      }, this.scene);
      barrel.position.set(bp[0], 0.6, bp[2]);
      barrel.parent = decoRoot;
      barrel.material = barrelMat;
      barrel.receiveShadows = true;
      if (this.sg) this.sg.addShadowCaster(barrel);
    });

    // ── Hay bales near the farm ──
    const hayMat = new StandardMaterial("hay_mat", this.scene);
    hayMat.diffuseColor = new Color3(0.82, 0.72, 0.38);
    const hayPositions: [number, number, number][] = [
      [36, 0, -16], [37.5, 0, -17], [35, 0, -18],
      [38, 0, -12], [37, 0, -13],
    ];
    hayPositions.forEach((hp, i) => {
      const hay = MeshBuilder.CreateCylinder(`hay_${i}`, {
        height: 0.9, diameter: 1.1, tessellation: 16,
      }, this.scene);
      hay.rotation.x = Math.PI / 2;
      hay.position.set(hp[0], 0.55, hp[2]);
      hay.parent = decoRoot;
      hay.material = hayMat;
      hay.receiveShadows = true;
      if (this.sg) this.sg.addShadowCaster(hay);
    });

    // ── Crates scattered around town ──
    const crateMat = new StandardMaterial("scatter_crate_mat", this.scene);
    crateMat.diffuseColor = new Color3(0.55, 0.42, 0.28);
    const cratePositions: [number, number, number][] = [
      [-26, 0.35, -14], [-25, 0.35, -13.5], [-35, 0.35, 4],
      [28, 0.35, 20], [10, 0.35, -28],
    ];
    cratePositions.forEach(([cx, cy, cz], i) => {
      const crate = MeshBuilder.CreateBox(`scatter_crate_${i}`, { size: 0.7 }, this.scene);
      crate.position.set(cx, cy, cz);
      crate.rotation.y = Math.random() * 1.0;
      crate.parent = decoRoot;
      crate.material = crateMat;
      crate.receiveShadows = true;
      if (this.sg) this.sg.addShadowCaster(crate);
    });

    // ── Trees scattered outside buildings ──
    this._buildScatteredTrees(decoRoot);

    // ── Stone walls / low walls for ambiance ──
    this._buildStoneWalls(decoRoot);

    // ── Wooden fence around the town perimeter ──
    this.buildTownFence(decoRoot);

    this.roots.push(decoRoot);
  }

  /** Helper to build a lamppost at (x, z) */
  private _buildLamppost(parent: TransformNode, metalMat: StandardMaterial, glowMat: StandardMaterial, name: string, x: number, z: number): void {
    const pole = MeshBuilder.CreateCylinder(`${name}_pole`, { height: 3.5, diameter: 0.12, tessellation: 8 }, this.scene);
    pole.position.set(x, 1.75, z);
    pole.parent = parent;
    pole.material = metalMat;
    pole.receiveShadows = true;
    if (this.sg) this.sg.addShadowCaster(pole);

    const lantern = MeshBuilder.CreateSphere(`${name}_globe`, { diameter: 0.45, segments: 8 }, this.scene);
    lantern.position.set(x, 3.6, z);
    lantern.parent = parent;
    lantern.material = glowMat;
  }

  /** Scatter stylized low-poly trees around the town outskirts */
  private _buildScatteredTrees(parent: TransformNode): void {
    const trunkMat = new StandardMaterial("tree_trunk_mat", this.scene);
    trunkMat.diffuseColor = new Color3(0.40, 0.28, 0.18);
    const leafMat = new StandardMaterial("tree_leaf_mat", this.scene);
    leafMat.diffuseColor = new Color3(0.22, 0.55, 0.25);
    const darkLeafMat = new StandardMaterial("tree_dleaf_mat", this.scene);
    darkLeafMat.diffuseColor = new Color3(0.18, 0.42, 0.20);

    // Positions around the edges (avoiding building footprints)
    const treePositions: [number, number][] = [
      [18, -35], [-25, -35], [40, 12], [-40, 15],
      [25, 35], [-15, 35], [45, -10], [-45, -5],
      [10, 40], [-35, -20], [30, -25], [-38, 28],
      [48, 28], [-48, 12], [0, -38], [0, 42],
      [-10, 40], [35, 32], [-44, -28], [48, -28],
    ];

    treePositions.forEach(([tx, tz], i) => {
      const treeRoot = new TransformNode(`tree_${i}`, this.scene);
      treeRoot.position.set(tx, 0, tz);
      treeRoot.parent = parent;

      const h = 2.5 + Math.random() * 2;
      const trunk = MeshBuilder.CreateCylinder(`tree_trunk_${i}`, {
        height: h, diameterTop: 0.12, diameterBottom: 0.22, tessellation: 8,
      }, this.scene);
      trunk.position.y = h / 2;
      trunk.parent = treeRoot;
      trunk.material = trunkMat;
      trunk.receiveShadows = true;
      if (this.sg) this.sg.addShadowCaster(trunk);

      // Canopy — stacked spheres
      const canopyR = 1.2 + Math.random() * 0.8;
      const mat = i % 2 === 0 ? leafMat : darkLeafMat;
      const c1 = MeshBuilder.CreateSphere(`tree_canopy_${i}`, { diameter: canopyR * 2, segments: 8 }, this.scene);
      c1.position.y = h + canopyR * 0.4;
      c1.scaling.y = 0.7;
      c1.parent = treeRoot;
      c1.material = mat;
      c1.receiveShadows = true;
      if (this.sg) this.sg.addShadowCaster(c1);

      const c2 = MeshBuilder.CreateSphere(`tree_canopy2_${i}`, { diameter: canopyR * 1.4, segments: 6 }, this.scene);
      c2.position.set(canopyR * 0.3, h + canopyR * 0.9, canopyR * 0.2);
      c2.scaling.y = 0.6;
      c2.parent = treeRoot;
      c2.material = mat;
      if (this.sg) this.sg.addShadowCaster(c2);
    });
  }

  /** Low stone walls for town character */
  private _buildStoneWalls(parent: TransformNode): void {
    const wallMat = new StandardMaterial("stone_low_wall_mat", this.scene);
    wallMat.diffuseColor = new Color3(0.52, 0.50, 0.46);
    wallMat.specularColor = new Color3(0.08, 0.08, 0.08);

    // Short stone walls segments near the farm and forge areas
    const segments: { x: number; z: number; w: number; d: number; ry: number }[] = [
      { x: 28, z: -6, w: 6, d: 0.5, ry: 0 },
      { x: 28, z: -10, w: 0.5, d: 4, ry: 0 },
      { x: -28, z: -2, w: 6, d: 0.5, ry: 0 },
      { x: -12, z: -20, w: 0.5, d: 4, ry: 0 },
    ];

    segments.forEach((s, i) => {
      const wall = MeshBuilder.CreateBox(`stone_wall_${i}`, { width: s.w, height: 0.8, depth: s.d }, this.scene);
      wall.position.set(s.x, 0.4, s.z);
      wall.rotation.y = s.ry;
      wall.parent = parent;
      wall.material = wallMat;
      wall.receiveShadows = true;
      wall.checkCollisions = true;
      if (this.sg) this.sg.addShadowCaster(wall);
    });
  }

  private buildBench(name: string, mat: StandardMaterial): TransformNode {
    const root = new TransformNode(name, this.scene);

    // Seat
    const seat = MeshBuilder.CreateBox(`${name}_seat`, { width: 1.6, height: 0.08, depth: 0.5 }, this.scene);
    seat.position.y = 0.5;
    seat.parent = root;
    seat.material = mat;
    seat.receiveShadows = true;
    if (this.sg) this.sg.addShadowCaster(seat);

    // Legs
    const legPositions = [
      [-0.65, 0],
      [0.65, 0],
    ];
    legPositions.forEach(([lx, lz], i) => {
      const leg = MeshBuilder.CreateBox(`${name}_leg_${i}`, { width: 0.08, height: 0.5, depth: 0.45 }, this.scene);
      leg.position.set(lx, 0.25, lz);
      leg.parent = root;
      leg.material = mat;
      if (this.sg) this.sg.addShadowCaster(leg);
    });

    // Backrest
    const back = MeshBuilder.CreateBox(`${name}_back`, { width: 1.6, height: 0.6, depth: 0.06 }, this.scene);
    back.position.set(0, 0.82, -0.22);
    back.parent = root;
    back.material = mat;
    if (this.sg) this.sg.addShadowCaster(back);

    return root;
  }

  private buildTownFence(parent: TransformNode): void {
    const fenceMat = new StandardMaterial("fence_mat", this.scene);
    fenceMat.diffuseColor = new Color3(0.48, 0.35, 0.22);
    fenceMat.specularColor = new Color3(0.06, 0.05, 0.04);

    const radius = 55;
    const segments = 64;
    const gateAngle = Math.PI / 2; // Opening on the east side
    const gateAngle2 = -Math.PI / 2; // Second gate on the west side

    for (let i = 0; i < segments; i++) {
      const angle = (i / segments) * Math.PI * 2;

      // Skip segment for gate openings (east and west)
      const angleDiff = Math.abs(angle - gateAngle);
      const angleDiff2 = Math.abs(angle - (gateAngle2 + Math.PI * 2));
      const angleDiff2b = Math.abs(angle - gateAngle2);
      if (angleDiff < 0.12 || angleDiff > Math.PI * 2 - 0.12) continue;
      if (angleDiff2 < 0.12 || angleDiff2b < 0.12) continue;

      const x = Math.cos(angle) * radius;
      const z = Math.sin(angle) * radius;

      // Fence post
      const post = MeshBuilder.CreateCylinder(`fence_post_${i}`, {
        height: 1.5, diameter: 0.10, tessellation: 6,
      }, this.scene);
      post.position.set(x, 0.75, z);
      post.parent = parent;
      post.material = fenceMat;
      post.receiveShadows = true;

      // Horizontal rail
      const nextAngle = ((i + 1) / segments) * Math.PI * 2;
      const nx = Math.cos(nextAngle) * radius;
      const nz = Math.sin(nextAngle) * radius;
      const midX = (x + nx) / 2;
      const midZ = (z + nz) / 2;
      const railLen = Math.sqrt((nx - x) ** 2 + (nz - z) ** 2);
      const railAngle = Math.atan2(nx - x, nz - z);

      const rail = MeshBuilder.CreateBox(`fence_rail_${i}`, {
        width: 0.06, height: 0.06, depth: railLen,
      }, this.scene);
      rail.position.set(midX, 1.0, midZ);
      rail.rotation.y = railAngle;
      rail.parent = parent;
      rail.material = fenceMat;

      // Lower rail
      const lowerRail = MeshBuilder.CreateBox(`fence_lrail_${i}`, {
        width: 0.06, height: 0.06, depth: railLen,
      }, this.scene);
      lowerRail.position.set(midX, 0.5, midZ);
      lowerRail.rotation.y = railAngle;
      lowerRail.parent = parent;
      lowerRail.material = fenceMat;
    }
  }

  // ────────────────────────── Cleanup ─────────────────────────────────────────

  public dispose(): void {
    for (const root of this.roots) {
      root.getChildMeshes().forEach((m) => m.dispose());
      root.dispose();
    }
    this.roots = [];
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// Per-building extra decorations
// ═════════════════════════════════════════════════════════════════════════════

/** Farm: scarecrow, plowed field strips, water trough */
function buildFarmExtras(root: TransformNode, scene: Scene, sg?: ShadowGenerator): void {
  // Small plowed field patches
  const dirtMat = new StandardMaterial("farm_dirt", scene);
  dirtMat.diffuseColor = new Color3(0.45, 0.35, 0.22);

  for (let row = 0; row < 3; row++) {
    const strip = MeshBuilder.CreateBox(`farm_row_${row}`, { width: 4, height: 0.08, depth: 0.5 }, scene);
    strip.position.set(4, 0.04, -2.5 + row * 1.2);
    strip.parent = root;
    strip.material = dirtMat;
    strip.receiveShadows = true;
  }

  // Scarecrow
  const woodMat = new StandardMaterial("scarecrow_wood", scene);
  woodMat.diffuseColor = new Color3(0.45, 0.32, 0.18);

  const pole = MeshBuilder.CreateCylinder("scarecrow_pole", { height: 2.5, diameter: 0.1, tessellation: 6 }, scene);
  pole.position.set(5, 1.25, -1.5);
  pole.parent = root;
  pole.material = woodMat;
  if (sg) sg.addShadowCaster(pole);

  const arms = MeshBuilder.CreateCylinder("scarecrow_arms", { height: 1.5, diameter: 0.08, tessellation: 6 }, scene);
  arms.rotation.z = Math.PI / 2;
  arms.position.set(5, 2.2, -1.5);
  arms.parent = root;
  arms.material = woodMat;
  if (sg) sg.addShadowCaster(arms);

  const head = MeshBuilder.CreateSphere("scarecrow_head", { diameter: 0.4, segments: 8 }, scene);
  head.position.set(5, 2.7, -1.5);
  head.parent = root;
  const headMat = new StandardMaterial("scarecrow_head_mat", scene);
  headMat.diffuseColor = new Color3(0.82, 0.72, 0.38);
  head.material = headMat;
  if (sg) sg.addShadowCaster(head);
}

/** Guard Tower: flag pole with banner, weapon rack */
function buildGuardTowerExtras(root: TransformNode, scene: Scene, sg?: ShadowGenerator): void {
  // Flag pole on top of the tower
  const poleMat = new StandardMaterial("flag_pole_mat", scene);
  poleMat.diffuseColor = new Color3(0.30, 0.30, 0.32);

  const flagPole = MeshBuilder.CreateCylinder("flag_pole", { height: 3, diameter: 0.08, tessellation: 8 }, scene);
  flagPole.position.set(0, 9, 0);
  flagPole.parent = root;
  flagPole.material = poleMat;
  if (sg) sg.addShadowCaster(flagPole);

  // Banner
  const bannerMat = new StandardMaterial("banner_mat", scene);
  bannerMat.diffuseColor = new Color3(0.75, 0.15, 0.15);
  bannerMat.backFaceCulling = false;

  const banner = MeshBuilder.CreatePlane("banner", { width: 0.8, height: 1.2 }, scene);
  banner.position.set(0.5, 9.8, 0);
  banner.parent = root;
  banner.material = bannerMat;

  // Weapon rack (two crossed spears)
  const spearMat = new StandardMaterial("spear_mat", scene);
  spearMat.diffuseColor = new Color3(0.35, 0.28, 0.18);

  for (const rz of [0.3, -0.3]) {
    const spear = MeshBuilder.CreateCylinder(`spear_${rz}`, { height: 2.8, diameter: 0.06, tessellation: 6 }, scene);
    spear.position.set(3.2, 1.4, 0);
    spear.rotation.z = rz;
    spear.parent = root;
    spear.material = spearMat;
    if (sg) sg.addShadowCaster(spear);
  }
}

/** Merchant Shop: market stall awning, crate stacks */
function buildMerchantExtras(root: TransformNode, scene: Scene, sg?: ShadowGenerator): void {
  // Awning over front
  const awningMat = new StandardMaterial("awning_mat", scene);
  awningMat.diffuseColor = new Color3(0.82, 0.55, 0.25);
  awningMat.backFaceCulling = false;

  const awning = MeshBuilder.CreateBox("awning", { width: 5, height: 0.08, depth: 2.5 }, scene);
  awning.position.set(0, 3.2, -4.5);
  awning.rotation.x = -0.15;
  awning.parent = root;
  awning.material = awningMat;
  if (sg) sg.addShadowCaster(awning);

  // Awning support poles
  const poleMat = new StandardMaterial("awning_pole_mat", scene);
  poleMat.diffuseColor = new Color3(0.42, 0.30, 0.18);

  for (const px of [-2.2, 2.2]) {
    const pole = MeshBuilder.CreateCylinder(`awning_pole_${px}`, { height: 2.8, diameter: 0.08, tessellation: 6 }, scene);
    pole.position.set(px, 1.8, -5.5);
    pole.parent = root;
    pole.material = poleMat;
    if (sg) sg.addShadowCaster(pole);
  }

  // Crate stacks
  const crateMat = new StandardMaterial("crate_mat", scene);
  crateMat.diffuseColor = new Color3(0.58, 0.45, 0.28);

  const cratePositions = [
    [2.5, 0.35, -5.0],
    [2.8, 0.35, -5.8],
    [2.6, 1.05, -5.3],
  ];
  cratePositions.forEach(([cx, cy, cz], i) => {
    const crate = MeshBuilder.CreateBox(`crate_${i}`, { size: 0.7 }, scene);
    crate.position.set(cx, cy, cz);
    crate.rotation.y = Math.random() * 0.4;
    crate.parent = root;
    crate.material = crateMat;
    crate.receiveShadows = true;
    if (sg) sg.addShadowCaster(crate);
  });
}

/** Wanderer's Inn: chimney with smoke effect, outdoor table */
function buildInnExtras(root: TransformNode, scene: Scene, sg?: ShadowGenerator): void {
  // Chimney
  const brickMat = new StandardMaterial("chimney_mat", scene);
  brickMat.diffuseColor = new Color3(0.55, 0.35, 0.28);

  const chimney = MeshBuilder.CreateBox("chimney", { width: 0.8, height: 2.5, depth: 0.8 }, scene);
  chimney.position.set(2.5, 5.5, -1.5);
  chimney.parent = root;
  chimney.material = brickMat;
  if (sg) sg.addShadowCaster(chimney);

  // Outdoor table with seats
  const woodMat = new StandardMaterial("inn_wood", scene);
  woodMat.diffuseColor = new Color3(0.48, 0.35, 0.22);

  const table = MeshBuilder.CreateCylinder("inn_table", {
    height: 0.08, diameter: 1.4, tessellation: 16,
  }, scene);
  table.position.set(-5, 0.75, 0);
  table.parent = root;
  table.material = woodMat;
  table.receiveShadows = true;
  if (sg) sg.addShadowCaster(table);

  // Table leg
  const leg = MeshBuilder.CreateCylinder("inn_table_leg", { height: 0.75, diameter: 0.15, tessellation: 8 }, scene);
  leg.position.set(-5, 0.375, 0);
  leg.parent = root;
  leg.material = woodMat;

  // Stools around table
  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    const stool = MeshBuilder.CreateCylinder(`inn_stool_${i}`, {
      height: 0.5, diameterTop: 0.4, diameterBottom: 0.3, tessellation: 8,
    }, scene);
    stool.position.set(-5 + Math.cos(angle) * 1.0, 0.25, Math.sin(angle) * 1.0);
    stool.parent = root;
    stool.material = woodMat;
    stool.receiveShadows = true;
  }

  // Hanging sign
  const signMat = new StandardMaterial("inn_sign_mat", scene);
  signMat.diffuseColor = new Color3(0.60, 0.42, 0.22);
  const sign = MeshBuilder.CreateBox("inn_sign", { width: 1.2, height: 0.6, depth: 0.05 }, scene);
  sign.position.set(0, 3.8, -4.0);
  sign.parent = root;
  sign.material = signMat;
  if (sg) sg.addShadowCaster(sign);
}

/** Healer's Hut: herb garden, glowing crystal, mortar & pestle stand */
function buildHealerExtras(root: TransformNode, scene: Scene, sg?: ShadowGenerator): void {
  // Herb garden (small green mounds)
  const herbMat = new StandardMaterial("herb_mat", scene);
  herbMat.diffuseColor = new Color3(0.30, 0.65, 0.30);

  for (let i = 0; i < 5; i++) {
    const herb = MeshBuilder.CreateSphere(`herb_${i}`, { diameter: 0.5 + Math.random() * 0.3, segments: 6 }, scene);
    herb.scaling.y = 0.4;
    herb.position.set(-3.0 + i * 0.9, 0.12, 3.5);
    herb.parent = root;
    herb.material = herbMat;
    herb.receiveShadows = true;
  }

  // Glowing healing crystal
  const crystalMat = new StandardMaterial("heal_crystal_mat", scene);
  crystalMat.diffuseColor = new Color3(0.35, 0.85, 0.65);
  crystalMat.emissiveColor = new Color3(0.12, 0.35, 0.22);
  crystalMat.specularColor = new Color3(0.8, 0.9, 0.85);
  crystalMat.alpha = 0.85;

  const crystal = MeshBuilder.CreatePolyhedron("heal_crystal", { type: 1, size: 0.3 }, scene);
  crystal.position.set(0, 1.5, -3.8);
  crystal.rotation.y = Math.PI / 6;
  crystal.parent = root;
  crystal.material = crystalMat;
  if (sg) sg.addShadowCaster(crystal);

  // Mortar on a small table
  const tableMat = new StandardMaterial("healer_table_mat", scene);
  tableMat.diffuseColor = new Color3(0.55, 0.42, 0.30);
  const table = MeshBuilder.CreateBox("healer_table", { width: 0.8, height: 0.8, depth: 0.8 }, scene);
  table.position.set(3.2, 0.4, 0);
  table.parent = root;
  table.material = tableMat;
  table.receiveShadows = true;

  const mortar = MeshBuilder.CreateCylinder("mortar", {
    height: 0.25, diameterTop: 0.35, diameterBottom: 0.25, tessellation: 12,
  }, scene);
  mortar.position.set(3.2, 0.93, 0);
  mortar.parent = root;
  const mortarMat = new StandardMaterial("mortar_mat", scene);
  mortarMat.diffuseColor = new Color3(0.50, 0.48, 0.45);
  mortar.material = mortarMat;
}

/** Blacksmith's Forge: anvil, furnace glow, weapon display, coal pile */
function buildForgeExtras(root: TransformNode, scene: Scene, sg?: ShadowGenerator): void {
  // Anvil (dark metallic block)
  const anvilMat = new StandardMaterial("anvil_mat", scene);
  anvilMat.diffuseColor = new Color3(0.22, 0.22, 0.25);
  anvilMat.specularColor = new Color3(0.4, 0.4, 0.45);
  anvilMat.specularPower = 64;

  const anvilBase = MeshBuilder.CreateBox("anvil_base", { width: 0.6, height: 0.5, depth: 0.4 }, scene);
  anvilBase.position.set(4.5, 0.25, 0);
  anvilBase.parent = root;
  anvilBase.material = anvilMat;
  anvilBase.receiveShadows = true;
  if (sg) sg.addShadowCaster(anvilBase);

  const anvilTop = MeshBuilder.CreateBox("anvil_top", { width: 0.8, height: 0.15, depth: 0.5 }, scene);
  anvilTop.position.set(4.5, 0.575, 0);
  anvilTop.parent = root;
  anvilTop.material = anvilMat;
  if (sg) sg.addShadowCaster(anvilTop);

  // Furnace (glowing box)
  const furnaceMat = new StandardMaterial("furnace_mat", scene);
  furnaceMat.diffuseColor = new Color3(0.35, 0.28, 0.22);

  const furnace = MeshBuilder.CreateBox("furnace", { width: 1.2, height: 1.5, depth: 1.2 }, scene);
  furnace.position.set(-4.5, 0.75, 0);
  furnace.parent = root;
  furnace.material = furnaceMat;
  furnace.checkCollisions = true;
  if (sg) sg.addShadowCaster(furnace);

  // Furnace glow opening
  const glowMat = new StandardMaterial("furnace_glow", scene);
  glowMat.diffuseColor = new Color3(1.0, 0.45, 0.15);
  glowMat.emissiveColor = new Color3(0.65, 0.25, 0.05);

  const glowOpening = MeshBuilder.CreatePlane("furnace_opening", { width: 0.5, height: 0.5 }, scene);
  glowOpening.position.set(-3.89, 0.55, 0);
  glowOpening.rotation.y = Math.PI / 2;
  glowOpening.parent = root;
  glowOpening.material = glowMat;

  // Coal pile
  const coalMat = new StandardMaterial("coal_mat", scene);
  coalMat.diffuseColor = new Color3(0.12, 0.10, 0.10);
  const coal = MeshBuilder.CreateSphere("coal_pile", { diameter: 1.0, segments: 6 }, scene);
  coal.scaling.y = 0.35;
  coal.position.set(-4.5, 0.18, 2.0);
  coal.parent = root;
  coal.material = coalMat;
  coal.receiveShadows = true;

  // Sword display on wall (simple long thin box leaning)
  const swordMat = new StandardMaterial("sword_mat", scene);
  swordMat.diffuseColor = new Color3(0.65, 0.65, 0.70);
  swordMat.specularColor = new Color3(0.6, 0.6, 0.65);

  const sword = MeshBuilder.CreateBox("sword_display", { width: 0.06, height: 1.4, depth: 0.18 }, scene);
  sword.position.set(4.0, 1.2, -3.2);
  sword.rotation.z = 0.15;
  sword.parent = root;
  sword.material = swordMat;
  if (sg) sg.addShadowCaster(sword);
}

// ═════════════════════════════════════════════════════════════════════════════
// Ambient building extras
// ═════════════════════════════════════════════════════════════════════════════

/** Chapel of Light: bell tower spire + stained glass window */
function buildChurchExtras(root: TransformNode, scene: Scene, sg?: ShadowGenerator): void {
  // Bell tower spire
  const spireMat = new StandardMaterial("church_spire_mat", scene);
  spireMat.diffuseColor = new Color3(0.50, 0.45, 0.40);
  const spire = MeshBuilder.CreateCylinder("church_spire", {
    height: 4, diameterBottom: 1.8, diameterTop: 0, tessellation: 8,
  }, scene);
  spire.position.set(0, 10, -3);
  spire.parent = root;
  spire.material = spireMat;
  if (sg) sg.addShadowCaster(spire);

  // Cross on top
  const crossMat = new StandardMaterial("church_cross_mat", scene);
  crossMat.diffuseColor = new Color3(0.80, 0.72, 0.40);
  crossMat.emissiveColor = new Color3(0.08, 0.06, 0.03);
  const crossV = MeshBuilder.CreateBox("church_cross_v", { width: 0.1, height: 1.0, depth: 0.1 }, scene);
  crossV.position.set(0, 12.5, -3);
  crossV.parent = root;
  crossV.material = crossMat;
  const crossH = MeshBuilder.CreateBox("church_cross_h", { width: 0.6, height: 0.1, depth: 0.1 }, scene);
  crossH.position.set(0, 12.8, -3);
  crossH.parent = root;
  crossH.material = crossMat;

  // Stained glass window (colorful glowing plane)
  const glassMat = new StandardMaterial("church_glass_mat", scene);
  glassMat.diffuseColor = new Color3(0.40, 0.25, 0.70);
  glassMat.emissiveColor = new Color3(0.20, 0.12, 0.35);
  glassMat.alpha = 0.75;
  const glass = MeshBuilder.CreatePlane("church_glass", { width: 1.5, height: 2.5 }, scene);
  glass.position.set(0, 3.5, -6.02);
  glass.parent = root;
  glass.material = glassMat;

  // Steps at the entrance
  const stepMat = new StandardMaterial("church_step_mat", scene);
  stepMat.diffuseColor = new Color3(0.58, 0.55, 0.50);
  for (let s = 0; s < 3; s++) {
    const step = MeshBuilder.CreateBox(`church_step_${s}`, { width: 4, height: 0.15, depth: 0.6 }, scene);
    step.position.set(0, 0.075 + s * 0.15, -6.5 - s * 0.6);
    step.parent = root;
    step.material = stepMat;
    step.receiveShadows = true;
  }
}

/** Library: book shelves visible through windows, globe */
function buildLibraryExtras(root: TransformNode, scene: Scene, sg?: ShadowGenerator): void {
  // Globe on a pedestal outside
  const pedestalMat = new StandardMaterial("lib_pedestal_mat", scene);
  pedestalMat.diffuseColor = new Color3(0.55, 0.50, 0.45);
  const pedestal = MeshBuilder.CreateCylinder("lib_pedestal", { height: 1.0, diameter: 0.5, tessellation: 12 }, scene);
  pedestal.position.set(-4.5, 0.5, 0);
  pedestal.parent = root;
  pedestal.material = pedestalMat;
  if (sg) sg.addShadowCaster(pedestal);

  const globeMat = new StandardMaterial("lib_globe_mat", scene);
  globeMat.diffuseColor = new Color3(0.30, 0.50, 0.65);
  globeMat.specularColor = new Color3(0.4, 0.4, 0.5);
  const globe = MeshBuilder.CreateSphere("lib_globe", { diameter: 0.6, segments: 12 }, scene);
  globe.position.set(-4.5, 1.35, 0);
  globe.parent = root;
  globe.material = globeMat;
  if (sg) sg.addShadowCaster(globe);

  // Open book on a stand
  const bookMat = new StandardMaterial("lib_book_mat", scene);
  bookMat.diffuseColor = new Color3(0.60, 0.20, 0.15);
  const book = MeshBuilder.CreateBox("lib_book", { width: 0.5, height: 0.05, depth: 0.35 }, scene);
  book.position.set(-4.5, 1.08, -2.5);
  book.rotation.x = -0.3;
  book.parent = root;
  book.material = bookMat;
}

/** Stables: hay rack, horse trough, fence paddock */
function buildStablesExtras(root: TransformNode, scene: Scene, sg?: ShadowGenerator): void {
  const woodMat = new StandardMaterial("stable_wood_mat", scene);
  woodMat.diffuseColor = new Color3(0.48, 0.35, 0.22);

  // Hay rack
  const hayMat = new StandardMaterial("stable_hay_mat", scene);
  hayMat.diffuseColor = new Color3(0.80, 0.70, 0.35);
  const hayRack = MeshBuilder.CreateBox("stable_hayrack", { width: 2, height: 0.8, depth: 0.6 }, scene);
  hayRack.position.set(-6, 0.8, 0);
  hayRack.parent = root;
  hayRack.material = hayMat;
  hayRack.receiveShadows = true;
  if (sg) sg.addShadowCaster(hayRack);

  // Water trough
  const troughMat = new StandardMaterial("stable_trough_mat", scene);
  troughMat.diffuseColor = new Color3(0.42, 0.35, 0.25);
  const trough = MeshBuilder.CreateBox("stable_trough", { width: 2.5, height: 0.5, depth: 0.8 }, scene);
  trough.position.set(6, 0.25, 0);
  trough.parent = root;
  trough.material = troughMat;
  trough.receiveShadows = true;

  // Small paddock fence
  const fMat = new StandardMaterial("stable_fence_mat", scene);
  fMat.diffuseColor = new Color3(0.45, 0.32, 0.20);
  const fencePoints: [number, number, number, number][] = [  // x, z, w, d
    [0, -5, 10, 0.08],
    [0, 5, 10, 0.08],
    [-5, 0, 0.08, 10],
    [5, 0, 0.08, 10],
  ];
  fencePoints.forEach(([fx, fz, fw, fd], i) => {
    const rail = MeshBuilder.CreateBox(`stable_fence_${i}`, { width: fw, height: 0.08, depth: fd }, scene);
    rail.position.set(fx, 1.0, fz);
    rail.parent = root;
    rail.material = fMat;
  });
}

/** Bakery: oven glow, bread display, chimney */
function buildBakeryExtras(root: TransformNode, scene: Scene, sg?: ShadowGenerator): void {
  // Small chimney
  const brickMat = new StandardMaterial("bakery_chimney_mat", scene);
  brickMat.diffuseColor = new Color3(0.60, 0.42, 0.30);
  const chimney = MeshBuilder.CreateBox("bakery_chimney", { width: 0.6, height: 1.8, depth: 0.6 }, scene);
  chimney.position.set(1.5, 4.5, -1.5);
  chimney.parent = root;
  chimney.material = brickMat;
  if (sg) sg.addShadowCaster(chimney);

  // Bread display (small tray)
  const trayMat = new StandardMaterial("bakery_tray_mat", scene);
  trayMat.diffuseColor = new Color3(0.75, 0.60, 0.35);
  const tray = MeshBuilder.CreateBox("bakery_tray", { width: 1.2, height: 0.08, depth: 0.8 }, scene);
  tray.position.set(0, 1.1, -3.8);
  tray.parent = root;
  tray.material = trayMat;
  tray.receiveShadows = true;

  // Bread loaves on tray
  const breadMat = new StandardMaterial("bread_mat", scene);
  breadMat.diffuseColor = new Color3(0.78, 0.58, 0.30);
  for (let b = 0; b < 3; b++) {
    const bread = MeshBuilder.CreateSphere(`bread_${b}`, { diameter: 0.25, segments: 6 }, scene);
    bread.scaling.set(1.2, 0.6, 0.8);
    bread.position.set(-0.3 + b * 0.35, 1.22, -3.8);
    bread.parent = root;
    bread.material = breadMat;
  }
}

/** Windmill: rotating blades on the front */
function buildWindmillExtras(root: TransformNode, scene: Scene, sg?: ShadowGenerator): void {
  // Axle hub
  const hubMat = new StandardMaterial("mill_hub_mat", scene);
  hubMat.diffuseColor = new Color3(0.40, 0.32, 0.22);
  const hub = MeshBuilder.CreateCylinder("mill_hub", { height: 0.3, diameter: 0.5, tessellation: 10 }, scene);
  hub.rotation.x = Math.PI / 2;
  hub.position.set(0, 4.5, -2.8);
  hub.parent = root;
  hub.material = hubMat;
  if (sg) sg.addShadowCaster(hub);

  // Four blades
  const bladeMat = new StandardMaterial("mill_blade_mat", scene);
  bladeMat.diffuseColor = new Color3(0.70, 0.62, 0.48);
  bladeMat.backFaceCulling = false;

  const bladeRoot = new TransformNode("mill_blade_root", scene);
  bladeRoot.position.set(0, 4.5, -2.9);
  bladeRoot.parent = root;

  for (let b = 0; b < 4; b++) {
    const angle = (b / 4) * Math.PI * 2;
    const blade = MeshBuilder.CreateBox(`mill_blade_${b}`, { width: 0.4, height: 3, depth: 0.05 }, scene);
    blade.position.set(Math.sin(angle) * 1.8, Math.cos(angle) * 1.8, 0);
    blade.rotation.z = angle;
    blade.parent = bladeRoot;
    blade.material = bladeMat;
    if (sg) sg.addShadowCaster(blade);
  }

  // Slowly rotate the blades
  scene.onBeforeRenderObservable.add(() => {
    bladeRoot.rotation.z += 0.003;
  });

  // Grain sacks at the base
  const sackMat = new StandardMaterial("mill_sack_mat", scene);
  sackMat.diffuseColor = new Color3(0.68, 0.58, 0.42);
  for (let s = 0; s < 3; s++) {
    const sack = MeshBuilder.CreateCylinder(`mill_sack_${s}`, {
      height: 0.6, diameterTop: 0.3, diameterBottom: 0.45, tessellation: 8,
    }, scene);
    sack.position.set(-2.8 + s * 0.6, 0.3, 1);
    sack.parent = root;
    sack.material = sackMat;
    sack.receiveShadows = true;
  }
}
