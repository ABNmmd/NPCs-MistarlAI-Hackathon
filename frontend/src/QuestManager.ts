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
  giverNpcId?: string | null;     // NPC who gives this quest
  turnInNpcId?: string | null;    // NPC to turn in quest to
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

type QuestEventType = "questStarted" | "questCompleted" | "questFailed" | "objectiveUpdated" | "chapterUnlocked" | "npcSpawnRequested";
type QuestEventCallback = (event: QuestEventType, data: any) => void;

export interface DeferredNpc {
  id: string;
  name: string;
  template: string;
  position: [number, number, number];
  npc_identity: string;
  voice_id?: string;
  triggerQuest: string;
  spawnMessage?: string;
  overrides?: any;
}

export class QuestManager {
  private quests: Map<string, Quest> = new Map();
  private chapters: StoryChapter[] = [];
  private currentChapter: number = 1;
  private eventCallbacks: QuestEventCallback[] = [];
  private _uiElement: HTMLElement | null = null;
  private talkedToNpcs: Set<string> = new Set(); // Track unique NPCs talked to
  private deferredNpcs: DeferredNpc[] = [];
  private spawnedNpcIds: Set<string> = new Set(); // Track which deferred NPCs have spawned

  constructor() {
    this.initializeStory();
    this.createUI();
  }

  // ── Deferred NPC System ───────────────────────────────────────────────────

  public setDeferredNpcs(npcs: DeferredNpc[]): void {
    this.deferredNpcs = npcs;
    console.log(`[QuestManager] ${npcs.length} NPCs registered for deferred spawning`);
  }

  private checkDeferredNpcSpawns(completedQuestId: string): void {
    for (const npc of this.deferredNpcs) {
      if (npc.triggerQuest === completedQuestId && !this.spawnedNpcIds.has(npc.id)) {
        this.spawnedNpcIds.add(npc.id);
        console.log(`[QuestManager] Triggering spawn for NPC: ${npc.name}`);
        
        // Show spawn notification
        if (npc.spawnMessage) {
          this.showQuestNotification(npc.spawnMessage, "info");
        }
        
        // Emit spawn event for Game.ts to handle
        this.emitEvent("npcSpawnRequested", { npc });
      }
    }
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

    // ═══════════════════════════════════════════════════════════════════════════
    // CHAPTER 1: THE AWAKENING - Learning the basics, meeting NPCs
    // ═══════════════════════════════════════════════════════════════════════════
    
    this.registerQuest({
      id: "main_01_awakening",
      title: "Strange New World",
      description: "You've awakened in an unfamiliar land with no memory. Speak with Farmer Tom, the friendly villager nearby.",
      chapter: 1,
      type: "main",
      status: "active",
      giverNpcId: null,
      objectives: [
        { id: "talk_villager", description: "Speak with Farmer Tom", type: "talk", target: "villager", current: 0, required: 1, completed: false },
      ],
      rewards: { karma: 5, unlocks: ["main_02_guard_suspicion"] },
      dialogue: {
        start: "The world feels unfamiliar, yet somehow you sense you were meant to be here...",
        complete: "Farmer Tom welcomes you warmly. He mentions the Guard Captain has been watching you.",
      },
    });

    this.registerQuest({
      id: "main_02_guard_suspicion",
      title: "Under Suspicion",
      description: "The Guard Captain is suspicious of strangers. Prove you mean no harm.",
      chapter: 1,
      type: "main",
      status: "locked",
      prerequisites: ["main_01_awakening"],
      giverNpcId: "npc_guard_01",
      objectives: [
        { id: "talk_guard", description: "Speak with the Guard Captain", type: "talk", target: "guard", current: 0, required: 1, completed: false },
      ],
      rewards: { karma: 5, unlocks: ["main_03_merchant_secrets", "side_guard_patrol"] },
      dialogue: {
        start: "A stranger appears from nowhere? I don't believe in coincidences...",
        progress: "I'm watching you, stranger.",
        complete: "You seem harmless enough. But stay out of trouble. The merchant may know more about recent... arrivals.",
      },
    });

    this.registerQuest({
      id: "main_03_merchant_secrets",
      title: "The Merchant's Secret",
      description: "The Traveling Merchant knows something about your arrival. Seek them out.",
      chapter: 1,
      type: "main",
      status: "locked",
      prerequisites: ["main_02_guard_suspicion"],
      giverNpcId: "npc_merchant_01",
      objectives: [
        { id: "find_merchant", description: "Find and speak with the Merchant", type: "talk", target: "merchant", current: 0, required: 1, completed: false },
      ],
      rewards: { karma: 10, unlocks: ["main_04_shadow_warning"] },
      dialogue: {
        start: "Ah yes, the one who appeared from thin air! The spirits guided you here...",
        complete: "The Merchant speaks of a 'Shadow' that has been corrupting the land. You must find the Healer to learn more.",
      },
    });

    this.registerQuest({
      id: "main_04_shadow_warning",
      title: "The Healer's Vision",
      description: "The Healer has foreseen your arrival. She holds vital information about the Shadow.",
      chapter: 1,
      type: "main",
      status: "locked",
      prerequisites: ["main_03_merchant_secrets"],
      objectives: [
        { id: "talk_healer", description: "Consult with a Healer", type: "talk", target: "healer", current: 0, required: 1, completed: false },
      ],
      rewards: { karma: 15, unlocks: ["chapter_2"] },
      dialogue: {
        start: "I have seen you in my visions, child. The Shadow grows stronger...",
        complete: "The Healer reveals a dark truth: The Shadow is corrupting NPCs, turning them against each other. Chapter 1 Complete!",
      },
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // CHAPTER 2: GATHERING ALLIES - Building trust, uncovering the threat
    // ═══════════════════════════════════════════════════════════════════════════

    this.registerQuest({
      id: "main_05_earn_trust",
      title: "Proving Your Worth",
      description: "To face the Shadow, you must first earn the trust of the realm's inhabitants.",
      chapter: 2,
      type: "main",
      status: "locked",
      prerequisites: ["chapter_2"],
      objectives: [
        { id: "build_karma", description: "Build your reputation (reach 25 karma)", type: "karma_reach", targetValue: 25, current: 0, required: 25, completed: false },
        { id: "talk_many", description: "Befriend the 5 other NPCs", type: "talk_unique", current: 0, required: 5, completed: false },
      ],
      rewards: { karma: 10, unlocks: ["main_06_blacksmith_weapon"] },
      dialogue: {
        start: "The people are wary. You must prove yourself through actions, not words.",
        complete: "Word of your deeds spreads. The Blacksmith wishes to speak with you.",
      },
    });

    this.registerQuest({
      id: "main_06_blacksmith_weapon",
      title: "The Shadowbane",
      description: "The Blacksmith offers to forge a weapon that can harm the Shadow.",
      chapter: 2,
      type: "main",
      status: "locked",
      prerequisites: ["main_05_earn_trust"],
      giverNpcId: "npc_blacksmith_01",
      objectives: [
        { id: "talk_smith", description: "Speak with the Blacksmith", type: "talk", target: "blacksmith", current: 0, required: 1, completed: false },
      ],
      rewards: { karma: 15, unlocks: ["main_07_corrupted_wanderer"] },
      dialogue: {
        start: "I've heard of your deeds. I can forge something special, but I need a favor...",
        complete: "The Blacksmith agrees to help. But there are rumors of a Wanderer behaving strangely near the forest.",
      },
    });

    this.registerQuest({
      id: "main_07_corrupted_wanderer",
      title: "The Corrupted One",
      description: "A Wanderer has been touched by the Shadow. Find them and try to help.",
      chapter: 2,
      type: "main",
      status: "locked",
      prerequisites: ["main_06_blacksmith_weapon"],
      objectives: [
        { id: "find_wanderer", description: "Find the corrupted Wanderer", type: "talk", target: "wanderer", current: 0, required: 1, completed: false },
      ],
      rewards: { karma: 20, unlocks: ["chapter_3"] },
      dialogue: {
        start: "Something is wrong with that wanderer. Their eyes... they're not right.",
        complete: "You reach the Wanderer, but the Shadow's influence is strong. The Healer may know how to cleanse them. Chapter 2 Complete!",
      },
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // CHAPTER 3: THE SHADOW RISES - Confronting darkness, making choices
    // ═══════════════════════════════════════════════════════════════════════════

    this.registerQuest({
      id: "main_08_cleansing_ritual",
      title: "The Cleansing",
      description: "The Healer knows a ritual to cleanse the Shadow's corruption.",
      chapter: 3,
      type: "main",
      status: "locked",
      prerequisites: ["chapter_3"],
      objectives: [
        { id: "healer_ritual", description: "Learn the ritual from the Healer", type: "talk", target: "healer", current: 0, required: 1, completed: false },
        { id: "gather_karma", description: "Gather enough light (reach 50 karma)", type: "karma_reach", targetValue: 50, current: 0, required: 50, completed: false },
      ],
      rewards: { karma: 20, unlocks: ["main_09_shadow_source"] },
      dialogue: {
        start: "The ritual requires pure intentions. Your karma must shine bright to drive back the darkness.",
        complete: "With the ritual prepared, the Healer senses the Shadow's source nearby.",
      },
    });

    this.registerQuest({
      id: "main_09_shadow_source",
      title: "Heart of Darkness",
      description: "The Shadow's source must be found and confronted.",
      chapter: 3,
      type: "main",
      status: "locked",
      prerequisites: ["main_08_cleansing_ritual"],
      objectives: [
        { id: "rally_allies", description: "Rally your allies (talk to all 6 NPCs)", type: "talk_unique", current: 0, required: 6, completed: false },
        { id: "high_karma", description: "Become a beacon of hope (reach 75 karma)", type: "karma_reach", targetValue: 75, current: 0, required: 75, completed: false },
      ],
      rewards: { karma: 30, unlocks: ["chapter_4"] },
      dialogue: {
        start: "The Shadow knows you're coming. Gather your allies for the final confrontation.",
        complete: "The realm stands united behind you. The final battle approaches. Chapter 3 Complete!",
      },
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // CHAPTER 4: THE FINAL STAND - Resolution
    // ═══════════════════════════════════════════════════════════════════════════

    this.registerQuest({
      id: "main_10_final_stand",
      title: "The Final Stand",
      description: "With allies gathered and the ritual prepared, face the Shadow once and for all.",
      chapter: 4,
      type: "main",
      status: "locked",
      prerequisites: ["chapter_4"],
      objectives: [
        { id: "max_karma", description: "Achieve legendary status (reach 100 karma)", type: "karma_reach", targetValue: 100, current: 0, required: 100, completed: false },
        { id: "all_allies", description: "Ensure all allies are ready (talk to all 6 NPCs)", type: "talk_unique", current: 0, required: 6, completed: false },
      ],
      rewards: { karma: 50, unlocks: ["ending_hero"] },
      dialogue: {
        start: "This is it. Everything has led to this moment.",
        complete: "The Shadow is vanquished! Light returns to the realm. YOU ARE THE HERO! THE END.",
      },
    });

    // ═══════════════════════════════════════════════════════════════════════════
    // SIDE QUESTS - Optional content, NPC stories
    // ═══════════════════════════════════════════════════════════════════════════

    this.registerQuest({
      id: "side_guard_patrol",
      title: "Patrol Duty",
      description: "Help the Guard Captain secure the perimeter.",
      type: "side",
      status: "locked",
      prerequisites: ["main_02_guard_suspicion"],
      giverNpcId: "npc_guard_01",
      objectives: [
        { id: "talk_guard_again", description: "Report to the Guard Captain", type: "talk", target: "guard", current: 0, required: 1, completed: false },
      ],
      rewards: { karma: 8 },
      dialogue: {
        start: "If you want to prove yourself, help me keep watch.",
        complete: "Impressive. Perhaps I misjudged you, stranger.",
      },
    });

    this.registerQuest({
      id: "side_merchant_trade",
      title: "Fair Trade",
      description: "The Merchant needs help with a stubborn customer.",
      type: "side",
      status: "available",
      giverNpcId: "npc_merchant_01",
      objectives: [
        { id: "help_merchant", description: "Help the Merchant", type: "talk", target: "merchant", current: 0, required: 2, completed: false },
      ],
      rewards: { karma: 5 },
      dialogue: {
        start: "Ah, a helpful face! Can you assist with a small matter?",
        complete: "You have the charm of a true trader! Here's something for your trouble.",
      },
    });

    this.registerQuest({
      id: "side_wanderer_tales",
      title: "Tales of the Road",
      description: "A wanderer has fascinating stories to share.",
      type: "side",
      status: "available",
      objectives: [
        { id: "listen_stories", description: "Listen to wanderer stories", type: "talk", target: "wanderer", current: 0, required: 2, completed: false },
      ],
      rewards: { karma: 5 },
      dialogue: {
        start: "Sit by the fire, friend. Let me tell you of the lands beyond...",
        complete: "The wanderer's tales have opened your mind to the wider world.",
      },
    });

    this.registerQuest({
      id: "side_healer_herbs",
      title: "Herbal Remedies",
      description: "The Healer's supplies are running low. Help gather what's needed.",
      type: "side",
      status: "available",
      objectives: [
        { id: "talk_healer_herbs", description: "Speak with a Healer about herbs", type: "talk", target: "healer", current: 0, required: 1, completed: false },
      ],
      rewards: { karma: 7 },
      dialogue: {
        start: "My remedies grow scarce. If you could help...",
        complete: "Bless you, child. These herbs will save many lives.",
      },
    });

    this.registerQuest({
      id: "side_blacksmith_apprentice",
      title: "The Apprentice's Trial",
      description: "The Blacksmith seeks someone to test their apprentice's work.",
      type: "side",
      status: "available",
      objectives: [
        { id: "test_weapons", description: "Speak with the Blacksmith", type: "talk", target: "blacksmith", current: 0, required: 1, completed: false },
      ],
      rewards: { karma: 6 },
      dialogue: {
        start: "My apprentice thinks they're ready. Would you test their blade?",
        complete: "The weapon holds! You've helped inspire a young smith.",
      },
    });

    this.registerQuest({
      id: "side_villager_rumors",
      title: "Village Gossip",
      description: "The village is buzzing with rumors. Listen to what Farmer Tom has to say.",
      type: "side",
      status: "available",
      objectives: [
        { id: "hear_rumors", description: "Listen to Farmer Tom's tales", type: "talk", target: "villager", current: 0, required: 1, completed: false },
      ],
      rewards: { karma: 5 },
      dialogue: {
        start: "Have you heard? Strange things are happening...",
        complete: "The rumors paint a troubling picture, but knowledge is power.",
      },
    });

    this.registerQuest({
      id: "side_social_butterfly",
      title: "Friend to All",
      description: "Become known throughout the realm by meeting everyone.",
      type: "side",
      status: "available",
      objectives: [
        { id: "meet_all", description: "Meet all 6 NPCs", type: "talk_unique", current: 0, required: 6, completed: false },
      ],
      rewards: { karma: 20 },
      dialogue: {
        start: "A true hero knows everyone in the realm...",
        complete: "Your name is known in every corner of the land!",
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
    
    // Track quests to auto-start after unlocking
    const questsToAutoStart: string[] = [];
    
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
            // Auto-start main quests immediately, make side quests available
            if (unlockQuest.type === "main") {
              unlockQuest.status = "active";
              questsToAutoStart.push(unlockId);
            } else {
              unlockQuest.status = "available";
            }
            this.showQuestNotification(`New Quest: ${unlockQuest.title}`);
          }
        }
      }
    }

    this.emitEvent("questCompleted", { quest });
    
    // Emit questStarted for auto-started quests
    for (const qId of questsToAutoStart) {
      const q = this.quests.get(qId);
      if (q) this.emitEvent("questStarted", { quest: q });
    }
    
    this.updateUI();
    this.showQuestNotification(`Quest Complete: ${quest.title}`, "success");
    
    // Check if this quest completion should spawn any deferred NPCs
    this.checkDeferredNpcSpawns(questId);
    
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
      
      // Unlock and auto-start main quests that have this chapter as a prerequisite
      const chapterKey = `chapter_${chapterNum}`;
      for (const quest of this.quests.values()) {
        if (quest.status === "locked" && quest.prerequisites?.includes(chapterKey)) {
          // Auto-start main quests, make side quests available
          if (quest.type === "main") {
            quest.status = "active";
            this.showQuestNotification(`New Quest: ${quest.title}`);
            this.emitEvent("questStarted", { quest });
          } else {
            quest.status = "available";
            this.showQuestNotification(`New Side Quest: ${quest.title}`);
          }
        }
      }
      this.updateUI();
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

    // Check if this NPC has an available quest to give - START IT FIRST
    for (const quest of this.getAvailableQuests()) {
      if (quest.giverNpcId === npcId || quest.objectives.some(o => o.target === npcTemplate && o.type === "talk")) {
        result.questDialogue = quest.dialogue?.start;
        this.startQuest(quest.id);
        result.questStarted = quest.id;
        break;
      }
    }

    // THEN check if talking to this NPC completes any objectives (including just-started quest)
    console.log(`[QuestManager] Completing objectives for target: "${npcTemplate}"`);
    this.completeObjectiveByTarget(npcTemplate);
    this.completeObjectiveByTarget("any"); // For objectives targeting any NPC

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

  // ── NPC Quest Indicators ──────────────────────────────────────────────────

  /**
   * Get quest indicators for all NPCs based on current quest states.
   * Returns a map of NPC ID -> indicator type (available, progress, complete, or null)
   */
  public getQuestIndicators(): Map<string, "available" | "progress" | "complete" | null> {
    const indicators = new Map<string, "available" | "progress" | "complete" | null>();
    
    // Check all quests
    for (const quest of this.quests.values()) {
      const giverNpcId = quest.giverNpcId;
      if (!giverNpcId) continue;
      
      if (quest.status === "available") {
        // Quest is available to pick up
        indicators.set(giverNpcId, "available");
      } else if (quest.status === "active") {
        // Quest is in progress - check if objectives are for this NPC
        const existingIndicator = indicators.get(giverNpcId);
        if (existingIndicator !== "available") {
          // Check if any objectives target this NPC's template for turn-in
          const turnInComplete = quest.objectives.every(o => o.completed || o.optional);
          if (turnInComplete && quest.turnInNpcId === giverNpcId) {
            indicators.set(giverNpcId, "complete");
          } else if (!indicators.has(giverNpcId)) {
            indicators.set(giverNpcId, "progress");
          }
        }
      }
    }
    
    return indicators;
  }

  /**
   * Get the next main quest to display as a hint
   */
  public getActiveMainQuest(): Quest | null {
    return this.getMainQuests().find(q => q.status === "active") ?? null;
  }

  /**
   * Get current chapter info
   */
  public getCurrentChapter(): StoryChapter | null {
    return this.chapters.find(c => c.number === this.currentChapter) ?? null;
  }
}

export const questManager = new QuestManager();
