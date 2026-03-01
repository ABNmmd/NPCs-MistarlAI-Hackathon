import {
  Scene,
  HemisphericLight,
  DirectionalLight,
  Vector3,
  MeshBuilder,
  StandardMaterial,
  Color3,
  Color4,
  Texture,
  ShadowGenerator,
  Mesh,
} from "@babylonjs/core";

export class Environment {
  public ground!: Mesh;
  public shadowGenerator!: ShadowGenerator;

  /** Exposed so WorldManager (and others) can reference them. */
  public hemiLight!: HemisphericLight;
  public dirLight!: DirectionalLight;

  constructor(private scene: Scene) {}

  /**
   * Setup the environment, optionally driven by a world.json config object.
   * @param config  The parsed world.json object (or undefined for defaults).
   */
  public setup(config?: any): void {
    this.createLighting(config);
    this.applyFog(config);
    this.applySkyClear(config);
    this.createGround(config);
  }

  // ──────────────────────────────────────────────────────────────────────────

  private createLighting(config?: any): void {
    const ambCfg = config?.lighting?.ambient;
    const dirCfg = config?.lighting?.directional;

    // Ambient fill light
    const ambDir = ambCfg?.direction ?? [0, 1, 0];
    this.hemiLight = new HemisphericLight(
      "hemiLight",
      new Vector3(ambDir[0], ambDir[1], ambDir[2]),
      this.scene
    );
    this.hemiLight.intensity = ambCfg?.intensity ?? 0.5;
    const ambColor = ambCfg?.color ?? [0.95, 0.95, 1.0];
    this.hemiLight.diffuse = new Color3(ambColor[0], ambColor[1], ambColor[2]);
    const groundColor = ambCfg?.groundColor ?? [0.3, 0.35, 0.25];
    this.hemiLight.groundColor = new Color3(groundColor[0], groundColor[1], groundColor[2]);

    // Directional light for shadows
    const dirDir = dirCfg?.direction ?? [-1, -3, -2];
    this.dirLight = new DirectionalLight(
      "dirLight",
      new Vector3(dirDir[0], dirDir[1], dirDir[2]),
      this.scene
    );
    this.dirLight.position = new Vector3(20, 40, 20);
    this.dirLight.intensity = dirCfg?.intensity ?? 0.7;
    const dirColor = dirCfg?.color ?? [1.0, 0.95, 0.85];
    this.dirLight.diffuse = new Color3(dirColor[0], dirColor[1], dirColor[2]);

    // Shadow generator
    const shadowMapSize = dirCfg?.shadowMapSize ?? 2048;
    this.shadowGenerator = new ShadowGenerator(shadowMapSize, this.dirLight);
    this.shadowGenerator.useBlurExponentialShadowMap = true;
    this.shadowGenerator.blurKernel = 32;
  }

  private applyFog(config?: any): void {
    const fogCfg = config?.fog;
    if (!fogCfg || fogCfg.enabled === false) {
      this.scene.fogMode = Scene.FOGMODE_NONE;
      return;
    }

    this.scene.fogMode = Scene.FOGMODE_EXP2;
    this.scene.fogDensity = fogCfg.density ?? 0.0035;
    const fc = fogCfg.color ?? [0.65, 0.75, 0.85];
    this.scene.fogColor = new Color3(fc[0], fc[1], fc[2]);
  }

  private applySkyClear(config?: any): void {
    const cc = config?.sky?.clearColor ?? [0.55, 0.72, 0.92, 1.0];
    this.scene.clearColor = new Color4(cc[0], cc[1], cc[2], cc[3] ?? 1.0);
  }

  private createGround(config?: any): void {
    const terrain = config?.terrain;
    const width  = terrain?.width  ?? 200;
    const depth  = terrain?.depth  ?? 200;
    const subs   = terrain?.subdivisions ?? 64;

    this.ground = MeshBuilder.CreateGround(
      "ground",
      { width, height: depth, subdivisions: subs },
      this.scene
    );

    // Build a procedural grass texture
    const groundMat = new StandardMaterial("groundMat", this.scene);
    const spec = terrain?.material?.specularColor ?? [0.05, 0.05, 0.05];
    groundMat.specularColor = new Color3(spec[0], spec[1], spec[2]);
    groundMat.diffuseTexture = this._buildGrassTexture(terrain?.material?.diffuseColor);

    this.ground.material = groundMat;
    this.ground.receiveShadows = true;
    this.ground.checkCollisions = true;
  }

  // ── Dynamic weather ─────────────────────────────────────────────────────

  /**
   * Transition the scene to a named weather condition.
   * @param condition One of: clear | cloudy | rain | heavy_rain | fog | thunderstorm | blizzard | heatwave
   * @param transition "instant" applies immediately; "gradual" lerps over ~3 seconds.
   */
  public setWeather(condition: string, transition: "instant" | "gradual" = "gradual"): void {
    type Preset = { sky: [number,number,number,number]; fogDensity: number; fogColor: [number,number,number]; ambient: number; sun: number };
    const presets: Record<string, Preset> = {
      clear:        { sky: [0.55, 0.72, 0.92, 1], fogDensity: 0.0010, fogColor: [0.65, 0.75, 0.85], ambient: 0.55, sun: 0.80 },
      cloudy:       { sky: [0.60, 0.65, 0.72, 1], fogDensity: 0.0030, fogColor: [0.60, 0.65, 0.70], ambient: 0.40, sun: 0.45 },
      rain:         { sky: [0.35, 0.40, 0.50, 1], fogDensity: 0.0060, fogColor: [0.40, 0.45, 0.55], ambient: 0.30, sun: 0.25 },
      heavy_rain:   { sky: [0.20, 0.25, 0.35, 1], fogDensity: 0.0120, fogColor: [0.25, 0.30, 0.40], ambient: 0.20, sun: 0.15 },
      fog:          { sky: [0.75, 0.78, 0.82, 1], fogDensity: 0.0180, fogColor: [0.75, 0.78, 0.82], ambient: 0.35, sun: 0.20 },
      thunderstorm: { sky: [0.12, 0.14, 0.20, 1], fogDensity: 0.0140, fogColor: [0.15, 0.18, 0.25], ambient: 0.15, sun: 0.10 },
      blizzard:     { sky: [0.85, 0.88, 0.92, 1], fogDensity: 0.0200, fogColor: [0.88, 0.90, 0.95], ambient: 0.30, sun: 0.20 },
      heatwave:     { sky: [0.80, 0.65, 0.40, 1], fogDensity: 0.0008, fogColor: [0.82, 0.70, 0.50], ambient: 0.65, sun: 0.90 },
    };

    const p = presets[condition] ?? presets.clear;

    if (transition === "instant") {
      this._applyWeatherPreset(p);
    } else {
      const steps = 30;
      const intervalMs = 100; // 3 second total transition
      const start = {
        sky:        [this.scene.clearColor.r, this.scene.clearColor.g, this.scene.clearColor.b, this.scene.clearColor.a] as [number,number,number,number],
        fogDensity: this.scene.fogDensity,
        fogColor:   [this.scene.fogColor.r, this.scene.fogColor.g, this.scene.fogColor.b] as [number,number,number],
        ambient:    this.hemiLight.intensity,
        sun:        this.dirLight.intensity,
      };
      let step = 0;
      const id = setInterval(() => {
        step++;
        const t = step / steps;
        const lerp = (a: number, b: number) => a + (b - a) * t;
        this._applyWeatherPreset({
          sky:        [lerp(start.sky[0], p.sky[0]), lerp(start.sky[1], p.sky[1]), lerp(start.sky[2], p.sky[2]), 1],
          fogDensity: lerp(start.fogDensity, p.fogDensity),
          fogColor:   [lerp(start.fogColor[0], p.fogColor[0]), lerp(start.fogColor[1], p.fogColor[1]), lerp(start.fogColor[2], p.fogColor[2])],
          ambient:    lerp(start.ambient,    p.ambient),
          sun:        lerp(start.sun,        p.sun),
        });
        if (step >= steps) clearInterval(id);
      }, intervalMs);
    }
    console.log(`[Environment] Weather → ${condition} (${transition})`);
  }

  private _applyWeatherPreset(p: { sky: [number,number,number,number]; fogDensity: number; fogColor: [number,number,number]; ambient: number; sun: number }): void {
    this.scene.clearColor = new Color4(p.sky[0], p.sky[1], p.sky[2], p.sky[3]);
    this.scene.fogMode    = Scene.FOGMODE_EXP2;
    this.scene.fogDensity = p.fogDensity;
    this.scene.fogColor   = new Color3(p.fogColor[0], p.fogColor[1], p.fogColor[2]);
    this.hemiLight.intensity = p.ambient;
    this.dirLight.intensity  = p.sun;
  }

  // ────────────────────────────────────────────────────────────────────────

  /** Procedural canvas-based grass texture. */
  private _buildGrassTexture(diffuseColor?: number[]): Texture {
    const dc = diffuseColor ?? [0.35, 0.55, 0.25];
    const canvas = document.createElement("canvas");
    canvas.width = 256;
    canvas.height = 256;
    const ctx = canvas.getContext("2d")!;

    // Base
    const br = Math.round(dc[0] * 220);
    const bg = Math.round(dc[1] * 220);
    const bb = Math.round(dc[2] * 200);
    ctx.fillStyle = `rgb(${br},${bg},${bb})`;
    ctx.fillRect(0, 0, 256, 256);

    // Grass blade noise
    for (let i = 0; i < 4000; i++) {
      const x = Math.random() * 256;
      const y = Math.random() * 256;
      const brightVar = (Math.random() * 50) - 25;
      const r = Math.max(0, Math.min(255, br + brightVar * 0.4));
      const g = Math.max(0, Math.min(255, bg + brightVar));
      const b = Math.max(0, Math.min(255, bb + brightVar * 0.3));
      ctx.fillStyle = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
      ctx.fillRect(x, y, 1, Math.random() * 4 + 1);
    }

    const tex = new Texture(canvas.toDataURL(), this.scene);
    tex.uScale = 60;
    tex.vScale = 60;
    return tex;
  }
}
