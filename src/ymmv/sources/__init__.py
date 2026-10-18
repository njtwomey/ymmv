"""Registry of sources. To add a site: subclass `Source` in a new module and list it here."""

from .autotrader import AutoTrader
from .base import Source
from .onlymini import OnlyMini

SOURCES: dict[str, type[Source]] = {s.name: s for s in (AutoTrader, OnlyMini)}

__all__ = ["SOURCES", "Source"]
