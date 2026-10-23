"""UK postcode distances via postcodes.io (free, no key)."""

import math
from functools import cache

import httpx
from loguru import logger


@cache
def latlon(postcode: str) -> tuple[float, float] | None:
    # Retired postcodes (some dealers still use them) only resolve under terminated_postcodes.
    for kind in ("postcodes", "terminated_postcodes"):
        try:
            r = httpx.get(f"https://api.postcodes.io/{kind}/{postcode.replace(' ', '')}", timeout=10)
            if r.status_code == 404:
                continue
            r.raise_for_status()
            res = r.json()["result"]
            return res["latitude"], res["longitude"]
        except (httpx.HTTPError, KeyError, TypeError) as e:
            logger.warning("could not geocode {}: {}", postcode, e)
            return None
    logger.warning("could not geocode {}: not found", postcode)
    return None


def miles_between(a: str, b: str) -> int | None:
    """Straight-line miles between two postcodes, or None if either can't be found."""
    pa, pb = latlon(a), latlon(b)
    if not (pa and pb):
        return None
    (lat1, lon1), (lat2, lon2) = (tuple(map(math.radians, p)) for p in (pa, pb))
    h = math.sin((lat2 - lat1) / 2) ** 2 + math.cos(lat1) * math.cos(lat2) * math.sin((lon2 - lon1) / 2) ** 2
    return round(2 * 3958.8 * math.asin(math.sqrt(h)))
