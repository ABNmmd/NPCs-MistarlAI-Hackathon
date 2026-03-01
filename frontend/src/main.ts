import { Game } from "./Game";

const game = new Game("renderCanvas");
game.start().catch((err) => {
  console.error("Failed to start game:", err);
});

