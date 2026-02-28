import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
from .routes.npc import router as npc_router
from .routes.world import router as world_router

load_dotenv()

app = FastAPI(
    title="Game Backend API",
    description="NPC Brain Agent and Orchestrator",
    version="1.0.0",
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(npc_router)
app.include_router(world_router)


@app.get("/")
async def root():
    return {
        "service": "Game Backend API",
        "endpoints": {
            "npc": "/api/npc",
            "world_orchestrate": "/api/world/orchestrate",
            "world_tick": "/api/world/tick",
            "docs": "/docs",
            "npc_health": "/api/npc/health",
            "world_health": "/api/world/health",
        },
    }


if __name__ == "__main__":
    import uvicorn
    port = int(os.getenv("PORT", 8000))
    uvicorn.run(app, host="127.0.0.1", port=port)
