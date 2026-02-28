import {
  Engine,
  Scene,
  ArcRotateCamera,
  Vector3,
  HemisphericLight,
  MeshBuilder,
  CubeTexture,
  Texture,
  StandardMaterial,
  Color3,
} from "@babylonjs/core";

// Initialize the canvas and engine
const canvas = document.getElementById("renderCanvas") as HTMLCanvasElement;
const engine = new Engine(canvas, true);

// Resize canvas to full window
const resizeCanvas = () => {
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
};

// Initial resize
resizeCanvas();

// Handle browser resize
window.addEventListener("resize", () => {
  resizeCanvas();
  engine.resize();
});

// Create a scene
const createScene = () => {
  const scene = new Scene(engine);

  // Add a camera
  const camera = new ArcRotateCamera("camera", -Math.PI / 2, Math.PI / 2.5, 10, Vector3.Zero(), scene);
  camera.attachControl(canvas, true);

  // Add light
  const light = new HemisphericLight("light", new Vector3(0, 1, 0), scene);
  light.intensity = 0.7;

  // Add a ground plane
  const ground = MeshBuilder.CreateGround("ground", { width: 10, height: 10 }, scene);

  // Add a skybox
  const skybox = MeshBuilder.CreateBox("skyBox", { size: 1000.0 }, scene);
  const skyboxMaterial = new StandardMaterial("skyBox", scene);
  skyboxMaterial.backFaceCulling = false;
  skyboxMaterial.reflectionTexture = new CubeTexture("textures/skybox", scene);
  skyboxMaterial.reflectionTexture.coordinatesMode = Texture.SKYBOX_MODE;
  skyboxMaterial.diffuseColor = new Color3(0, 0, 0);
  skyboxMaterial.specularColor = new Color3(0, 0, 0);
  skybox.material = skyboxMaterial;

  return scene;
};

// Create and render the scene
const scene = createScene();

// Run the render loop
engine.runRenderLoop(() => {
  scene.render();
});

