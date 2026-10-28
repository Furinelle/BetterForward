"""Best-effort account metadata: data center and estimated registration month.

The Bot API exposes neither value. The DC is read from the user's profile photo
file_id; the registration month is interpolated from known (user_id, date) pairs.

data/tg_id_dates.json comes from telegram-id-age
(https://github.com/jobians/telegram-id-age), MIT License, Copyright (c) JOBIANSTECHIE.
"""

import base64
import bisect
import json
import os
import struct
from datetime import date

from src.config import _, logger

DC_LOCATIONS = {
    1: ("🇺🇸", "Miami"),
    2: ("🇳🇱", "Amsterdam"),
    3: ("🇺🇸", "Miami"),
    4: ("🇳🇱", "Amsterdam"),
    5: ("🇸🇬", "Singapore"),
}

with open(os.path.join(os.path.dirname(__file__), "data", "tg_id_dates.json")) as f:
    _ID_DATES = [(uid, date.fromisoformat(d)) for uid, d in json.load(f)]
_IDS = [uid for uid, _d in _ID_DATES]


def dc_from_file_id(file_id: str) -> int | None:
    """Decode the DC id from a Bot API file_id (base64url + zero-byte RLE, then int32 type, int32 dc)."""
    raw = base64.urlsafe_b64decode(file_id + "=" * (-len(file_id) % 4))
    out = bytearray()
    i = 0
    while i < len(raw):
        if raw[i] == 0 and i + 1 < len(raw):
            out += b"\0" * raw[i + 1]
            i += 2
        else:
            out.append(raw[i])
            i += 1
    if len(out) < 8:
        return None
    dc = struct.unpack_from("<i", out, 4)[0]
    return dc if dc in DC_LOCATIONS else None


def get_user_dc(bot, user_id: int) -> int | None:
    """DC of the user's profile photo; None without a visible photo or on any API error."""
    try:
        photos = bot.get_user_profile_photos(user_id, limit=1)
        if not photos.total_count:
            return None
        return dc_from_file_id(photos.photos[0][-1].file_id)
    except Exception as e:
        logger.debug(f"Failed to read DC for user {user_id}: {e}")
        return None


def format_dc(dc: int | None) -> str:
    if dc is None:
        return _("Unknown")
    flag, city = DC_LOCATIONS[dc]
    return f"DC{dc} {flag} {_(city)}"


def estimate_registration(user_id: int) -> tuple[str, date]:
    """Return ("approx" | "before" | "after", date) by linear interpolation between known IDs."""
    if user_id < _IDS[0]:
        return "before", _ID_DATES[0][1]
    if user_id > _IDS[-1]:
        return "after", _ID_DATES[-1][1]
    i = bisect.bisect_left(_IDS, user_id)
    hi_id, hi_date = _ID_DATES[i]
    if hi_id == user_id or i == 0:
        return "approx", hi_date
    lo_id, lo_date = _ID_DATES[i - 1]
    ratio = (user_id - lo_id) / (hi_id - lo_id)
    return "approx", date.fromordinal(round(lo_date.toordinal() + ratio * (hi_date.toordinal() - lo_date.toordinal())))


def format_registration(user_id: int) -> str:
    status, d = estimate_registration(user_id)
    month = d.strftime("%Y-%m")
    return {"approx": _("approx. {}"), "before": _("before {}"), "after": _("after {}")}[status].format(month)
