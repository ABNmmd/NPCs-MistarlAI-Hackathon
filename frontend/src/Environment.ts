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
   * @param condition One of: clear | cloudy | rain | heavy_rain | fog | thunderstorm | blizzard | heatwave | mystical | enchanted
   * @param transition "instant" applies immediately; "gradual" lerps over ~3 seconds.
   */
  public setWeather(condition: string, transition: "instant" | "gradual" = "gradual"): void {
    type Preset = { sky: [number,number,number,number]; fogDensity: number; fogColor: [number,number,number]; ambient: number; sun: number };
    const presets: Record<string, Preset> = {
      // Natural outdoor weather presets
      clear:        { sky: [0.52, 0.72, 0.92, 1], fogDensity: 0.0012, fogColor: [0.62, 0.78, 0.90], ambient: 0.60, sun: 0.80 },
      cloudy:       { sky: [0.60, 0.65, 0.72, 1], fogDensity: 0.0030, fogColor: [0.60, 0.65, 0.70], ambient: 0.45, sun: 0.50 },
      rain:         { sky: [0.40, 0.45, 0.55, 1], fogDensity: 0.0055, fogColor: [0.45, 0.50, 0.58], ambient: 0.32, sun: 0.28 },
      heavy_rain:   { sky: [0.28, 0.32, 0.42, 1], fogDensity: 0.0100, fogColor: [0.32, 0.36, 0.45], ambient: 0.22, sun: 0.18 },
      fog:          { sky: [0.75, 0.78, 0.82, 1], fogDensity: 0.0160, fogColor: [0.78, 0.80, 0.84], ambient: 0.38, sun: 0.25 },
      thunderstorm: { sky: [0.18, 0.20, 0.28, 1], fogDensity: 0.0120, fogColor: [0.22, 0.24, 0.32], ambient: 0.18, sun: 0.12 },
      blizzard:     { sky: [0.85, 0.88, 0.92, 1], fogDensity: 0.0180, fogColor: [0.88, 0.90, 0.94], ambient: 0.35, sun: 0.25 },
      heatwave:     { sky: [0.75, 0.68, 0.50, 1], fogDensity: 0.0008, fogColor: [0.78, 0.72, 0.55], ambient: 0.68, sun: 0.92 },
      sunset:       { sky: [0.85, 0.55, 0.40, 1], fogDensity: 0.0015, fogColor: [0.82, 0.60, 0.48], ambient: 0.48, sun: 0.60 },
      night:        { sky: [0.08, 0.10, 0.18, 1], fogDensity: 0.0018, fogColor: [0.12, 0.14, 0.22], ambient: 0.18, sun: 0.08 },
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

  

  // Procedural canvas-based natural grass texture
  private _buildGrassTexture(diffuseColor?: number[]): Texture {
    // Natural grass green colors
    const dc = diffuseColor ?? [0.32, 0.55, 0.28];
    const canvas = document.createElement("canvas");
    canvas.width = 512;
    canvas.height = 512;
    const ctx = canvas.getContext("2d")!;

    // Create natural grass base
    const baseR = Math.round(dc[0] * 210);
    const baseG = Math.round(dc[1] * 230);
    const baseB = Math.round(dc[2] * 190);
    ctx.fillStyle = `rgb(${baseR},${baseG},${baseB})`;
    ctx.fillRect(0, 0, 512, 512);

    // Add grass blade texture with natural color variation
    for (let i = 0; i < 8000; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const brightVar = (Math.random() * 50) - 25;
      const r = Math.max(0, Math.min(255, baseR + brightVar * 0.4));
      const g = Math.max(0, Math.min(255, baseG + brightVar));
      const b = Math.max(0, Math.min(255, baseB + brightVar * 0.3));
      ctx.fillStyle = `rgb(${Math.round(r)},${Math.round(g)},${Math.round(b)})`;
      ctx.fillRect(x, y, 1.2, Math.random() * 4 + 1);
    }

    // Add darker grass patches for depth
    for (let i = 0; i < 40; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const size = Math.random() * 30 + 15;
      const patchGradient = ctx.createRadialGradient(x, y, 0, x, y, size);
      patchGradient.addColorStop(0, `rgba(${baseR * 0.7}, ${baseG * 0.75}, ${baseB * 0.65}, 0.25)`);
      patchGradient.addColorStop(1, `rgba(${baseR * 0.7}, ${baseG * 0.75}, ${baseB * 0.65}, 0)`);
      ctx.fillStyle = patchGradient;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }

    // Add subtle dirt/bare patches for realism
    for (let i = 0; i < 15; i++) {
      const x = Math.random() * 512;
      const y = Math.random() * 512;
      const size = Math.random() * 18 + 8;
      const dirtGradient = ctx.createRadialGradient(x, y, 0, x, y, size);
      dirtGradient.addColorStop(0, 'rgba(120, 95, 70, 0.2)');
      dirtGradient.addColorStop(1, 'rgba(120, 95, 70, 0)');
      ctx.fillStyle = dirtGradient;
      ctx.beginPath();
      ctx.arc(x, y, size, 0, Math.PI * 2);
      ctx.fill();
    }

    const tex = new Texture(canvas.toDataURL(), this.scene);
    tex.uScale = 50;
    tex.vScale = 50;
    return tex;
  }
}
