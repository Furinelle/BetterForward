"""Spam detector implementations."""

from src.utils.spam_detectors.keyword_detector import KeywordSpamDetector
from src.utils.spam_detectors.regex_detector import RegexSpamDetector

__all__ = ['KeywordSpamDetector', 'RegexSpamDetector']
