"""Dick Lovett (MINI main dealer: Bristol, Swindon, Melksham, Hungerford) used stock pages.

The site serves server-rendered stock lists, 12 cars a page, filtered by path:
/mini/used-cars/<model>/doors/<n>/page/<p>. Each car is an `a.used-stock-element`
card with a title ("MINI Hatch"), a sub-title (the variant without the engine,
e.g. "Cooper Classic Steptronic Euro 6"), the price and a list of stats keyed by
icon (fuel, mileage, year, gearbox, doors, engine) plus the branch. The page says
how many cars match ("View 52 cars"); pages past the end show unrelated stock, so
paging stops at that count. Cards carry no colour or plate.

Cloudflare challenges Python's own TLS handshake, so pages are fetched with
curl_cffi impersonating Chrome rather than the base class's httpx client.
"""

import math
import re
from collections.abc import Iterator
from typing import Any

from bs4 import BeautifulSoup, Tag
from curl_cffi import requests
from loguru import logger

from ..cars import Car
from ..geo import miles_between
from ..schema import ListingRecord, first_int
from .base import Source

BASE = "https://www.dicklovett.co.uk"
PER_PAGE = 12
BRANCH_POSTCODES = {
    "Bristol": "BS10 7TU",
    "Swindon": "SN5 7YH",
    "Melksham": "SN12 6GN",
    "Hungerford": "RG17 0EL",
}
STATS = {"fuel": "fuel", "tachometer": "mileage", "calendar": "year", "transmission": "gearbox", "door": "doors"}


class DickLovett(Source):
    name = "dicklovett"

    def __init__(self, postcode: str, delay: float = 1.0, max_pages: int | None = None):
        super().__init__(postcode, delay, max_pages)
        self.session = requests.Session(impersonate="chrome", timeout=30)

    def unsupported(self, car: Car) -> str | None:
        return None if car.make.upper() == "MINI" else "Dick Lovett's MINI stock is only MINIs"

    def _page(self, car: Car, page: int) -> BeautifulSoup:
        self.pause()
        path = f"/mini/used-cars/{car.model.lower()}"
        if car.doors:
            path += f"/doors/{car.doors}"
        if page > 1:
            path += f"/page/{page}"
        r = self.session.get(BASE + path)  # sorted by price, lowest first
        r.raise_for_status()
        return BeautifulSoup(r.text, "html.parser")

    def listings(self, car: Car) -> Iterator[tuple[ListingRecord, dict[str, Any]]]:
        distances = {town: miles_between(pc, self.postcode) for town, pc in BRANCH_POSTCODES.items()}
        seen: set[str] = set()
        page, pages = 1, 1
        while page <= pages:
            soup = self._page(car, page)
            if page == 1:
                self.expected = total_cars(soup)
                pages = math.ceil((self.expected or 0) / PER_PAGE)
                if self.max_pages and pages > self.max_pages:
                    pages, self.truncated = self.max_pages, True
            raws = [card_raw(a) for a in soup.select("li.used-stock-list-list__item a.used-stock-element")]
            new = [r for r in raws if r["id"] not in seen]
            logger.info("dicklovett page {}/{}: {} cars", page, pages, len(new))
            for raw in new:
                seen.add(raw["id"])
                if matches(raw, car):
                    yield parse_card(raw, car, distances.get(raw.get("location") or "")), raw
            page += 1


def total_cars(soup: BeautifulSoup) -> int | None:
    el = soup.find(string=re.compile(r"\bView \d[\d,]* cars?\b"))
    return first_int(el)


def _text(el: Tag | None) -> str | None:
    return (" ".join(el.get_text(" ", strip=True).split()) or None) if el else None


def card_raw(a: Tag) -> dict[str, Any]:
    href = str(a["href"])
    raw: dict[str, Any] = {
        "id": href.rstrip("/").rsplit("/", 1)[-1],
        "url": BASE + href if href.startswith("/") else href,
        "title": _text(a.select_one(".used-stock-element-details__title")),
        "subtitle": _text(a.select_one(".used-stock-element-details__sub-title")),
        "price": _text(a.select_one(".used-stock-element-details-total__value")),
        "location": _text(a.select_one(".used-stock-element-lower__location")),
        "reserved": "reserved" in a.get_text(" ", strip=True).lower(),
    }
    stats = a.select_one(".used-stock-detail-stats")  # the card repeats it for small screens
    for el in stats.select(".used-stock-detail-stats__element") if stats else []:
        classes = icon.get_attribute_list("class") if (icon := el.select_one(".icon")) else []
        kind = next((c.removeprefix("icon--") for c in classes if c.startswith("icon--")), None)
        if kind:
            raw[STATS.get(kind, kind)] = _text(el.select_one(".used-stock-detail-stats__label"))
    return raw


def _make_model(raw: dict[str, Any]) -> tuple[str | None, str | None]:
    make, _, model = (raw.get("title") or "").partition(" ")
    return make or None, model or None


def matches(raw: dict[str, Any], car: Car) -> bool:
    """Pages past the end show other stock, so check each card is the car."""
    _, model = _make_model(raw)
    if (model or "").lower() != car.model.lower():
        return False
    return not car.doors or first_int(raw.get("doors")) == car.doors


def parse_card(raw: dict[str, Any], car: Car, distance: int | None) -> ListingRecord:
    make, model = _make_model(raw)
    engine = re.match(r"\d\.\d", raw.get("engine") or "")
    sub = raw.get("subtitle") or ""
    # The sub-title leaves out the engine; put it back so variants read like other sources'.
    variant = f"{engine.group()} {sub}" if engine and not re.match(r"\d\.\d", sub) else sub
    return ListingRecord.model_validate(
        dict(
            source_id=raw["id"],
            url=raw.get("url"),
            title=raw.get("title"),
            variant=variant or None,
            make=make,
            model=model,
            trim=car.trim_of(variant),
            engine_l=float(engine.group()) if engine else None,
            fuel=raw.get("fuel"),
            transmission=raw.get("gearbox"),
            doors=first_int(raw.get("doors")),
            condition="used",
            seller_type="TRADE",
            year=first_int(raw.get("year")),
            mileage=first_int(raw.get("mileage")),
            location=raw.get("location"),
            distance_miles=distance,
            price_gbp=first_int(raw.get("price")),
            reserved=bool(raw.get("reserved")),
        )
    )
