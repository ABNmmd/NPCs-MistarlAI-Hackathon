export interface NPCConfig {
  npc_name: string;
  system_prompt: string;
  model: string;
  api_endpoint: string;
  api_key: string;
  temperature: number;
  max_tokens: number;
  greeting: string;
}

interface ChatMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export class AIService {
  private config!: NPCConfig;
  private conversationHistory: ChatMessage[] = [];
  private isLoaded = false;

  /**
   * Load the NPC configuration from the JSON file.
   */
  public async loadConfig(): Promise<void> {
    try {
      const response = await fetch("/npc_config.json");
      this.config = (await response.json()) as NPCConfig;
      this.isLoaded = true;

      // Initialize conversation with system prompt
      this.conversationHistory = [
        {
          role: "system",
          content: this.config.system_prompt,
        },
      ];
    } catch (err) {
      console.error("[AIService] Failed to load npc_config.json:", err);
      throw err;
    }
  }

  public getConfig(): NPCConfig {
    return this.config;
  }

  public getGreeting(): string {
    return this.config.greeting;
  }

  public getNPCName(): string {
    return this.config.npc_name;
  }

  /**
   * Send a user message to the LLM and return the assistant's response.
   * Replace `api_key` in npc_config.json with your real key to enable live calls.
   */
  public async sendMessage(userMessage: string): Promise<string> {
    if (!this.isLoaded) {
      throw new Error("AIService config not loaded. Call loadConfig() first.");
    }

    // Add user message to history
    this.conversationHistory.push({
      role: "user",
      content: userMessage,
    });

    try {
      const assistantMessage = await this.callLLM();

      // Add assistant response to history
      this.conversationHistory.push({
        role: "assistant",
        content: assistantMessage,
      });

      return assistantMessage;
    } catch (err) {
      console.error("[AIService] LLM call failed:", err);

      // Fallback mock response
      const fallback = this.getMockResponse(userMessage);
      this.conversationHistory.push({
        role: "assistant",
        content: fallback,
      });
      return fallback;
    }
  }

  /**
   * Make the actual API call. Structured so you can drop in your real API key.
   */
  private async callLLM(): Promise<string> {
    const { api_endpoint, api_key, model, temperature, max_tokens } = this.config;

    // If no real API key is set, use mock responses
    if (!api_key || api_key === "YOUR_API_KEY_HERE") {
      console.info("[AIService] No API key configured, using mock responses.");
      const lastUserMsg = this.conversationHistory[this.conversationHistory.length - 1].content;
      return this.getMockResponse(lastUserMsg);
    }

    const body = {
      model,
      messages: this.conversationHistory,
      temperature,
      max_tokens,
    };

    const response = await fetch(api_endpoint, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${api_key}`,
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`LLM API error: ${response.status} ${response.statusText}`);
    }

    const data = await response.json();

    // Standard OpenAI/Mistral-compatible response format
    const content: string = data.choices?.[0]?.message?.content ?? "...";
    return content.trim();
  }

  /**
   * Fallback mock responses when no API key is configured.
   */
  private getMockResponse(userMessage: string): string {
    const lower = userMessage.toLowerCase();

    if (lower.includes("hello") || lower.includes("hi") || lower.includes("hey")) {
      return "Greetings, traveler. The road has been long, but you've found your way here. What questions weigh upon your mind?";
    }
    if (lower.includes("name")) {
      return `I am called ${this.config.npc_name}. A name given to me by the old winds of the eastern valleys.`;
    }
    if (lower.includes("quest") || lower.includes("help")) {
      return "Seek the three ancient stones hidden across this land. Only then will the path forward reveal itself. But beware — not all paths are meant to be walked.";
    }
    if (lower.includes("bye") || lower.includes("goodbye")) {
      return "Safe travels, wanderer. May the stars guide your way through the darkest of nights.";
    }

    return "Hmm, an interesting thought. The world holds many mysteries, and I sense you are destined to unravel more than a few of them.";
  }

  /**
   * Reset conversation history (e.g., when closing chat).
   */
  public resetConversation(): void {
    this.conversationHistory = [
      {
        role: "system",
        content: this.config.system_prompt,
      },
    ];
  }
}
