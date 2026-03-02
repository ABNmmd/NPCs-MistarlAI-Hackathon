/**
 * AIBridge - The integration layer between the game and any AI orchestrator system.
 * Exposes a clean JSON-based command API and event system.
 * 
 * AI systems interact with the game by:
 * 1. Sending JSON commands via executeCommand()
 * 2. Subscribing to game events via onEvent()
 * 3. Querying world state via getWorldState()
 * 
 * This bridge is exposed globally as window.GameAI for easy access.
 */
export class AIBridge {
    constructor(gameEngine) {
        this.engine = gameEngine;
        this._eventCallbacks = [];
        this._commandLog = [];
        this._maxLogSize = 200;
    }

    /** Initialize and expose the global API */
    initialize() {
        // Expose global API for AI integration
        window.GameAI = {
            // Core command execution
            executeCommand: (cmd) => this.executeCommand(cmd),
            executeBatch: (cmds) => this.executeBatch(cmds),

            // World state
            getWorldState: () => this.getWorldState(),
            getPlayerInfo: () => this.getPlayerInfo(),
            getNPCInfo: (id) => this.getNPCInfo(id),
            getAllNPCs: () => this.getAllNPCs(),
            getConfigs: () => this.getConfigs(),

            // NPC convenience methods
            spawnNPC: (config) => this.executeCommand({ command: 'spawnNPC', params: config }),
            removeNPC: (id) => this.executeCommand({ command: 'removeNPC', params: { id } }),
            moveNPC: (id, position, speed) => this.executeCommand({ command: 'moveNPC', params: { id, position, speed } }),
            npcSay: (id, message) => this.executeCommand({ command: 'npcSay', params: { id, message } }),
            updateNPCBehavior: (id, behavior) => this.executeCommand({ command: 'updateNPCBehavior', params: { id, behavior } }),
            updateNPCDialogue: (id, dialogue) => this.executeCommand({ command: 'updateNPCDialogue', params: { id, dialogue } }),
            setNPCFollow: (id, targetId, distance) => this.executeCommand({ command: 'setNPCFollow', params: { id, targetId, distance } }),

            // World convenience methods
            spawnObject: (config) => this.executeCommand({ command: 'spawnObject', params: config }),
            removeObject: (id) => this.executeCommand({ command: 'removeObject', params: { id } }),
            updateWorld: (config) => this.executeCommand({ command: 'updateWorld', params: config }),

            // Player convenience methods
            teleportPlayer: (position) => this.executeCommand({ command: 'teleportPlayer', params: { position } }),
            updatePlayerStats: (stats) => this.executeCommand({ command: 'updatePlayerStats', params: { stats } }),

            // Template management
            registerNPCTemplate: (name, template) => this.executeCommand({ command: 'registerNPCTemplate', params: { name, template } }),

            // Events
            onEvent: (callback) => this.onEvent(callback),

            // Command log
            getCommandLog: () => [...this._commandLog],

            // Help
            help: () => this._getHelp()
        };

        // Bridge NPC events to AI
        this.engine.npcManager.onEvent((event, data) => {
            this._emitEvent(event, data);
        });

        console.log('[AIBridge] Initialized. Access via window.GameAI');
    }

    /**
     * Execute a single JSON command.
     * @param {Object} cmd - { command: string, params: Object }
     * @returns {Object} - { success: boolean, result?: any, error?: string }
     */
    executeCommand(cmd) {
        const timestamp = Date.now();
        let result;

        try {
            switch (cmd.command) {
                case 'spawnNPC':
                    result = this._cmdSpawnNPC(cmd.params);
                    break;
                case 'removeNPC':
                    result = this._cmdRemoveNPC(cmd.params);
                    break;
                case 'moveNPC':
                    result = this._cmdMoveNPC(cmd.params);
                    break;
                case 'npcSay':
                    result = this._cmdNPCSay(cmd.params);
                    break;
                case 'updateNPCBehavior':
                    result = this._cmdUpdateNPCBehavior(cmd.params);
                    break;
                case 'updateNPCDialogue':
                    result = this._cmdUpdateNPCDialogue(cmd.params);
                    break;
                case 'setNPCFollow':
                    result = this._cmdSetNPCFollow(cmd.params);
                    break;
                case 'registerNPCTemplate':
                    result = this._cmdRegisterTemplate(cmd.params);
                    break;
                case 'spawnObject':
                    result = this._cmdSpawnObject(cmd.params);
                    break;
                case 'removeObject':
                    result = this._cmdRemoveObject(cmd.params);
                    break;
                case 'updateWorld':
                    result = this._cmdUpdateWorld(cmd.params);
                    break;
                case 'teleportPlayer':
                    result = this._cmdTeleportPlayer(cmd.params);
                    break;
                case 'updatePlayerStats':
                    result = this._cmdUpdatePlayerStats(cmd.params);
                    break;
                case 'getWorldState':
                    result = { success: true, result: this.getWorldState() };
                    break;
                default:
                    result = { success: false, error: `Unknown command: ${cmd.command}` };
            }
        } catch (e) {
            result = { success: false, error: e.message };
        }

        // Log command
        this._commandLog.push({ timestamp, command: cmd, result });
        if (this._commandLog.length > this._maxLogSize) {
            this._commandLog.shift();
        }

        return result;
    }

    /**
     * Execute multiple commands in sequence.
     * @param {Array} commands - Array of command objects
     * @returns {Array} Array of results
     */
    executeBatch(commands) {
        return commands.map(cmd => this.executeCommand(cmd));
    }

    /** Get full world state as JSON-serializable object */
    getWorldState() {
        return {
            timestamp: Date.now(),
            world: {
                id: this.engine.configManager.get('world').id,
                name: this.engine.configManager.get('world').name,
                objects: this.engine.worldManager.serializeObjects()
            },
            player: this.getPlayerInfo(),
            npcs: this.getAllNPCs(),
            configs: {
                world: this.engine.configManager.get('world'),
                player: this.engine.configManager.get('player'),
                npcs: this.engine.configManager.get('npcs')
            }
        };
    }

    /** Get player info */
    getPlayerInfo() {
        return this.engine.playerController.serialize();
    }

    /** Get single NPC info */
    getNPCInfo(id) {
        return this.engine.npcManager.serializeNPC(id);
    }

    /** Get all NPCs */
    getAllNPCs() {
        return this.engine.npcManager.serializeAll();
    }

    /** Get configs snapshot */
    getConfigs() {
        return this.engine.configManager.snapshot();
    }

    /** Subscribe to game events (returns unsubscribe function) */
    onEvent(callback) {
        this._eventCallbacks.push(callback);
        return () => {
            this._eventCallbacks = this._eventCallbacks.filter(cb => cb !== callback);
        };
    }

    // -------- Command Implementations --------

    _cmdSpawnNPC(params) {
        const npc = this.engine.npcManager.spawnNPC(params);
        if (npc) {
            return { success: true, result: { id: npc.id, name: npc.name } };
        }
        return { success: false, error: 'Failed to spawn NPC' };
    }

    _cmdRemoveNPC(params) {
        const removed = this.engine.npcManager.removeNPC(params.id);
        return { success: removed, error: removed ? undefined : `NPC '${params.id}' not found` };
    }

    _cmdMoveNPC(params) {
        const moved = this.engine.npcManager.moveNPCTo(params.id, params.position, params.speed);
        return { success: moved, error: moved ? undefined : `NPC '${params.id}' not found` };
    }

    _cmdNPCSay(params) {
        const result = this.engine.npcManager.npcSay(params.id, params.message);
        return { success: result, error: result ? undefined : `NPC '${params.id}' not found` };
    }

    _cmdUpdateNPCBehavior(params) {
        const result = this.engine.npcManager.updateNPCBehavior(params.id, params.behavior);
        return { success: result, error: result ? undefined : `NPC '${params.id}' not found` };
    }

    _cmdUpdateNPCDialogue(params) {
        const result = this.engine.npcManager.updateNPCDialogue(params.id, params.dialogue);
        return { success: result, error: result ? undefined : `NPC '${params.id}' not found` };
    }

    _cmdSetNPCFollow(params) {
        let target = params.targetId;
        if (params.targetId === 'player') {
            target = this.engine.playerController.getMesh();
        }
        const result = this.engine.npcManager.setNPCFollow(params.id, target, params.distance);
        return { success: result, error: result ? undefined : `NPC '${params.id}' not found` };
    }

    _cmdRegisterTemplate(params) {
        this.engine.npcManager.registerTemplate(params.name, params.template);
        return { success: true };
    }

    _cmdSpawnObject(params) {
        const mesh = this.engine.worldManager.addObject(params);
        return { success: !!mesh, error: mesh ? undefined : 'Failed to create object' };
    }

    _cmdRemoveObject(params) {
        const removed = this.engine.worldManager.removeObject(params.id);
        return { success: removed, error: removed ? undefined : `Object '${params.id}' not found` };
    }

    _cmdUpdateWorld(params) {
        this.engine.worldManager.updateWorld(params);
        return { success: true };
    }

    _cmdTeleportPlayer(params) {
        this.engine.playerController.teleport(params.position);
        return { success: true };
    }

    _cmdUpdatePlayerStats(params) {
        this.engine.playerController.updateStats(params.stats);
        return { success: true };
    }

    // -------- Events --------

    _emitEvent(event, data) {
        const payload = { event, data, timestamp: Date.now() };
        for (const cb of this._eventCallbacks) {
            try { cb(payload); } catch (e) { console.error('[AIBridge] Event callback error:', e); }
        }
    }

    /** Emit player-related events (called from game engine) */
    emitPlayerEvent(event, data) {
        this._emitEvent(event, data);
    }

    // -------- Help --------

    _getHelp() {
        return {
            commands: [
                { command: 'spawnNPC', params: '{ id?, name, template?, position: [x,y,z], overrides?, appearance?, behavior?, dialogue? }' },
                { command: 'removeNPC', params: '{ id }' },
                { command: 'moveNPC', params: '{ id, position: [x,y,z], speed? }' },
                { command: 'npcSay', params: '{ id, message }' },
                { command: 'updateNPCBehavior', params: '{ id, behavior: { type, ...params } }' },
                { command: 'updateNPCDialogue', params: '{ id, dialogue: { greeting?, idle?: [] } }' },
                { command: 'setNPCFollow', params: '{ id, targetId: "player"|npcId, distance? }' },
                { command: 'registerNPCTemplate', params: '{ name, template: {...} }' },
                { command: 'spawnObject', params: '{ id, type: "tree"|"rock"|"building"|"box"|"sphere"|"cylinder"|"cone", position: [x,y,z], scale?, material? }' },
                { command: 'removeObject', params: '{ id }' },
                { command: 'updateWorld', params: '{ lighting?, fog?, sky? }' },
                { command: 'teleportPlayer', params: '{ position: [x,y,z] }' },
                { command: 'updatePlayerStats', params: '{ stats: { health?, stamina?, ... } }' },
                { command: 'getWorldState', params: '{}' }
            ],
            convenienceMethods: [
                'GameAI.spawnNPC(config)',
                'GameAI.removeNPC(id)',
                'GameAI.moveNPC(id, [x,y,z], speed)',
                'GameAI.npcSay(id, message)',
                'GameAI.updateNPCBehavior(id, behaviorConfig)',
                'GameAI.setNPCFollow(id, targetId, distance)',
                'GameAI.spawnObject(config)',
                'GameAI.removeObject(id)',
                'GameAI.updateWorld(config)',
                'GameAI.teleportPlayer([x,y,z])',
                'GameAI.getWorldState()',
                'GameAI.getPlayerInfo()',
                'GameAI.getNPCInfo(id)',
                'GameAI.getAllNPCs()',
                'GameAI.onEvent(callback)',
                'GameAI.getCommandLog()'
            ],
            behaviorTypes: ['idle', 'wander', 'patrol', 'follow', 'moveTo'],
            objectTypes: ['tree', 'rock', 'building', 'box', 'sphere', 'cylinder', 'cone']
        };
    }
}
