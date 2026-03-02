/**
 * QuestManager - Handles storyline, quests, and objectives
 * 
 * Features:
 * - Main story arc with chapters
 * - Side quests from NPCs
 * - Objective tracking
 * - Quest rewards (karma, items)
 * - Event-driven quest updates
 */

export interface QuestObjective {
  id: string;
  description: string;
  type: "talk" | "collect" | "kill" | "visit" | "escort" | "deliver" | "explore" | "karma_reach" | "talk_unique";
  target?: string;        // NPC id, item name, location name
  targetValue?: number;   // For karma_reach: the karma value to reach
  current: number;
  required: number;
  completed: boolean;
  optional?: boolean;
}

export interface Quest {
  id: string;
  title: string;
  description: string;
  chapter?: number;        // For main story quests
  type: "main" | "side" | "daily";
  status: "locked" | "available" | "active" | "completed" | "failed";
  objectives: QuestObjective[];
  rewards: {
    karma?: number;
    gold?: number;
    items?: string[];
    unlocks?: string[];   // Quest IDs to unlock
  };
  giverNpcId?: string;     // NPC who gives this quest
  turnInNpcId?: string;    // NPC to turn in quest to
  dialogue?: {
    start?: string;        // Quest giver dialogue
    progress?: string;     // Mid-quest check-in
    complete?: string;     // Completion dialogue
  };
  prerequisites?: string[]; // Quest IDs that must be completed first
}

export interface StoryChapter {
  number: number;
  title: string;
  description: string;
  unlocked: boolean;
  completed: boolean;
}

type QuestEventType = "questStarted" | "questCompleted" | "questFailed" | "objectiveUpdated" | "chapterUnlocked";
type QuestEventCallback = (event: QuestEventType, data: any) => void;

export class QuestManager {
  private quests: Map<string, Quest> = new Map();
  private chapters: StoryChapter[] = [];
  private currentChapter: number = 1;
  private eventCallbacks: QuestEventCallback[] = [];
  private _uiElement: HTMLElement | null = null;
  private talkedToNpcs: Set<string> = new Set(); // Track unique NPCs talked to

  constructor() {
    this.initializeStory();
    this.createUI();
  }

  // ── Story Initialization ──────────────────────────────────────────────────

  private initializeStory(): void {
    // Define story chapters
    this.chapters = [
      {
        number: 1,
        title: "The Awakening",
        description: "You awaken in a strange land with no memory of how you arrived. The villagers speak of dark omens...",
        unlocked: true,
        completed: false,
      },
      {
        number: 2,
        title: "Gathering Allies",
        description: "To face the growing darkness, you must earn the trust of those who dwell in this realm.",
        unlocked: false,
        completed: false,
      },
      {
        number: 3,
        title: "The Shadow Rises",
        description: "Dark forces stir in the forgotten places. Ancient evils have noticed your presence.",
        unlocked: false,
        completed: false,
      },
      {
        number: 4,
        title: "The Final Stand",
        description: "All paths lead to this moment. The fate of the realm rests upon your choices.",
        unlocked: false,
        completed: false,
      },
    ];

    // Define quests
    this.registerQuest({
      id: "main_01_awakening",
      title: "Strange New World",
      description: "You've awakened in an unfamiliar land. Speak with the nearby villagers to learn where you are.",
      chapter: 1,
      type: "main",
      status: "active",
      objectives: [
        { id: "talk_villager", description: "Speak with a villager", type: "talk", target: "villager", current: 0, required: 1, completed: false },
      ],
      rewards: { karma: 5, unlocks: ["main_02_merchant"] },
      dialogue: {
        start: "The world feels unfamiliar, yet somehow you sense you were meant to be here...",
        complete: "The villagers have welcomed you. Perhaps there is hope in this strange land.",
      },
    });

    this.registerQuest({
      id: "main_02_merchant",
      title: "The Merchant's Whispers",
      description: "A traveling merchant claims to know something about your arrival. Find and speak with them.",
      chapter: 1,
      type: "main",
      status: "locked",
      prerequisites: ["main_01_awakening"],
      objectives: [
        { id: "find_merchant", description: "Find and speak with a merchant", type: "talk", target: "merchant", current: 0, required: 1, completed: false },
      ],
      rewards: { karma: 10, gold: 50, unlocks: ["main_03_healer", "side_blacksmith_task"] },
      dialogue: {
        start: "Ah, a newcomer! I've heard whispers about you on the trade roads...",
        complete: "The merchant's words are cryptic, but they point toward the healer who lives nearby.",
      },
    });

    this.registerQuest({
      id: "main_03_healer",
      title: "Words of Wisdom",
      description: "The healer may know more about the dark omens the villagers speak of.",
      chapter: 1,
      type: "main",
      status: "locked",
      prerequisites: ["main_02_merchant"],
      objectives: [
        { id: "talk_healer", description: "Consult with the healer", type: "talk", target: "healer", current: 0, required: 1, completed: false },
        { id: "gather_herbs", description: "Help gather healing herbs", type: "collect", target: "herb", current: 0, required: 3, completed: false, optional: true },
      ],
      rewards: { karma: 15, unlocks: ["chapter_2"] },
      dialogue: {
        start: "The spirits have whispered of your coming, traveler...",
        complete: "The healer's visions confirm it: you are here for a reason. Chapter 1 complete!",
      },
    });

    // Side quests
    this.registerQuest({
      id: "side_blacksmith_task",
      title: "The Smith's Request",
      description: "The blacksmith needs assistance with a task. Help them to earn their trust.",
      type: "side",
      status: "locked",
      prerequisites: ["main_02_merchant"],
      objectives: [
        { id: "talk_blacksmith", description: "Speak with the blacksmith", type: "talk", target: "blacksmith", current: 0, required: 1, completed: false },
      ],
      rewards: { karma: 10, gold: 30 },
      dialogue: {
        start: "You look like someone who can handle themselves. I have a proposition...",
        complete: "The blacksmith nods with respect. You've proven yourself trustworthy.",
      },
    });

    this.registerQuest({
      id: "side_guard_patrol",
      title: "Patrol Duty",
      description: "A guard has asked you to help patrol the perimeter.",
      type: "side",
      status: "available",
      objectives: [
        { id: "talk_guard", description: "Report to the guard", type: "talk", target: "guard", current: 0, required: 1, completed: false },
        { id: "patrol_points", description: "Visit patrol points", type: "visit", current: 0, required: 4, completed: false },
      ],
      rewards: { karma: 8, gold: 20 },
      dialogue: {
        start: "Halt! Actually... you look capable. Care to help with patrol?",
        complete: "Well done. The perimeter is secure thanks to you.",
      },
    });

    this.registerQuest({
      id: "side_wanderer_tales",
      title: "Tales of the Road",
      description: "A wanderer has stories to share. Listen to their tales of distant lands.",
      type: "side",
      status: "available",
      objectives: [
        { id: "listen_stories", description: "Listen to the wanderer's stories", type: "talk", target: "wanderer", current: 0, required: 2, completed: false },
      ],
      rewards: { karma: 5 },
      dialogue: {
        start: "Sit, friend. Let me tell you of the places I've seen...",
        complete: "The wanderer's tales have given you new perspective on this world.",
      },
    });

    console.log(`[QuestManager] Initialized with ${this.quests.size} quests and ${this.chapters.length} chapters`);
  }

  // ── Quest Registration & Management ───────────────────────────────────────

  public registerQuest(quest: Quest): void {
    this.quests.set(quest.id, quest);
  }

  public getQuest(id: string): Quest | undefined {
    return this.quests.get(id);
  }

  public getActiveQuests(): Quest[] {
    return Array.from(this.quests.values()).filter(q => q.status === "active");
  }

  public getAvailableQuests(): Quest[] {
    return Array.from(this.quests.values()).filter(q => q.status === "available");
  }

  public getMainQuests(): Quest[] {
    return Array.from(this.quests.values()).filter(q => q.type === "main");
  }

  public getSideQuests(): Quest[] {
    return Array.from(this.quests.values()).filter(q => q.type === "side");
  }

  // ── Quest Actions ─────────────────────────────────────────────────────────

  public startQuest(questId: string): boolean {
    const quest = this.quests.get(questId);
    if (!quest) return false;
    if (quest.status !== "available") return false;

    quest.status = "active";
    this.emitEvent("questStarted", { quest });
    this.updateUI();
    this.showQuestNotification(`Quest Started: ${quest.title}`);
    return true;
  }

  public updateObjective(questId: string, objectiveId: string, amount: number = 1): boolean {
    const quest = this.quests.get(questId);
    if (!quest || quest.status !== "active") return false;

    const objective = quest.objectives.find(o => o.id === objectiveId);
    if (!objective || objective.completed) return false;

    objective.current = Math.min(objective.current + amount, objective.required);
    if (objective.current >= objective.required) {
      objective.completed = true;
      this.showQuestNotification(`Objective Complete: ${objective.description}`);
    }

    this.emitEvent("objectiveUpdated", { quest, objective });
    this.checkQuestCompletion(questId);
    this.updateUI();
    return true;
  }

  public completeObjectiveByTarget(targetType: string, targetId?: string): void {
    // Find all active quests with objectives matching this target
    console.log(`[QuestManager] completeObjectiveByTarget: looking for target="${targetType}"`);
    for (const quest of this.getActiveQuests()) {
      for (const obj of quest.objectives) {
        console.log(`[QuestManager] Checking objective: id="${obj.id}", target="${obj.target}", completed=${obj.completed}`);
        if (!obj.completed && obj.target === targetType) {
          console.log(`[QuestManager] MATCH! Updating objective ${obj.id}`);
          this.updateObjective(quest.id, obj.id, 1);
        }
      }
    }
  }

  private checkQuestCompletion(questId: string): void {
    const quest = this.quests.get(questId);
    if (!quest || quest.status !== "active") return;

    // Check if all required (non-optional) objectives are complete
    const requiredComplete = quest.objectives
      .filter(o => !o.optional)
      .every(o => o.completed);

    if (requiredComplete) {
      this.completeQuest(questId);
    }
  }

  public completeQuest(questId: string): boolean {
    const quest = this.quests.get(questId);
    if (!quest) return false;

    quest.status = "completed";
    
    // Apply rewards
    if (quest.rewards.unlocks) {
      for (const unlockId of quest.rewards.unlocks) {
        if (unlockId === "chapter_2") {
          this.unlockChapter(2);
        } else if (unlockId === "chapter_3") {
          this.unlockChapter(3);
        } else if (unlockId === "chapter_4") {
          this.unlockChapter(4);
        } else {
          const unlockQuest = this.quests.get(unlockId);
          if (unlockQuest && unlockQuest.status === "locked") {
            unlockQuest.status = "available";
            this.showQuestNotification(`New Quest Available: ${unlockQuest.title}`);
          }
        }
      }
    }

    this.emitEvent("questCompleted", { quest });
    this.updateUI();
    this.showQuestNotification(`Quest Complete: ${quest.title}`, "success");
    
    // Check if chapter is complete
    if (quest.type === "main" && quest.chapter) {
      this.checkChapterCompletion(quest.chapter);
    }

    return true;
  }

  private unlockChapter(chapterNum: number): void {
    const chapter = this.chapters.find(c => c.number === chapterNum);
    if (chapter && !chapter.unlocked) {
      chapter.unlocked = true;
      this.currentChapter = chapterNum;
      this.emitEvent("chapterUnlocked", { chapter });
      this.showChapterTitle(chapter);
    }
  }

  private checkChapterCompletion(chapterNum: number): void {
    const chapterQuests = Array.from(this.quests.values())
      .filter(q => q.type === "main" && q.chapter === chapterNum);
    
    const allComplete = chapterQuests.every(q => q.status === "completed");
    if (allComplete) {
      const chapter = this.chapters.find(c => c.number === chapterNum);
      if (chapter) {
        chapter.completed = true;
        this.showQuestNotification(`Chapter ${chapterNum} Complete: ${chapter.title}`, "chapter");
      }
    }
  }

  // ── NPC Integration ───────────────────────────────────────────────────────

  public onTalkToNPC(npcId: string, npcTemplate: string): { questDialogue?: string; questStarted?: string } {
    const result: { questDialogue?: string; questStarted?: string } = {};
    
    console.log(`[QuestManager] onTalkToNPC called: npcId="${npcId}", template="${npcTemplate}"`);
    console.log(`[QuestManager] Active quests:`, this.getActiveQuests().map(q => q.id));

    // Track unique NPCs talked to
    const isNewNpc = !this.talkedToNpcs.has(npcId);
    if (isNewNpc) {
      this.talkedToNpcs.add(npcId);
      // Update talk_unique objectives
      this.updateTalkUniqueObjectives();
    }

    // Check if talking to this NPC completes any objectives (also "any" target)
    console.log(`[QuestManager] Completing objectives for target: "${npcTemplate}"`);
    this.completeObjectiveByTarget(npcTemplate);
    this.completeObjectiveByTarget("any"); // For objectives targeting any NPC

    // Check if this NPC has an available quest to give
    for (const quest of this.getAvailableQuests()) {
      if (quest.giverNpcId === npcId || quest.objectives.some(o => o.target === npcTemplate && o.type === "talk")) {
        result.questDialogue = quest.dialogue?.start;
        this.startQuest(quest.id);
        result.questStarted = quest.id;
        break;
      }
    }

    // Check if active quest has progress dialogue for this NPC
    for (const quest of this.getActiveQuests()) {
      if (quest.objectives.some(o => o.target === npcTemplate)) {
        result.questDialogue = quest.dialogue?.progress || result.questDialogue;
      }
    }

    return result;
  }

  /** Update talk_unique objectives based on how many unique NPCs have been talked to */
  private updateTalkUniqueObjectives(): void {
    const uniqueCount = this.talkedToNpcs.size;
    for (const quest of this.getActiveQuests()) {
      for (const obj of quest.objectives) {
        if (!obj.completed && obj.type === "talk_unique") {
          obj.current = uniqueCount;
          if (obj.current >= obj.required) {
            obj.completed = true;
            this.showQuestNotification(`Objective Complete: ${obj.description}`);
          }
          this.emitEvent("objectiveUpdated", { quest, objective: obj });
          this.checkQuestCompletion(quest.id);
        }
      }
    }
    this.updateUI();
  }

  /** Check and update karma_reach objectives based on current karma value */
  public checkKarmaObjectives(currentKarma: number): void {
    for (const quest of this.getActiveQuests()) {
      for (const obj of quest.objectives) {
        if (!obj.completed && obj.type === "karma_reach") {
          const targetKarma = obj.targetValue ?? obj.required;
          obj.current = Math.floor(currentKarma);
          if (currentKarma >= targetKarma) {
            obj.completed = true;
            this.showQuestNotification(`Objective Complete: ${obj.description}`);
            this.emitEvent("objectiveUpdated", { quest, objective: obj });
            this.checkQuestCompletion(quest.id);
          }
        }
      }
    }
    this.updateUI();
  }

  // ── Events ────────────────────────────────────────────────────────────────

  public onEvent(callback: QuestEventCallback): void {
    this.eventCallbacks.push(callback);
  }

  private emitEvent(type: QuestEventType, data: any): void {
    for (const cb of this.eventCallbacks) {
      cb(type, data);
    }
  }

  // ── UI ────────────────────────────────────────────────────────────────────

  private createUI(): void {
    // Quest tracker panel (top-right)
    const tracker = document.createElement("div");
    tracker.id = "quest-tracker";
    tracker.innerHTML = `
      <div class="quest-tracker-header">
        <span class="quest-tracker-title">Quests</span>
        <button id="quest-toggle">−</button>
      </div>
      <div class="quest-tracker-content" id="quest-content"></div>
    `;
    document.body.appendChild(tracker);

    // Chapter title overlay
    const chapterOverlay = document.createElement("div");
    chapterOverlay.id = "chapter-overlay";
    chapterOverlay.className = "hidden";
    document.body.appendChild(chapterOverlay);

    // Quest notification
    const notification = document.createElement("div");
    notification.id = "quest-notification";
    notification.className = "hidden";
    document.body.appendChild(notification);

    // Add styles
    const style = document.createElement("style");
    style.textContent = `
      #quest-tracker {
        position: fixed;
        top: 80px;
        right: 20px;
        width: 280px;
        background: rgba(20, 25, 35, 0.92);
        border: 1px solid rgba(120, 150, 180, 0.4);
        border-radius: 8px;
        color: #e8e8e8;
        font-family: 'Segoe UI', sans-serif;
        font-size: 13px;
        z-index: 100;
        box-shadow: 0 4px 20px rgba(0,0,0,0.4);
      }
      .quest-tracker-header {
        display: flex;
        justify-content: space-between;
        align-items: center;
        padding: 10px 14px;
        background: rgba(40, 60, 90, 0.6);
        border-bottom: 1px solid rgba(120, 150, 180, 0.3);
        border-radius: 8px 8px 0 0;
      }
      .quest-tracker-title {
        font-weight: 600;
        color: #90b8e0;
        text-transform: uppercase;
        letter-spacing: 1px;
      }
      #quest-toggle {
        background: none;
        border: none;
        color: #90b8e0;
        font-size: 18px;
        cursor: pointer;
        padding: 0 5px;
      }
      .quest-tracker-content {
        max-height: 350px;
        overflow-y: auto;
        padding: 10px;
      }
      .quest-item {
        margin-bottom: 12px;
        padding-bottom: 10px;
        border-bottom: 1px solid rgba(100, 130, 160, 0.2);
      }
      .quest-item:last-child { border-bottom: none; }
      .quest-title {
        font-weight: 600;
        color: #d4a84b;
        margin-bottom: 4px;
      }
      .quest-title.main { color: #e8c55a; }
      .quest-title.side { color: #7eb8da; }
      .quest-objective {
        display: flex;
        align-items: center;
        margin: 3px 0 3px 10px;
        font-size: 12px;
        color: #b0b8c0;
      }
      .quest-objective.completed { color: #6a8; text-decoration: line-through; }
      .quest-checkbox {
        width: 12px;
        height: 12px;
        border: 1px solid #6a8a9a;
        border-radius: 2px;
        margin-right: 8px;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .quest-checkbox.checked { background: #4a8060; border-color: #4a8060; }
      .quest-checkbox.checked::after { content: "✓"; color: #fff; font-size: 9px; }
      .quest-progress { color: #8a9aa8; margin-left: auto; }

      #chapter-overlay {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        height: 100%;
        background: rgba(0 0, 0, 0.85);
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        z-index: 1000;
        opacity: 0;
        transition: opacity 0.8s ease;
        pointer-events: none;
      }
      #chapter-overlay.visible { opacity: 1; }
      #chapter-overlay.hidden { display: none; }
      .chapter-number {
        font-size: 18px;
        color: #8a9aa8;
        letter-spacing: 4px;
        text-transform: uppercase;
        margin-bottom: 10px;
      }
      .chapter-title {
        font-size: 48px;
        color: #d4a84b;
        font-weight: 300;
        letter-spacing: 3px;
        text-shadow: 0 0 30px rgba(212, 168, 75, 0.5);
      }
      .chapter-desc {
        font-size: 16px;
        color: #a0a8b0;
        margin-top: 20px;
        max-width: 500px;
        text-align: center;
        line-height: 1.6;
      }

      #quest-notification {
        position: fixed;
        top: 150px;
        left: 50%;
        transform: translateX(-50%);
        background: rgba(30, 40, 55, 0.95);
        border: 1px solid rgba(180, 160, 100, 0.5);
        border-radius: 6px;
        padding: 12px 24px;
        color: #d4a84b;
        font-size: 15px;
        font-weight: 500;
        z-index: 200;
        opacity: 0;
        transition: opacity 0.4s ease;
        pointer-events: none;
      }
      #quest-notification.visible { opacity: 1; }
      #quest-notification.hidden { display: none; }
      #quest-notification.success { border-color: rgba(100, 180, 120, 0.6); color: #7ec090; }
      #quest-notification.chapter { border-color: rgba(200, 180, 100, 0.7); color: #e8c55a; font-size: 18px; }
    `;
    document.head.appendChild(style);

    this._uiElement = tracker;

    // Toggle button
    document.getElementById("quest-toggle")?.addEventListener("click", () => {
      const content = document.getElementById("quest-content");
      const btn = document.getElementById("quest-toggle");
      if (content && btn) {
        content.style.display = content.style.display === "none" ? "block" : "none";
        btn.textContent = content.style.display === "none" ? "+" : "−";
      }
    });

    this.updateUI();

    // Show initial chapter after a delay
    setTimeout(() => this.showChapterTitle(this.chapters[0]), 2000);
  }

  public updateUI(): void {
    const content = document.getElementById("quest-content");
    if (!content) return;

    const activeQuests = this.getActiveQuests();
    if (activeQuests.length === 0) {
      content.innerHTML = `<div style="color: #8a9aa8; padding: 10px; text-align: center;">No active quests</div>`;
      return;
    }

    content.innerHTML = activeQuests.map(quest => `
      <div class="quest-item">
        <div class="quest-title ${quest.type}">${quest.title}</div>
        ${quest.objectives.map(obj => `
          <div class="quest-objective ${obj.completed ? 'completed' : ''}">
            <div class="quest-checkbox ${obj.completed ? 'checked' : ''}"></div>
            <span>${obj.description}</span>
            ${obj.required > 1 ? `<span class="quest-progress">(${obj.current}/${obj.required})</span>` : ''}
          </div>
        `).join('')}
      </div>
    `).join('');
  }

  private showQuestNotification(text: string, type: string = ""): void {
    const el = document.getElementById("quest-notification");
    if (!el) return;

    el.textContent = text;
    el.className = `visible ${type}`;
    setTimeout(() => {
      el.className = "hidden";
    }, 3500);
  }

  private showChapterTitle(chapter: StoryChapter): void {
    const el = document.getElementById("chapter-overlay");
    if (!el) return;

    el.innerHTML = `
      <div class="chapter-number">Chapter ${chapter.number}</div>
      <div class="chapter-title">${chapter.title}</div>
      <div class="chapter-desc">${chapter.description}</div>
    `;
    el.className = "visible";
    setTimeout(() => {
      el.className = "hidden";
    }, 5000);
  }

  // ── Serialization ─────────────────────────────────────────────────────────

  public serialize(): any {
    return {
      quests: Array.from(this.quests.entries()),
      chapters: this.chapters,
      currentChapter: this.currentChapter,
    };
  }

  public deserialize(data: any): void {
    if (data.quests) {
      this.quests = new Map(data.quests);
    }
    if (data.chapters) {
      this.chapters = data.chapters;
    }
    if (data.currentChapter) {
      this.currentChapter = data.currentChapter;
    }
    this.updateUI();
  }
}

export const questManager = new QuestManager();
