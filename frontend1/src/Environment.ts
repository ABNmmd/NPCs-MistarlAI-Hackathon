import { Scene, HemisphericLight, DirectionalLight, Vector3, MeshBuilder, StandardMaterial, Color3, Color4, Texture, ShadowGenerator, Mesh } from "@babylonjs/core";

export class Environment {
  public ground!: Mesh;
  public shadowGenerator!: ShadowGenerator;

  private hemiLight!: HemisphericLight;
  private dirLight!: DirectionalLight;

  constructor(private scene: Scene) {}

  public setup(): void {
    this.createLighting();
    this.createGround();
  }

  /**
   * Change the visual weather. Adjusts lighting and sky color.
   */
  public setWeather(condition: string): void {
    switch (condition) {
      case "clear":
        this.hemiLight.intensity = 0.6;
        this.dirLight.intensity = 0.8;
        this.scene.clearColor = new Color4(0.53, 0.7, 0.85, 1);
        this.scene.fogEnabled = false;
        break;

      case "cloudy":
        this.hemiLight.intensity = 0.5;
        this.dirLight.intensity = 0.5;
        this.scene.clearColor = new Color4(0.6, 0.6, 0.65, 1);
        this.scene.fogEnabled = false;
        break;

      case "rain":
      case "heavy_rain":
        this.hemiLight.intensity = 0.35;
        this.dirLight.intensity = 0.3;
        this.scene.clearColor = new Color4(0.35, 0.38, 0.42, 1);
        this.scene.fogEnabled = false;
        break;

      case "fog":
        this.hemiLight.intensity = 0.4;
        this.dirLight.intensity = 0.3;
        this.scene.clearColor = new Color4(0.7, 0.7, 0.7, 1);
        this.scene.fogEnabled = true;
        this.scene.fogMode = Scene.FOGMODE_EXP2;
        this.scene.fogDensity = 0.03;
        this.scene.fogColor = new Color3(0.7, 0.7, 0.7);
        break;

      case "thunderstorm":
        this.hemiLight.intensity = 0.2;
        this.dirLight.intensity = 0.15;
        this.scene.clearColor = new Color4(0.15, 0.15, 0.2, 1);
        this.scene.fogEnabled = false;
        break;

      case "blizzard":
        this.hemiLight.intensity = 0.3;
        this.dirLight.intensity = 0.2;
        this.scene.clearColor = new Color4(0.8, 0.82, 0.85, 1);
        this.scene.fogEnabled = true;
        this.scene.fogMode = Scene.FOGMODE_EXP2;
        this.scene.fogDensity = 0.05;
        this.scene.fogColor = new Color3(0.85, 0.85, 0.9);
        break;

      case "heatwave":
        this.hemiLight.intensity = 0.75;
        this.dirLight.intensity = 1.0;
        this.scene.clearColor = new Color4(0.65, 0.6, 0.45, 1);
        this.scene.fogEnabled = false;
        break;

      default:
        console.warn(`[Environment] Unknown weather condition: "${condition}"`);
        break;
    }

    console.log(`[Environment] Weather set to: ${condition}`);
  }

  private createLighting(): void {
    // Ambient fill light
    this.hemiLight = new HemisphericLight("hemiLight", new Vector3(0, 1, 0), this.scene);
    this.hemiLight.intensity = 0.6;
    this.hemiLight.groundColor = new Color3(0.2, 0.2, 0.3);

    // Directional light for shadows and key lighting
    this.dirLight = new DirectionalLight("dirLight", new Vector3(-1, -2, -1), this.scene);
    this.dirLight.position = new Vector3(20, 40, 20);
    this.dirLight.intensity = 0.8;

    // Shadow generator
    this.shadowGenerator = new ShadowGenerator(1024, this.dirLight);
    this.shadowGenerator.useBlurExponentialShadowMap = true;
    this.shadowGenerator.blurKernel = 32;
  }

  private createGround(): void {
    // Large city ground — 200x200 units
    this.ground = MeshBuilder.CreateGround("ground", { width: 200, height: 200, subdivisions: 100 }, this.scene);

    const groundMat = new StandardMaterial("groundMat", this.scene);
    groundMat.specularColor = new Color3(0.05, 0.05, 0.05);
    groundMat.wireframe = false;

    // Concrete / asphalt texture
    const concreteTexture = this.createConcreteTexture();
    concreteTexture.uScale = 100;
    concreteTexture.vScale = 100;
    groundMat.diffuseTexture = concreteTexture;

    this.ground.material = groundMat;
    this.ground.receiveShadows = true;
    this.ground.checkCollisions = true;
  }

  private createConcreteTexture(): Texture {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const ctx = canvas.getContext("2d")!;

    // Base concrete colour
    ctx.fillStyle = "#7A7A78";
    ctx.fillRect(0, 0, 128, 128);

    // Subtle noise for concrete feel
    for (let i = 0; i < 600; i++) {
      const px = Math.random() * 128;
      const py = Math.random() * 128;
      const brightness = Math.floor(Math.random() * 30) - 15;
      const v = Math.max(0, Math.min(255, 122 + brightness));
      ctx.fillStyle = `rgb(${v},${v},${v - 2})`;
      ctx.fillRect(px, py, 2, 2);
    }

    // Faint grid seams
    ctx.strokeStyle = "rgba(50,50,50,0.25)";
    ctx.lineWidth = 1;
    ctx.strokeRect(0, 0, 128, 128);

    const texture = new Texture(canvas.toDataURL(), this.scene);
    return texture;
  }
}
