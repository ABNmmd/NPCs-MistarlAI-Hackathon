import { Scene, Color3, Color4 } from "@babylonjs/core";

/**
 * ManagementUI — Real-time world property editor and JSON Command Console.
 *
 * Toggle with  M  key or the floating button.
 *
 * Sections:
 *  1. World Properties — sliders/pickers for fog, sky, lighting, foliage
 *  2. JSON Command Console — textarea to send raw JSON to window.GameAI
 */
export class ManagementUI {
  private panel: HTMLElement;
  private isVisible = false;

  // World property controls
  private fogDensityInput!: HTMLInputElement;
  private fogDensityValue!: HTMLSpanElement;
  private skyRInput!: HTMLInputElement;
  private skyGInput!: HTMLInputElement;
  private skyBInput!: HTMLInputElement;
  private ambientIntInput!: HTMLInputElement;
  private ambientIntValue!: HTMLSpanElement;
  private dirIntInput!: HTMLInputElement;
  private dirIntValue!: HTMLSpanElement;

  // Console
  private consoleInput!: HTMLTextAreaElement;
  private consoleOutput!: HTMLElement;

  constructor(private scene: Scene) {
    this.panel = document.getElementById("management-panel")!;
    this._bindControls();
    this._setupKeyToggle();
    this._syncFromScene();
  }

  // ──────────────────────────────────────────────────────────────────────────

  public toggle(): void {
    this.isVisible = !this.isVisible;
    if (this.isVisible) {
      this.panel.classList.add("open");
      this._syncFromScene();
    } else {
      this.panel.classList.remove("open");
    }

    // Update the HUD toggle button text
    const btn = document.getElementById("mgmt-toggle-btn");
    if (btn) btn.setAttribute("data-open", String(this.isVisible));
  }

  public show(): void { if (!this.isVisible) this.toggle(); }
  public hide(): void { if (this.isVisible) this.toggle(); }

  // ──────────────────────────── Private ─────────────────────────────────────

  private _bindControls(): void {
    // Fog density
    this.fogDensityInput = document.getElementById("mgmt-fog-density") as HTMLInputElement;
    this.fogDensityValue = document.getElementById("mgmt-fog-density-val") as HTMLSpanElement;

    // Sky colour
    this.skyRInput = document.getElementById("mgmt-sky-r") as HTMLInputElement;
    this.skyGInput = document.getElementById("mgmt-sky-g") as HTMLInputElement;
    this.skyBInput = document.getElementById("mgmt-sky-b") as HTMLInputElement;

    // Light intensities
    this.ambientIntInput = document.getElementById("mgmt-ambient-int") as HTMLInputElement;
    this.ambientIntValue = document.getElementById("mgmt-ambient-int-val") as HTMLSpanElement;
    this.dirIntInput = document.getElementById("mgmt-dir-int") as HTMLInputElement;
    this.dirIntValue = document.getElementById("mgmt-dir-int-val") as HTMLSpanElement;

    // Console
    this.consoleInput = document.getElementById("mgmt-console-input") as HTMLTextAreaElement;
    this.consoleOutput = document.getElementById("mgmt-console-output")!;

    // ── Fog ──
    this.fogDensityInput?.addEventListener("input", () => {
      const v = parseFloat(this.fogDensityInput.value);
      this.fogDensityValue.textContent = v.toFixed(4);
      this.scene.fogDensity = v;
      this._tryGameAI({ command: "updateWorld", params: { fog: { density: v } } });
    });

    // ── Sky ──
    const applySky = () => {
      const r = parseFloat(this.skyRInput.value) / 100;
      const g = parseFloat(this.skyGInput.value) / 100;
      const b = parseFloat(this.skyBInput.value) / 100;
      this.scene.clearColor = new Color4(r, g, b, 1);
      this.scene.fogColor = new Color3(r * 0.95, g * 0.95, b * 0.95);
      this._tryGameAI({ command: "updateWorld", params: { sky: { clearColor: [r, g, b, 1] } } });
    };
    this.skyRInput?.addEventListener("input", applySky);
    this.skyGInput?.addEventListener("input", applySky);
    this.skyBInput?.addEventListener("input", applySky);

    // ── Ambient light ──
    this.ambientIntInput?.addEventListener("input", () => {
      const v = parseFloat(this.ambientIntInput.value);
      this.ambientIntValue.textContent = v.toFixed(2);
      const hemi = this.scene.getLightByName("hemiLight");
      if (hemi) hemi.intensity = v;
      this._tryGameAI({ command: "updateWorld", params: { lighting: { ambient: { intensity: v } } } });
    });

    // ── Dir light ──
    this.dirIntInput?.addEventListener("input", () => {
      const v = parseFloat(this.dirIntInput.value);
      this.dirIntValue.textContent = v.toFixed(2);
      const dir = this.scene.getLightByName("dirLight");
      if (dir) dir.intensity = v;
      this._tryGameAI({ command: "updateWorld", params: { lighting: { directional: { intensity: v } } } });
    });

    // ── JSON Console ──
    document.getElementById("mgmt-console-run")?.addEventListener("click", () => {
      this._executeConsoleCommand();
    });

    document.getElementById("mgmt-console-clear")?.addEventListener("click", () => {
      this.consoleOutput.innerHTML = "";
    });

    this.consoleInput?.addEventListener("keydown", (e) => {
      // Ctrl+Enter to run
      if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        this._executeConsoleCommand();
      }
    });

    // ── Quick preset buttons ──
    document.getElementById("mgmt-preset-day")?.addEventListener("click", () => {
      this._applyPreset("day");
    });
    document.getElementById("mgmt-preset-dusk")?.addEventListener("click", () => {
      this._applyPreset("dusk");
    });
    document.getElementById("mgmt-preset-night")?.addEventListener("click", () => {
      this._applyPreset("night");
    });
    document.getElementById("mgmt-preset-fog")?.addEventListener("click", () => {
      this._applyPreset("heavyFog");
    });

    // ── Spawn tree shortcut ──
    document.getElementById("mgmt-spawn-tree")?.addEventListener("click", () => {
      const cmd = {
        command: "spawnObject",
        params: {
          type: "tree",
          position: [
            Math.round((Math.random() * 80) - 40),
            0,
            Math.round((Math.random() * 80) - 40)
          ]
        }
      };
      this._executeCommand(cmd);
    });

    // ── World state dump ──
    document.getElementById("mgmt-dump-state")?.addEventListener("click", () => {
      const state = (window as any).GameAI?.getWorldState?.();
      if (state) {
        this._logOutput(JSON.stringify(state, null, 2), "info");
      } else {
        this._logOutput("GameAI not available yet.", "error");
      }
    });

    // ── Help ──
    document.getElementById("mgmt-help")?.addEventListener("click", () => {
      const help = (window as any).GameAI?.help?.();
      if (help) {
        this._logOutput(JSON.stringify(help, null, 2), "info");
      }
    });
  }

  private _setupKeyToggle(): void {
    // M key is handled centrally by Game.ts to avoid double-toggling.
    // The toggle button and close button are wired here.

    document.getElementById("mgmt-toggle-btn")?.addEventListener("click", () => {
      this.toggle();
    });

    document.getElementById("mgmt-close-btn")?.addEventListener("click", () => {
      this.hide();
    });
  }

  /** Sync slider values from the live scene state. */
  private _syncFromScene(): void {
    if (this.fogDensityInput) {
      const v = this.scene.fogDensity ?? 0.0035;
      this.fogDensityInput.value = String(v);
      if (this.fogDensityValue) this.fogDensityValue.textContent = v.toFixed(4);
    }

    const cc = this.scene.clearColor;
    if (cc && this.skyRInput) {
      this.skyRInput.value = String(Math.round(cc.r * 100));
      this.skyGInput.value = String(Math.round(cc.g * 100));
      this.skyBInput.value = String(Math.round(cc.b * 100));
    }

    const hemi = this.scene.getLightByName("hemiLight");
    if (hemi && this.ambientIntInput) {
      this.ambientIntInput.value = String(hemi.intensity);
      if (this.ambientIntValue) this.ambientIntValue.textContent = hemi.intensity.toFixed(2);
    }

    const dir = this.scene.getLightByName("dirLight");
    if (dir && this.dirIntInput) {
      this.dirIntInput.value = String(dir.intensity);
      if (this.dirIntValue) this.dirIntValue.textContent = dir.intensity.toFixed(2);
    }
  }

  // ──────────────────────────── Console ─────────────────────────────────────

  private _executeConsoleCommand(): void {
    const raw = this.consoleInput?.value.trim();
    if (!raw) return;

    this._logOutput(`> ${raw}`, "cmd");

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      this._logOutput(`Parse error: invalid JSON`, "error");
      return;
    }

    this._executeCommand(parsed);
  }

  private _executeCommand(cmd: any): void {
    const gameAI = (window as any).GameAI;
    if (!gameAI) {
      this._logOutput("GameAI bridge not initialized yet.", "error");
      return;
    }

    try {
      let result: any;
      if (Array.isArray(cmd)) {
        result = gameAI.executeBatch(cmd);
      } else {
        result = gameAI.executeCommand(cmd);
      }
      this._logOutput(JSON.stringify(result, null, 2), result?.success === false ? "error" : "success");
    } catch (e: any) {
      this._logOutput(`Error: ${e.message}`, "error");
    }
  }

  private _tryGameAI(cmd: any): void {
    try {
      (window as any).GameAI?.executeCommand?.(cmd);
    } catch { /* silent */ }
  }

  private _logOutput(message: string, type: "cmd" | "success" | "error" | "info" = "info"): void {
    if (!this.consoleOutput) return;

    const line = document.createElement("div");
    line.className = `console-line console-${type}`;
    line.textContent = message;
    this.consoleOutput.appendChild(line);
    this.consoleOutput.scrollTop = this.consoleOutput.scrollHeight;

    // Keep log history manageable
    while (this.consoleOutput.children.length > 200) {
      this.consoleOutput.removeChild(this.consoleOutput.firstChild!);
    }
  }

  // ──────────────────────────── Presets ─────────────────────────────────────

  private _applyPreset(name: string): void {
    const presets: Record<string, any> = {
      day: {
        sky: { clearColor: [0.55, 0.72, 0.92, 1] },
        fog: { density: 0.0035, color: [0.65, 0.75, 0.85] },
        lighting: { ambient: { intensity: 0.6 }, directional: { intensity: 0.8 } },
      },
      dusk: {
        sky: { clearColor: [0.8, 0.45, 0.22, 1] },
        fog: { density: 0.005, color: [0.75, 0.5, 0.35] },
        lighting: { ambient: { intensity: 0.4 }, directional: { intensity: 0.5 } },
      },
      night: {
        sky: { clearColor: [0.05, 0.06, 0.15, 1] },
        fog: { density: 0.008, color: [0.05, 0.06, 0.12] },
        lighting: { ambient: { intensity: 0.15 }, directional: { intensity: 0.1 } },
      },
      heavyFog: {
        sky: { clearColor: [0.7, 0.72, 0.75, 1] },
        fog: { density: 0.025, color: [0.7, 0.72, 0.75] },
        lighting: { ambient: { intensity: 0.5 }, directional: { intensity: 0.3 } },
      },
    };

    const preset = presets[name];
    if (!preset) return;

    this._tryGameAI({ command: "updateWorld", params: preset });

    // Apply directly to scene for immediate feedback
    if (preset.sky?.clearColor) {
      const c = preset.sky.clearColor;
      this.scene.clearColor = new Color4(c[0], c[1], c[2], c[3] ?? 1);
    }
    if (preset.fog) {
      if (preset.fog.density !== undefined) this.scene.fogDensity = preset.fog.density;
      if (preset.fog.color) {
        const fc = preset.fog.color;
        this.scene.fogColor = new Color3(fc[0], fc[1], fc[2]);
      }
    }
    const hemi = this.scene.getLightByName("hemiLight");
    const dir = this.scene.getLightByName("dirLight");
    if (hemi && preset.lighting?.ambient?.intensity !== undefined) {
      hemi.intensity = preset.lighting.ambient.intensity;
    }
    if (dir && preset.lighting?.directional?.intensity !== undefined) {
      dir.intensity = preset.lighting.directional.intensity;
    }

    this._syncFromScene();
    this._logOutput(`Preset "${name}" applied.`, "success");
  }
}
