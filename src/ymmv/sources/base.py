"""What a source (a website selling cars) has to provide."""

import random
import time
from abc import ABC, abstractmethod
from collections.abc import Iterator
from typing import Any

import httpx

from ..cars import Car
from ..schema import ListingRecord

USER_AGENT = (
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 "
    "(KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36"
)


class Source(ABC):
    """Scrapes one site. Subclasses set `name` and implement `listings`.

    After `listings()` is exhausted, `expected` holds how many listings the site
    said it had (or None), and `truncated` whether anything was deliberately skipped
    (e.g. --max-pages). Together these decide if a run is complete enough to delist
    adverts that weren't seen.
    """

    name: str

    def __init__(self, postcode: str, delay: float = 1.0, max_pages: int | None = None):
        self.postcode = postcode
        self.delay = delay
        self.max_pages = max_pages
        self.expected: int | None = None
        self.truncated = False
        self.client = httpx.Client(timeout=30, follow_redirects=True, headers={"user-agent": USER_AGENT})

    def unsupported(self, car: Car) -> str | None:
        """Why this source can't search for `car`, or None if it can."""
        return None

    @abstractmethod
    def listings(self, car: Car) -> Iterator[tuple[ListingRecord, dict[str, Any]]]:
        """Yield (standard record, raw source data) for every listing of `car`."""

    def pause(self) -> None:
        time.sleep(self.delay * random.uniform(0.7, 1.3))
