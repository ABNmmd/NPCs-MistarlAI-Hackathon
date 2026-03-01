import type { AIService } from "./AIService";

export class ChatUI {
  private overlay: HTMLElement;
  private messagesContainer: HTMLElement;
  private input: HTMLInputElement;
  private sendBtn: HTMLElement;
  private closeBtn: HTMLElement;
  private npcNameEl: HTMLElement;

  private isOpen = false;
  private isSending = false;

  private onCloseCallback: (() => void) | null = null;

  constructor(private aiService: AIService) {
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

  public open(): void {
    if (this.isOpen) return;
    this.isOpen = true;

    this.npcNameEl.textContent = this.aiService.getNPCName();
    this.overlay.classList.add("visible");

    // Clear previous messages
    this.messagesContainer.innerHTML = "";

    // Show greeting
    this.addMessage(this.aiService.getGreeting(), "npc");

    // Focus the input
    setTimeout(() => this.input.focus(), 100);
  }

  public close(): void {
    if (!this.isOpen) return;
    this.isOpen = false;
    this.overlay.classList.remove("visible");
    this.aiService.resetConversation();
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
    if (!text || this.isSending) return;

    this.input.value = "";
    this.addMessage(text, "player");
    this.isSending = true;

    // Show typing indicator
    const typingEl = this.addMessage("...", "npc");
    typingEl.classList.add("typing");

    try {
      const response = await this.aiService.sendMessage(text);
      typingEl.textContent = response;
      typingEl.classList.remove("typing");
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
