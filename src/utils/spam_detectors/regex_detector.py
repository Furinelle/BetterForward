"""Regex category spam detector (e.g. the Nagram promotion rule pack)."""
import json
import os
import re
import threading
from typing import Optional, Tuple

from telebot.types import Message

from src.config import logger
from src.utils.spam_detector_base import SpamDetectorBase


class RegexSpamDetector(SpamDetectorBase):
    """Match message text or caption against named, case-insensitive regex categories.

    The rules file is {"rules": [{"id": ..., "name": ..., "pattern": ...}, ...]} and is
    reloaded whenever its mtime changes. A missing file disables the detector.
    """

    def __init__(self, rules_file: str = "./data/spam_regex.json"):
        self.rules_file = rules_file
        self.lock = threading.Lock()
        self._rules: list[tuple[str, re.Pattern]] = []
        self._mtime = None

    def _load(self):
        try:
            mtime = os.path.getmtime(self.rules_file)
        except OSError:
            self._rules, self._mtime = [], None
            return
        if mtime == self._mtime:
            return
        with self.lock:
            rules = []
            try:
                with open(self.rules_file, encoding="utf-8") as f:
                    items = json.load(f).get("rules", [])
            except (OSError, ValueError) as e:
                logger.error(f"Failed to load regex rules: {e}")
                items = []
            for item in items:
                try:
                    rules.append((item.get("name") or item.get("id") or "?", re.compile(item["pattern"], re.IGNORECASE)))
                except (KeyError, TypeError, re.error) as e:
                    logger.error(f"Skipping invalid regex rule {item.get('id')}: {e}")
            self._rules, self._mtime = rules, mtime
            logger.info(f"Loaded {len(rules)} regex spam rules")

    def detect(self, message: Message) -> Tuple[bool, Optional[dict]]:
        text = message.text or getattr(message, "caption", None)
        if not text:
            return False, None
        self._load()
        for name, pattern in self._rules:
            match = pattern.search(text)
            if match:
                return True, {
                    "method": "regex",
                    "matched": f"{name}: {match.group(0)[:40]}",
                    "detector": self.get_name(),
                }
        return False, None

    def get_name(self) -> str:
        return "Regex Detector"
