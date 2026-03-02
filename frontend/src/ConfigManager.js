/**
 * ConfigManager - Loads, merges, and provides access to all JSON configurations.
 * Central config store for the entire game.
 */
export class ConfigManager {
    constructor() {
        this.configs = {
            world: null,
            player: null,
            npcs: null
        };
        this._listeners = [];
    }

    /** Load all config files from the configs/ directory */
    async loadAll(basePath = 'configs') {
        const [world, player, npcs] = await Promise.all([
            this._fetchJSON(`${basePath}/world.json`),
            this._fetchJSON(`${basePath}/player.json`),
            this._fetchJSON(`${basePath}/npcs.json`)
        ]);
        this.configs.world = world;
        this.configs.player = player;
        this.configs.npcs = npcs;
        console.log('[ConfigManager] All configs loaded.');
        return this.configs;
    }

    /** Load configs from JS objects instead of files (for AI injection) */
    loadFromObjects({ world, player, npcs }) {
        if (world) this.configs.world = world;
        if (player) this.configs.player = player;
        if (npcs) this.configs.npcs = npcs;
        this._notify('configsLoaded', this.configs);
    }

    /** Get a config section */
    get(section) {
        return this.configs[section];
    }

    /** Deep merge update into a config section */
    update(section, patch) {
        if (!this.configs[section]) {
            this.configs[section] = patch;
        } else {
            this.configs[section] = this._deepMerge(this.configs[section], patch);
        }
        this._notify('configUpdated', { section, config: this.configs[section] });
        return this.configs[section];
    }

    /** Get a snapshot of all configs (for serialization / AI state) */
    snapshot() {
        return JSON.parse(JSON.stringify(this.configs));
    }

    /** Subscribe to config changes */
    onChange(callback) {
        this._listeners.push(callback);
        return () => {
            this._listeners = this._listeners.filter(cb => cb !== callback);
        };
    }

    // -- Internal --

    async _fetchJSON(url) {
        const response = await fetch(url);
        if (!response.ok) throw new Error(`Failed to load config: ${url}`);
        return response.json();
    }

    _deepMerge(target, source) {
        const result = { ...target };
        for (const key of Object.keys(source)) {
            if (
                source[key] &&
                typeof source[key] === 'object' &&
                !Array.isArray(source[key]) &&
                target[key] &&
                typeof target[key] === 'object' &&
                !Array.isArray(target[key])
            ) {
                result[key] = this._deepMerge(target[key], source[key]);
            } else {
                result[key] = source[key];
            }
        }
        return result;
    }

    _notify(event, data) {
        for (const cb of this._listeners) {
            try { cb(event, data); } catch (e) { console.error('[ConfigManager] Listener error:', e); }
        }
    }
}
