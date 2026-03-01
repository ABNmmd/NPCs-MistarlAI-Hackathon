import { Scene, HemisphericLight, DirectionalLight, Vector3, MeshBuilder, StandardMaterial, Color3, Texture, ShadowGenerator, Mesh } from "@babylonjs/core";

export class Environment {
  public ground!: Mesh;
  public shadowGenerator!: ShadowGenerator;

  constructor(private scene: Scene) {}

  public setup(): void {
    this.createLighting();
    this.createGround();
  }

  private createLighting(): void {
    // Ambient fill light
    const hemiLight = new HemisphericLight("hemiLight", new Vector3(0, 1, 0), this.scene);
    hemiLight.intensity = 0.6;
    hemiLight.groundColor = new Color3(0.2, 0.2, 0.3);

    // Directional light for shadows and key lighting
    const dirLight = new DirectionalLight("dirLight", new Vector3(-1, -2, -1), this.scene);
    dirLight.position = new Vector3(20, 40, 20);
    dirLight.intensity = 0.8;

    // Shadow generator
    this.shadowGenerator = new ShadowGenerator(1024, dirLight);
    this.shadowGenerator.useBlurExponentialShadowMap = true;
    this.shadowGenerator.blurKernel = 32;
  }

  private createGround(): void {
    // Large city ground — 200×200 units
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
