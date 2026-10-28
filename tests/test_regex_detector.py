import json
import os
from types import SimpleNamespace

from src.utils.spam_detectors.regex_detector import RegexSpamDetector


def _write(path, rules, mtime=None):
    path.write_text(json.dumps({"rules": rules}), encoding="utf-8")
    if mtime is not None:
        os.utime(path, (mtime, mtime))


def _msg(text=None, caption=None):
    return SimpleNamespace(text=text, caption=caption)


def test_matches_text_and_caption_case_insensitive(tmp_path):
    rules = tmp_path / "spam_regex.json"
    _write(rules, [{"id": "vpn", "name": "机场类", "pattern": r"(?:机场|vpn)[\s\S]{0,8}(?:免费试用|注册)"}])
    detector = RegexSpamDetector(str(rules))

    is_spam, info = detector.detect(_msg(text="高速 VPN，现在注册送流量"))
    assert is_spam and info["method"] == "regex" and info["matched"].startswith("机场类: VPN")
    assert detector.detect(_msg(caption="机场免费试用")) [0]
    assert detector.detect(_msg(text="今天去机场接人")) == (False, None)
    assert detector.detect(_msg()) == (False, None)


def test_invalid_rule_skipped_and_reload_on_change(tmp_path):
    rules = tmp_path / "spam_regex.json"
    _write(rules, [{"id": "bad", "pattern": "("}, {"id": "ok", "name": "A", "pattern": "foo"}], mtime=1_000)
    detector = RegexSpamDetector(str(rules))
    assert detector.detect(_msg(text="foo"))[0]
    assert not detector.detect(_msg(text="bar"))[0]

    _write(rules, [{"id": "ok", "name": "B", "pattern": "bar"}], mtime=2_000)
    assert detector.detect(_msg(text="bar"))[1]["matched"] == "B: bar"


def test_missing_file_disables(tmp_path):
    assert RegexSpamDetector(str(tmp_path / "none.json")).detect(_msg(text="anything")) == (False, None)
