"""AutoTrader UK, via the GraphQL gateway its own search page calls.

Search cards don't include fuel or gearbox. So for each car we first ask the
search for its fuel-type and transmission facet values, then search each
fuel x transmission combination separately and tag cards from the filter used.
That also keeps each search under AutoTrader's 100-page cap; a combination that
still goes over is split by registration year.

Searches are UK-wide. The postcode only sets the distance shown on each card.
"""

import itertools
import re
import time
import uuid
from collections.abc import Iterator
from datetime import date
from typing import Any

import httpx
from loguru import logger

from ..cars import Car
from ..schema import ListingRecord, engine_litres, first_int
from .base import Source

BASE = "https://www.autotrader.co.uk"
APP_NAME = "sauron-search-results-app"
FALLBACK_APP_VERSION = "a19effb038"  # read from the search page on 2026-10-18
MAX_PAGES = 100
FIRST_YEAR = 1990

# A trimmed copy of the site's SearchResultsListingsGridQuery.
LISTINGS_QUERY = """
query SearchResultsListingsGridQuery($filters: [FilterInput!]!, $channel: Channel!,
    $page: Int, $sortBy: SearchResultsSort, $searchId: String!) {
  searchResults(input: {facets: [], filters: $filters, channel: $channel,
      page: $page, sortBy: $sortBy, searchId: $searchId}) {
    listings {
      ... on SearchListing {
        type advertId title subTitle price vehicleLocation sellerType preReg
        badges { type displayText }
        trackingContext {
          advertContext { make model year condition price advertiserType }
          advertCardFeatures { priceIndicator }
          distance { distance }
        }
      }
    }
    page { number count results { count } }
  }
}
"""

FACETS_QUERY = """
query SearchFacets($filters: [FilterInput!]!, $searchId: String!, $facets: [FacetName!]!) {
  searchResults(input: {facets: $facets, filters: $filters, channel: cars, page: 1, searchId: $searchId}) {
    facets { facet filters { filter options { value count } } }
    page { results { count } }
  }
}
"""


class AutoTrader(Source):
    name = "autotrader"

    def __init__(self, postcode: str, delay: float = 1.0, max_pages: int | None = None):
        super().__init__(postcode, delay, max_pages)
        self.client.base_url = httpx.URL(BASE)
        self.client.headers.update({"origin": BASE, "referer": f"{BASE}/car-search"})
        self.client.headers["x-sauron-app-name"] = APP_NAME
        self.client.headers["x-sauron-app-version"] = self._app_version()
        self.page_cap = min(max_pages or MAX_PAGES, MAX_PAGES)

    def _app_version(self) -> str:
        try:
            html = self.client.get("/car-search").text
            if m := re.search(r'"appVersion":"(\w+)"', html):
                return m.group(1)
        except httpx.HTTPError as e:
            logger.warning("could not read app version ({}), using fallback", e)
        return FALLBACK_APP_VERSION

    # ------------------------------------------------------------------ http
    def _post(self, operation: str, query: str, variables: dict[str, Any]) -> dict[str, Any]:
        body = [{"operationName": operation, "variables": variables | {"searchId": str(uuid.uuid4())}, "query": query}]
        for attempt in range(4):
            self.pause()
            try:
                r = self.client.post("/at-gateway", params={"opname": operation}, json=body)
                r.raise_for_status()
                payload = r.json()[0]
                if payload.get("errors"):
                    raise RuntimeError(payload["errors"][0]["message"])
                return payload["data"]["searchResults"]
            except (httpx.HTTPError, ValueError) as e:
                wait = 5 * 2**attempt
                logger.warning("{} failed ({}); retrying in {}s", operation, e, wait)
                time.sleep(wait)
        raise RuntimeError(f"giving up on {operation} {variables.get('page', '')}")

    @staticmethod
    def _filters(car: Car, postcode: str, **extra: str) -> list[dict[str, Any]]:
        base: dict[str, str] = {
            "make": car.make,
            "model": car.model,
            "postcode": postcode,
            "price_search_type": "total",
        }
        if car.doors:
            base["doors_values"] = str(car.doors)
        if car.body_type:
            base["body_type"] = car.body_type
        return [{"filter": k, "selected": [v]} for k, v in (base | extra).items()]

    def facets(self, car: Car) -> tuple[int, dict[str, list[str]]]:
        """(total listings, {facet: [values with listings]}) for fuel type and transmission."""
        data = self._post(
            "SearchFacets",
            FACETS_QUERY,
            {"filters": self._filters(car, self.postcode), "facets": ["fuel_type", "transmission"]},
        )
        values = {
            f["facet"]: [o["value"] for flt in f["filters"] for o in flt["options"] if o["count"]]
            for f in data["facets"]
        }
        return data["page"]["results"]["count"], values

    def search(self, car: Car, page: int = 1, **filters: str) -> dict[str, Any]:
        variables = {
            "filters": self._filters(car, self.postcode, **filters),
            "channel": "cars",
            "page": page,
            "sortBy": "relevance",
        }
        return self._post("SearchResultsListingsGridQuery", LISTINGS_QUERY, variables)

    # ------------------------------------------------------------- scraping
    def _cards(self, car: Car, **filters: str) -> Iterator[dict[str, Any]]:
        first = self.search(car, 1, **filters)
        n_pages = first["page"]["count"] if first["page"]["results"]["count"] else 0
        if n_pages > MAX_PAGES and "min_year_manufactured" not in filters:
            logger.info("{} has {} pages; splitting by year", filters, n_pages)
            for year in range(FIRST_YEAR, date.today().year + 1):
                y = str(year)
                yield from self._cards(car, **filters, min_year_manufactured=y, max_year_manufactured=y)
            return
        if n_pages > self.page_cap:
            self.truncated = True
        logger.info("{}: {} results over {} pages", filters, first["page"]["results"]["count"], n_pages)
        yield from first["listings"]
        for page in range(2, min(n_pages, self.page_cap) + 1):
            yield from self.search(car, page, **filters)["listings"]

    def listings(self, car: Car) -> Iterator[tuple[ListingRecord, dict[str, Any]]]:
        self.expected, values = self.facets(car)
        logger.info(
            "{}: {} listings; fuels {}; transmissions {}",
            car.id,
            self.expected,
            values.get("fuel_type"),
            values.get("transmission"),
        )
        seen: set[str] = set()
        for fuel, transmission in itertools.product(values.get("fuel_type", []), values.get("transmission", [])):
            for card in self._cards(car, fuel_type=fuel, transmission=transmission):
                advert_id = card.get("advertId")  # ad slots have none
                if not advert_id or advert_id in seen:
                    continue
                seen.add(advert_id)
                raw = card | {"_search": {"fuel_type": fuel, "transmission": transmission}}
                yield parse_card(card, car, fuel, transmission), raw


def parse_card(card: dict[str, Any], car: Car, fuel: str, transmission: str) -> ListingRecord:
    badges = {b["type"]: b["displayText"] for b in card.get("badges") or []}
    tracking = card.get("trackingContext") or {}
    ctx = tracking.get("advertContext") or {}
    variant = card.get("subTitle")
    registered = badges.get("REGISTERED_YEAR", "")  # e.g. "2016 (16 reg)"
    plate = re.search(r"\((\w+) reg\)", registered)
    doors = re.search(r"\b(\d)dr\b", variant or "")
    location = card.get("vehicleLocation") or ""  # e.g. "Bristol (2 miles)"
    return ListingRecord.model_validate(
        dict(
            source_id=card["advertId"],
            url=f"{BASE}/car-details/{card['advertId']}",
            title=card.get("title"),
            variant=variant,
            make=ctx.get("make") or car.make,
            model=ctx.get("model") or car.model,
            trim=car.trim_of(variant),
            engine_l=engine_litres(variant),
            fuel=fuel,
            transmission=transmission,
            doors=int(doors.group(1)) if doors else car.doors,
            body_type=car.body_type,
            condition=ctx.get("condition"),
            seller_type=card.get("sellerType") or ctx.get("advertiserType"),
            year=first_int(registered) or ctx.get("year"),
            plate=plate.group(1) if plate else None,
            mileage=first_int(badges.get("MILEAGE")),
            location=re.sub(r"\s*\(.*\)$", "", location) or None,
            distance_miles=(tracking.get("distance") or {}).get("distance"),
            price_gbp=ctx.get("price") or first_int(card.get("price")),
            writeoff=badges.get("WRITE_OFF_CATEGORY"),
            price_indicator=(tracking.get("advertCardFeatures") or {}).get("priceIndicator"),
        )
    )
