import type { BackendService } from "./BackendService";
import type { GameWorldState } from "./types";

export class ChatUI {
  private overlay: HTMLElement;
  private messagesContainer: HTMLElement;
  private input: HTMLInputElement;
  private sendBtn: HTMLElement;
  private closeBtn: HTMLElement;
  private npcNameEl: HTMLElement;

  private isOpen = false;
  private isSending = false;

  private currentNpcId: string | null = null;
  private onCloseCallback: (() => void) | null = null;

  // World state getter — set by Game so ChatUI always has current state
  private getWorldState: (() => GameWorldState) | null = null;

  constructor(private backendService: BackendService) {
    this.overlay = document.getElementById("chat-overlay")!;
    this.messagesContainer = document.getElementById("chat-messages")!;
    this.input = document.getElementById("chat-input") as HTMLInputElement;
    this.sendBtn = document.getElementById("chat-send")!;
    this.closeBtn = document.getElementById("chat-close")!;
    this.npcNameEl = document.getElementById("chat-npc-name")!;

    this.sendBtn.addEventListener("click", () => this.handleSend());
    this.closeBtn.addEventListener("click", () => this.close());
    this.input.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && !e.shiftKey) {
        e.preventDefault();
        this.handleSend();
      }
    });
  }

  /**
   * Set a getter for the current world state (called by Game).
   */
  public setWorldStateGetter(getter: () => GameWorldState): void {
    this.getWorldState = getter;
  }

  /**
   * Open the chat window for a specific NPC.
   */
  public open(npcId: string, npcName: string, greeting: string): void {
    if (this.isOpen) return;
    this.isOpen = true;
    this.currentNpcId = npcId;

    this.npcNameEl.textContent = npcName;
    this.overlay.classList.add("visible");

    // Clear previous messages
    this.messagesContainer.innerHTML = "";

    // Show greeting
    this.addMessage(greeting, "npc");

    // Focus the input
    setTimeout(() => this.input.focus(), 100);
  }

  public close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.currentNpcId = null;
    this.overlay.classList.remove("visible");
    this.onCloseCallback?.();
  }

  public onClose(callback: () => void): void {
    this.onCloseCallback = callback;
  }

  public getIsOpen(): boolean {
    return this.isOpen;
  }

  private async handleSend(): Promise<void> {
    const text = this.input.value.trim();
    if (!text || this.isSending || !this.currentNpcId) return;

    this.input.value = "";
    this.addMessage(text, "player");
    this.isSending = true;

    // Show typing indicator
    const typingEl = this.addMessage("...", "npc");
    typingEl.classList.add("typing");

    try {
      const worldState = this.getWorldState?.() ?? {
        location: "city_center",
        weather: "clear",
        time_of_day: "noon",
        tension_level: 0,
        player_karma: 0,
        active_npcs: [],
      };

      const response = await this.backendService.npcReact(
        this.currentNpcId,
        text,
        worldState
      );

      typingEl.textContent = response.dialogue;
      typingEl.classList.remove("typing");

      // Play audio if available
      if (response.audio_url) {
        try {
          const audio = new Audio(response.audio_url);
          audio.play();
        } catch (audioErr) {
          console.warn("[ChatUI] Failed to play audio:", audioErr);
        }
      }
    } catch {
      typingEl.textContent = "[Error: Failed to get response]";
      typingEl.classList.remove("typing");
    }

    this.isSending = false;
    this.scrollToBottom();
    this.input.focus();
  }

  private addMessage(text: string, sender: "player" | "npc"): HTMLElement {
    const msgEl = document.createElement("div");
    msgEl.classList.add("chat-message", sender);
    msgEl.textContent = text;
    this.messagesContainer.appendChild(msgEl);
    this.scrollToBottom();
    return msgEl;
  }

  private scrollToBottom(): void {
    this.messagesContainer.scrollTop = this.messagesContainer.scrollHeight;
  }
}
