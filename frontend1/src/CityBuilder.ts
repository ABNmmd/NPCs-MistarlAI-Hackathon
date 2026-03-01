import { Scene, SceneLoader, Vector3, ShadowGenerator } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";

/**
 * CityBuilder — surrounds the 200×200 map with buildings along all four edges.
 *
 * Perimeter: buildings placed at x = ±95 and z = ±95 every SPACING units.
 * Mix of regular buildings (scale 4) and skyscrapers (scale 7).
 */
export class CityBuilder {
  // Map half-size matches Environment ground (200/2 = 100), buildings at ±95
  private static readonly EDGE       = 90;
  private static readonly SPACING    = 12;  // gap between building centres
  private static readonly SCALE_BLDG = 8;
  private static readonly SCALE_SKY  = 14;

  private static readonly BUILDINGS_REGULAR = [
    "building-a.glb", "building-b.glb", "building-c.glb", "building-d.glb",
    "building-e.glb", "building-f.glb", "building-g.glb", "building-h.glb",
    "building-i.glb", "building-j.glb", "building-k.glb", "building-l.glb",
    "building-m.glb", "building-n.glb",
  ];
  private static readonly BUILDINGS_SKY = [
    "building-skyscraper-a.glb", "building-skyscraper-b.glb",
    "building-skyscraper-c.glb", "building-skyscraper-d.glb",
    "building-skyscraper-e.glb",
  ];

  constructor(
    private scene: Scene,
    private shadowGenerator?: ShadowGenerator
  ) {}

  public async build(): Promise<void> {
    console.log("[CityBuilder] Placing perimeter buildings…");
    await this.buildPerimeter();
    console.log("[CityBuilder] Perimeter complete.");
  }

  // ── Perimeter ─────────────────────────────────────────────────────────────

  private async buildPerimeter(): Promise<void> {
    const E   = CityBuilder.EDGE;
    const SP  = CityBuilder.SPACING;
    const tasks: Promise<void>[] = [];
    let idx = 0;

    // Helper: pick building file alternating regular / skyscraper
    const pick = (i: number): { file: string; scale: number } => {
      if (i % 5 === 0) {
        return {
          file:  CityBuilder.BUILDINGS_SKY[i % CityBuilder.BUILDINGS_SKY.length],
          scale: CityBuilder.SCALE_SKY,
        };
      }
      return {
        file:  CityBuilder.BUILDINGS_REGULAR[i % CityBuilder.BUILDINGS_REGULAR.length],
        scale: CityBuilder.SCALE_BLDG,
      };
    };

    // North edge  (z = +E)  — buildings face inward (south)
    for (let x = -E; x <= E; x += SP) {
      const { file, scale } = pick(idx++);
      tasks.push(this.place(file, x, 0, E, Math.PI, scale));
    }

    // South edge  (z = -E)  — buildings face inward (north)
    for (let x = -E; x <= E; x += SP) {
      const { file, scale } = pick(idx++);
      tasks.push(this.place(file, x, 0, -E, 0, scale));
    }

    // East edge   (x = +E)  — buildings face inward (west)
    for (let z = -E; z <= E; z += SP) {
      const { file, scale } = pick(idx++);
      tasks.push(this.place(file, E, 0, z, -Math.PI / 2, scale));
    }

    // West edge   (x = -E)  — buildings face inward (east)
    for (let z = -E; z <= E; z += SP) {
      const { file, scale } = pick(idx++);
      tasks.push(this.place(file, -E, 0, z, Math.PI / 2, scale));
    }

    await Promise.all(tasks);
  }

  // ── Shared Loader ─────────────────────────────────────────────────────────

  private async place(
    file: string,
    x: number,
    y: number,
    z: number,
    rotY = 0,
    scale = 1
  ): Promise<void> {
    try {
      const result = await SceneLoader.ImportMeshAsync(
        "", "/assets/models/city/", file, this.scene
      );

      const root = result.meshes[0];
      root.position = new Vector3(x, y, z);
      root.rotation.y = rotY;
      root.scaling = new Vector3(scale, scale, scale);

      result.meshes.forEach((m) => {
        m.checkCollisions = true;
        m.receiveShadows  = true;
        if (this.shadowGenerator) {
          try { this.shadowGenerator.addShadowCaster(m, true); } catch (_) { /* skip */ }
        }
      });
    } catch (err) {
      console.warn(`[CityBuilder] Failed to load city/${file}:`, err);
    }
  }
}

