export class HUD {
  private narratorEl: HTMLElement;
  private karmaEl: HTMLElement;
  private weatherEl: HTMLElement;
  private narratorTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    this.narratorEl = document.getElementById("narrator-bar")!;
    this.karmaEl = document.getElementById("hud-karma")!;
    this.weatherEl = document.getElementById("hud-weather")!;
  }

  /**
   * Show narrator text at the top of the screen, auto-hide after duration.
   */
  public showNarrator(text: string, durationMs = 6000): void {
    if (!text.trim()) return;

    // Clear any existing timer
    if (this.narratorTimer) {
      clearTimeout(this.narratorTimer);
    }

    this.narratorEl.textContent = text;
    this.narratorEl.classList.add("visible");

    this.narratorTimer = setTimeout(() => {
      this.narratorEl.classList.remove("visible");
      this.narratorTimer = null;
    }, durationMs);
  }

  /**
   * Update the karma display.
   */
  public updateKarma(karma: number): void {
    const sign = karma >= 0 ? "+" : "";
    this.karmaEl.textContent = `Karma: ${sign}${karma}`;

    // Color code: green for positive, red for negative, white for neutral
    if (karma > 20) {
      this.karmaEl.style.color = "#6ef78e";
    } else if (karma < -20) {
      this.karmaEl.style.color = "#f76e6e";
    } else {
      this.karmaEl.style.color = "#ccc";
    }
  }

  /**
   * Update the weather indicator.
   */
  public updateWeather(condition: string): void {
    const labels: Record<string, string> = {
      clear: "Clear",
      cloudy: "Cloudy",
      rain: "Rain",
      heavy_rain: "Heavy Rain",
      fog: "Fog",
      thunderstorm: "Thunderstorm",
      blizzard: "Blizzard",
      heatwave: "Heatwave",
    };
    this.weatherEl.textContent = labels[condition] ?? condition;
  }
}
