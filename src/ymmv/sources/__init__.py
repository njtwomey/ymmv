"""Registry of sources. To add a site: subclass `Source` in a new module and list it here."""

from .autotrader import AutoTrader
from .base import Source
from .dicklovett import DickLovett
from .onlymini import OnlyMini

SOURCES: dict[str, type[Source]] = {s.name: s for s in (AutoTrader, OnlyMini, DickLovett)}

__all__ = ["SOURCES", "Source"]
