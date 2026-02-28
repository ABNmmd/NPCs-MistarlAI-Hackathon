"""
CLI script to test the World Orchestrator interactively.

Usage (run from the project root):
    python -m backend.world_orchestrator.cli_test                  # run all scenarios
    python -m backend.world_orchestrator.cli_test --scenario hero  # run a single scenario
    python -m backend.world_orchestrator.cli_test --custom         # enter custom values
"""

import argparse
import asyncio
import json
import sys
import os

# Add project root to path so we can import the backend package
_project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
sys.path.insert(0, _project_root)

from backend.world_orchestrator import call_orchestrator  # noqa: E402

# ──────────────────────────────────────────────
# Pre-built scenarios
# ──────────────────────────────────────────────

SCENARIOS = {
    "hero": {
        "label": "HERO (karma +85, peaceful noon)",
        "world_state": {
            "player_karma": 85,
            "active_npcs": [
                {"id": "npc_001", "type": "civilian", "location": "downtown", "mood": "friendly"},
                {"id": "npc_002", "type": "street_vendor", "location": "market", "mood": "neutral"},
            ],
            "weather": "clear",
            "time_of_day": "noon",
            "tension_level": 2,
            "active_events": [],
            "recent_player_actions": ["rescued_hostage", "stopped_robbery", "helped_civilian"],
        },
        "recent_events": ["hostage_rescued_at_bank", "robbery_prevented"],
    },
    "villain": {
        "label": "VILLAIN (karma -90, midnight chaos)",
        "world_state": {
            "player_karma": -90,
            "active_npcs": [
                {"id": "npc_010", "type": "gang_member", "location": "harbor", "mood": "aggressive"},
                {"id": "npc_011", "type": "civilian", "location": "downtown", "mood": "panicked"},
                {"id": "npc_012", "type": "police_officer", "location": "precinct", "mood": "neutral"},
            ],
            "weather": "heavy_rain",
            "time_of_day": "midnight",
            "tension_level": 8,
            "active_events": ["car_chase"],
            "recent_player_actions": ["attacked_civilian", "destroyed_property", "evaded_police"],
        },
        "recent_events": ["civilian_attacked_downtown", "storefront_destroyed", "police_evaded"],
    },
    "neutral": {
        "label": "NEUTRAL (karma 0, quiet dawn)",
        "world_state": {
            "player_karma": 0,
            "active_npcs": [
                {"id": "npc_020", "type": "civilian", "location": "park", "mood": "neutral"},
            ],
            "weather": "cloudy",
            "time_of_day": "dawn",
            "tension_level": 3,
            "active_events": [],
            "recent_player_actions": ["walked_around", "bought_coffee"],
        },
        "recent_events": [],
    },
    "good_npcs": {
        "label": "GOOD + NPCs (karma +55, marketplace afternoon)",
        "world_state": {
            "player_karma": 55,
            "active_npcs": [
                {"id": "npc_030", "type": "street_vendor", "location": "marketplace", "mood": "neutral"},
                {"id": "npc_031", "type": "civilian", "location": "marketplace", "mood": "neutral"},
                {"id": "npc_032", "type": "civilian", "location": "park", "mood": "friendly"},
            ],
            "weather": "cloudy",
            "time_of_day": "afternoon",
            "tension_level": 3,
            "active_events": [],
            "recent_player_actions": ["helped_lost_child", "bought_supplies", "gave_coin_to_beggar"],
            "location": "marketplace",
        },
        "recent_events": [
            {"source": "player", "action": "helped a lost child find their parent", "time": 0},
            {"source": "player", "action": "gave a coin to a beggar", "time": 1},
        ],
    },
}

# ──────────────────────────────────────────────
# Display helpers
# ──────────────────────────────────────────────

SEPARATOR = "=" * 60


def print_header(text: str):
    print(f"\n{SEPARATOR}")
    print(f"  {text}")
    print(SEPARATOR)


def print_world_state(ws: dict):
    print(f"  Karma:     {ws['player_karma']}")
    print(f"  Weather:   {ws['weather']}")
    print(f"  Time:      {ws['time_of_day']}")
    print(f"  Tension:   {ws['tension_level']}/10")
    print(f"  NPCs:      {len(ws['active_npcs'])}")
    if ws["active_npcs"]:
        for npc in ws["active_npcs"]:
            print(f"             - {npc['id']} ({npc['type']}) @ {npc['location']} [{npc['mood']}]")
    print(f"  Events:    {ws['active_events'] or '(none)'}")
    print(f"  Actions:   {ws['recent_player_actions']}")
    if ws.get("location"):
        print(f"  Location:  {ws['location']}")


def print_result(result: dict):
    status = result.get("validation_status", "?")
    print(f"\n  Status:   {status}")
    print(f"  Narrator: \"{result['narrator']}\"")
    print(f"\n  Actions ({len(result['actions'])}):")
    if not result["actions"]:
        print("    (none)")
    for i, action in enumerate(result["actions"], 1):
        action_type = action.get("action", "?")
        details = {k: v for k, v in action.items() if k != "action"}
        print(f"    {i}. [{action_type}]")
        for key, val in details.items():
            print(f"       {key}: {val}")

    npc_directives = result.get("npc_directives", [])
    if npc_directives:
        print(f"\n  NPC Directives ({len(npc_directives)}):")
        for i, directive in enumerate(npc_directives, 1):
            npc_id = directive.get("npc_id", "?")
            npc_type = directive.get("npc_type", "")
            target = f"{npc_id} ({npc_type})" if npc_type else npc_id
            print(f"    {i}. -> {target}")
            print(f"       event: \"{directive.get('event', '?')}\"")
            if directive.get("reason"):
                print(f"       reason: {directive['reason']}")
    else:
        print(f"\n  NPC Directives: (none)")


# ──────────────────────────────────────────────
# Run a single scenario
# ──────────────────────────────────────────────

def _get_provider_label() -> str:
    provider = os.getenv("WORLD_LLM_PROVIDER", "groq").lower()
    model = os.getenv("WORLD_LLM_MODEL", "")
    if model:
        return f"{provider} ({model})"
    return provider


async def run_scenario(name: str, scenario: dict):
    print_header(f"Scenario: {scenario['label']}")
    print_world_state(scenario["world_state"])
    print(f"\n  Calling {_get_provider_label()} API...")

    try:
        result = await call_orchestrator(
            scenario["world_state"],
            scenario["recent_events"],
        )
        print_result(result)
        print(f"\n  Raw JSON:")
        print(json.dumps(result, indent=2))
    except Exception as exc:
        print(f"\n  ERROR: {exc}")


# ──────────────────────────────────────────────
# Custom interactive mode
# ──────────────────────────────────────────────

async def run_custom():
    print_header("CUSTOM SCENARIO")
    print("  Enter values (press Enter for defaults):\n")

    def ask(prompt, default, cast=str):
        raw = input(f"  {prompt} [{default}]: ").strip()
        if not raw:
            return default
        try:
            return cast(raw)
        except ValueError:
            print(f"    Invalid input, using default: {default}")
            return default

    karma = ask("Player karma (-100 to 100)", 0, int)
    weather = ask("Weather (clear/cloudy/rain/heavy_rain/fog/thunderstorm)", "clear")
    time_of_day = ask("Time of day (dawn/noon/afternoon/dusk/night/midnight)", "noon")
    tension = ask("Tension level (0-10)", 3, int)
    location = ask("Player location", "downtown")
    actions_raw = ask("Recent player actions (comma-separated)", "walked_around")
    recent_actions = [a.strip() for a in actions_raw.split(",")]
    npc_count = ask("Number of nearby NPCs", 1, int)

    npcs = []
    npc_types = ["civilian", "street_vendor", "police_officer", "gang_member"]
    npc_moods = ["neutral", "friendly", "aggressive", "panicked"]
    for i in range(npc_count):
        npcs.append({
            "id": f"npc_{100 + i}",
            "type": npc_types[i % len(npc_types)],
            "location": location,
            "mood": npc_moods[i % len(npc_moods)],
        })

    world_state = {
        "player_karma": max(-100, min(100, karma)),
        "active_npcs": npcs,
        "weather": weather,
        "time_of_day": time_of_day,
        "tension_level": max(0, min(10, tension)),
        "active_events": [],
        "recent_player_actions": recent_actions,
        "location": location,
    }

    scenario = {
        "label": f"CUSTOM (karma {world_state['player_karma']})",
        "world_state": world_state,
        "recent_events": recent_actions,
    }
    await run_scenario("custom", scenario)


# ──────────────────────────────────────────────
# Main
# ──────────────────────────────────────────────

async def main():
    parser = argparse.ArgumentParser(description="CLI tester for the World Orchestrator")
    parser.add_argument(
        "--scenario", "-s",
        choices=list(SCENARIOS.keys()),
        help="Run a single pre-built scenario",
    )
    parser.add_argument(
        "--custom", "-c",
        action="store_true",
        help="Enter custom world state values interactively",
    )
    args = parser.parse_args()

    if args.custom:
        await run_custom()
    elif args.scenario:
        s = SCENARIOS[args.scenario]
        await run_scenario(args.scenario, s)
    else:
        # Run all scenarios
        for name, scenario in SCENARIOS.items():
            await run_scenario(name, scenario)
            print()


if __name__ == "__main__":
    asyncio.run(main())
