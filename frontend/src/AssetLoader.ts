import { Scene, SceneLoader, Mesh, MeshBuilder, StandardMaterial, Color3, AnimationGroup } from "@babylonjs/core";
import "@babylonjs/loaders/glTF";

export interface LoadedAsset {
  rootMesh: Mesh;
  animationGroups: AnimationGroup[];
}

export class AssetLoader {
  constructor(private scene: Scene) {}

  /**
   * Load a GLB model. If the file is missing, creates a fallback capsule mesh.
   */
  public async loadModel(fileName: string, meshName: string): Promise<LoadedAsset> {
    try {
      const result = await SceneLoader.ImportMeshAsync("", "/assets/models/", fileName, this.scene);

      // The first mesh in the array is the GLB's __root__ node — use it directly
      // so animation targets remain intact.
      const root = result.meshes[0] as Mesh;
      root.name = `${meshName}_root`;

      // Compute bounding box to fix vertical offset
      root.computeWorldMatrix(true);
      const childMeshes = root.getChildMeshes(false);
      let minY = Infinity;
      for (const child of childMeshes) {
        child.computeWorldMatrix(true);
        const bounds = child.getBoundingInfo();
        if (bounds) {
          const worldMin = bounds.boundingBox.minimumWorld.y;
          if (worldMin < minY) minY = worldMin;
        }
      }
      // Offset root so the model's feet sit at y=0
      if (minY !== Infinity) {
        root.position.y = -minY;
        console.log(`[AssetLoader] "${fileName}" ground offset: ${-minY} (minY was ${minY})`);
      }

      console.log(`[AssetLoader] Loaded "${fileName}" — meshes: ${result.meshes.length}, animGroups: ${result.animationGroups.length}`);
      result.animationGroups.forEach((ag) => console.log(`  anim: "${ag.name}"`));

      return {
        rootMesh: root,
        animationGroups: result.animationGroups,
      };
    } catch (err) {
      console.warn(`[AssetLoader] Failed to load "${fileName}", creating fallback mesh. Error:`, err);
      return this.createFallbackMesh(meshName);
    }
  }

  private createFallbackMesh(meshName: string): LoadedAsset {
    const capsule = MeshBuilder.CreateCapsule(
      meshName,
      { radius: 0.4, height: 1.8, tessellation: 16 },
      this.scene
    );

    const mat = new StandardMaterial(`${meshName}_mat`, this.scene);
    mat.diffuseColor = meshName.includes("player")
      ? new Color3(0.2, 0.4, 0.9)
      : new Color3(0.9, 0.3, 0.2);
    capsule.material = mat;

    // Lift capsule so it sits on the ground
    capsule.position.y = 0.9;

    return {
      rootMesh: capsule,
      animationGroups: [],
    };
  }
}
