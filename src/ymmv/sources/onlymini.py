"""Only Mini (independent MINI specialist, Bristol BS3 5RU) stock pages.

The site serves server-rendered stock lists, 12 cars a page, at
/stock/<slug>/<page>?make=MINI&model=...&doors=... Each car is an
`li.cwSLVehicle` whose data-* attributes (price, reg date, VRM, mileage) and
data-v-* children (fuel, gearbox, version, colour, status) carry everything we
need. Reserved cars show no price. The site has no total count, so `expected`
is just what was found.
"""

from collections.abc import Iterator
from typing import Any

from bs4 import BeautifulSoup, Tag
from loguru import logger

from ..cars import Car
from ..geo import miles_between
from ..schema import ListingRecord, engine_litres, first_int
from .base import Source

BASE = "https://www.onlymini.co.uk"
STOCK = "/stock/used-vehicles-in-weston-super-mare-somerset"
SHOP_POSTCODE = "BS3 5RU"
SPEC_FIELDS = (
    "version",
    "status",
    "regyear",
    "regletter",
    "fueltype",
    "transmission",
    "doors",
    "colorbasic",
    "bodytype",
    "strapline",
)


class OnlyMini(Source):
    name = "onlymini"

    def unsupported(self, car: Car) -> str | None:
        return None if car.make.upper() == "MINI" else "Only Mini only sells MINIs"

    def _page(self, car: Car, page: int) -> list[Tag]:
        self.pause()
        params = {"make": "MINI", "model": car.model.lower()}
        if car.doors:
            params["doors"] = str(car.doors)
        r = self.client.get(BASE + (STOCK if page == 1 else f"{STOCK}/{page}"), params=params)
        r.raise_for_status()
        return BeautifulSoup(r.text, "html.parser").select("li.cwSLVehicle")

    def listings(self, car: Car) -> Iterator[tuple[ListingRecord, dict[str, Any]]]:
        distance = miles_between(SHOP_POSTCODE, self.postcode)
        seen: set[str] = set()
        self.expected = 0
        for page in range(1, (self.max_pages or 50) + 1):
            new = [li for li in self._page(car, page) if li.get("data-id") not in seen]
            logger.info("onlymini page {}: {} cars", page, len(new))
            if not new:
                return
            for li in new:
                seen.add(str(li["data-id"]))
                raw = card_raw(li)
                if matches(raw, car):
                    self.expected += 1
                    yield parse_card(raw, car, distance), raw
        self.truncated = True


# Not kept: the number plate (data-vrm) identifies the car and isn't needed.
DROP_ATTRS = {"vrm"}


def card_raw(li: Tag) -> dict[str, Any]:
    attrs = {k.removeprefix("data-"): v for k, v in li.attrs.items() if k.startswith("data-")}
    raw: dict[str, Any] = {k: v for k, v in attrs.items() if k not in DROP_ATTRS}
    for name in SPEC_FIELDS:
        el = li.select_one(f"[data-v-{name}]")
        raw[name] = " ".join(el.get_text(" ", strip=True).split()) if el else None
    return raw


def matches(raw: dict[str, Any], car: Car) -> bool:
    """The site's filters are loose (e.g. doors=3 also returns other models), so check again."""
    if (raw.get("model") or "").lower() != car.model.lower():
        return False
    if car.doors and first_int(raw.get("doors")) != car.doors:
        return False
    return not car.body_type or (raw.get("bodytype") or "").lower() == car.body_type.lower()


def parse_card(raw: dict[str, Any], car: Car, distance: int | None) -> ListingRecord:
    variant = raw.get("version")  # e.g. "1.5 Cooper Auto Euro 6 (s/s) 3dr"
    cc = first_int(raw.get("enginecc"))
    return ListingRecord.model_validate(
        dict(
            source_id=raw["id"],
            url=raw.get("url"),
            title=f"{raw.get('make')} {raw.get('model')}",
            variant=variant,
            make=raw.get("make"),
            model=raw.get("model"),
            trim=car.trim_of(variant),
            engine_l=engine_litres(variant) or (round(cc / 1000, 1) if cc else None),
            fuel=raw.get("fueltype"),
            transmission=raw.get("transmission"),
            doors=first_int(raw.get("doors")),
            body_type=raw.get("bodytype"),
            colour=raw.get("colorbasic"),
            condition="new" if raw.get("isnew") == "true" else "used",
            seller_type="TRADE",
            year=first_int(raw.get("regyear")) or first_int(raw.get("regdate")),
            plate=raw.get("regletter"),
            mileage=first_int(raw.get("mileage")),
            location="Bristol",
            distance_miles=distance,
            price_gbp=first_int(raw.get("price")),
            reserved=(raw.get("status") or "").lower() == "reserved",
        )
    )
