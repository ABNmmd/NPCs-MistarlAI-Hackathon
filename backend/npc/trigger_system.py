from typing import Optional


DEFAULT_EMOTION_TRIGGERS = {
    "gift": {"emotion": "GRATEFUL", "trust_delta": 2},
    "thank": {"emotion": "GRATEFUL", "trust_delta": 1},
    "help": {"emotion": "GRATEFUL", "trust_delta": 2},
    "threat": {"emotion": "ANGRY", "trust_delta": -2},
    "attack": {"emotion": "ANGRY", "trust_delta": -3},
    "insult": {"emotion": "ANGRY", "trust_delta": -1},
    "scared": {"emotion": "SUSPICIOUS", "trust_delta": -1},
    "lie": {"emotion": "SUSPICIOUS", "trust_delta": -2},
    "suspicious": {"emotion": "SUSPICIOUS", "trust_delta": -1},
    "joke": {"emotion": "HAPPY", "trust_delta": 1},
    "laugh": {"emotion": "HAPPY", "trust_delta": 1},
    "excited": {"emotion": "EXCITED", "trust_delta": 1},
    "sad": {"emotion": "SAD", "trust_delta": 0},
    "confused": {"emotion": "CONFUSED", "trust_delta": 0},
}

DEFAULT_ACTION_TRIGGERS = {
    "attack": "ATTACK",
    "punch": "PUNCH",
    "kick": "KICK",
    "run": "WALK_AWAY",
    "flee": "WALK_AWAY",
    "give": "GIVE_ITEM",
    "gift": "GIVE_ITEM",
    "trade": "TRADE",
    "talk": "NONE",
    "walk": "NONE",
    "stand": "NONE",
}


class TriggerSystem:
    def __init__(self, emotion_triggers: dict = None, action_triggers: dict = None):
        self.emotion_triggers = emotion_triggers or DEFAULT_EMOTION_TRIGGERS
        self.action_triggers = action_triggers or DEFAULT_ACTION_TRIGGERS

    def check_emotion_trigger(self, text: str) -> Optional[dict]:
        text_lower = text.lower()
        for keyword, trigger_data in self.emotion_triggers.items():
            if keyword in text_lower:
                return trigger_data
        return None

    def check_action_trigger(self, text: str) -> Optional[str]:
        text_lower = text.lower()
        for keyword, action in self.action_triggers.items():
            if keyword in text_lower:
                return action
        return None

    def get_all_triggers(self, text: str) -> dict:
        return {
            "emotion_trigger": self.check_emotion_trigger(text),
            "action_trigger": self.check_action_trigger(text),
        }
