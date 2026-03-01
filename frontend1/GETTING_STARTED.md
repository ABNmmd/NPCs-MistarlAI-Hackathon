# Getting Started

## Prerequisites

| Tool | Version | Download |
|------|---------|----------|
| **Node.js** | 18 or later | https://nodejs.org |
| **npm** | bundled with Node | — |

---

## 1 — Install dependencies

Open a terminal in this folder (`frontend1/`) and run:

```bash
npm install
```

This installs all dependencies into `node_modules/`, including:

- **`@babylonjs/core`** — 3-D engine (scene, meshes, physics, animations)
- **`@babylonjs/loaders`** — GLB / glTF model loader
- **`@babylonjs/gui`** — in-engine GUI toolkit
- **`vite`** — dev server and bundler
- **`typescript`** — type-checking

---

## 2 — Start the dev server

```bash
npm run dev
```

Vite will print something like:

```
  VITE v7.x.x  ready in 300 ms

  ➜  Local:   http://localhost:5173/
```

Open that URL in your browser.

---

## 3 — Play

| Action | Key / Input |
|--------|-------------|
| Click the canvas | Activates mouse-look (pointer lock) |
| Move | **W A S D** or Arrow Keys |
| Sprint | Hold **Shift** while moving |
| Jump | **Space** |
| Talk to an NPC | Walk close → press **E** |
| Close chat | **Escape** or the ✕ button |
| Zoom camera | Mouse **scroll wheel** |

---

## 4 — Build for production (optional)

```bash
npm run build
```

Output goes to `dist/`. Serve it with any static host, or preview locally:

```bash
npm run preview
```

---

## Project layout

```
frontend1/
├── public/
│   ├── npc_config.json   ← NPC AI dialogue settings
│   ├── npcs.json         ← NPC instances, templates, behaviors
│   ├── player.json       ← Player movement, camera, stats
│   ├── world.json        ← Terrain, lighting, fog, spawn points
│   └── assets/           ← 3-D models (GLB) and textures
├── src/
│   ├── main.ts           ← Entry point
│   ├── Game.ts           ← Orchestrates all systems
│   ├── Environment.ts    ← Terrain, lighting, fog
│   ├── CityBuilder.ts    ← Procedural city / roads
│   ├── PlayerController.ts
│   ├── NPCController.ts
│   ├── AIService.ts      ← LLM API calls & conversation history
│   ├── ChatUI.ts         ← In-game chat overlay
│   └── AssetLoader.ts    ← GLB model loader
├── index.html
└── package.json
```

---

## Troubleshooting

**"Cannot find module" errors on `npm run dev`**
→ Make sure you ran `npm install` first.

**Blank / black screen**
→ Open the browser console (F12) for errors. Most commonly a missing GLB asset under `public/assets/models/`.

**Pointer lock not working**
→ Click directly on the game canvas. Some browsers require the page to be served over HTTP/HTTPS (not `file://`) — use `npm run dev`.
