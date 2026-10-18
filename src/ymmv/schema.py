"""The standard listing record every source produces, and normalisers for its fields.

Sources map whatever their site shows onto this schema, so listings from
different sites can be filtered, compared and modelled together.
"""

import re
from typing import Any, Literal

from pydantic import BaseModel, field_validator

Fuel = Literal["Petrol", "Diesel", "Hybrid", "Plug-in Hybrid", "Electric"]
Transmission = Literal["Manual", "Automatic"]
SellerType = Literal["TRADE", "PRIVATE"]
# AutoTrader's rating of the asking price against its own valuation.
PriceIndicator = Literal["GREAT", "GOOD", "FAIR", "HIGH", "LOW"]


class ListingRecord(BaseModel):
    source_id: str
    url: str | None = None
    title: str | None = None
    variant: str | None = None  # the full variant line, e.g. "1.5 Cooper Sport Euro 6 (s/s) 3dr"
    make: str | None = None
    model: str | None = None
    trim: str | None = None  # trim family from the car's patterns
    engine_l: float | None = None
    fuel: Fuel | None = None
    transmission: Transmission | None = None
    doors: int | None = None
    body_type: str | None = None
    colour: str | None = None
    condition: Literal["used", "new"] | None = None
    seller_type: SellerType | None = None
    year: int | None = None
    plate: str | None = None
    mileage: int | None = None
    location: str | None = None
    distance_miles: int | None = None
    price_gbp: int | None = None  # None when no price is shown (e.g. reserved)
    reserved: bool = False
    writeoff: str | None = None  # insurance write-off category, e.g. "Cat S", "Cat N"
    price_indicator: PriceIndicator | None = None  # the site's own price rating, if it has one

    @field_validator("writeoff", mode="before")
    @classmethod
    def _writeoff(cls, v: Any) -> str | None:
        m = re.search(r"\b(?:cat(?:egory)?\s*)?([ABCDNS])\b", str(v or ""), re.I)
        return f"Cat {m.group(1).upper()}" if m else None

    @field_validator("price_indicator", mode="before")
    @classmethod
    def _price_indicator(cls, v: Any) -> str | None:
        v = str(v or "").upper().removeprefix("PI_")
        return v if v in ("GREAT", "GOOD", "FAIR", "HIGH", "LOW") else None

    @field_validator("fuel", mode="before")
    @classmethod
    def _fuel(cls, v: Any) -> str | None:
        return normalise_fuel(v)

    @field_validator("transmission", mode="before")
    @classmethod
    def _transmission(cls, v: Any) -> str | None:
        if not v:
            return None
        return "Automatic" if str(v).lower().startswith(("auto", "semi", "cvt", "dsg", "step")) else "Manual"

    @field_validator("seller_type", mode="before")
    @classmethod
    def _seller(cls, v: Any) -> str | None:
        return str(v).upper() if v else None

    @field_validator("colour", mode="before")
    @classmethod
    def _colour(cls, v: Any) -> str | None:
        return str(v).strip().title() if v else None


def normalise_fuel(v: Any) -> str | None:
    if not v:
        return None
    s = str(v).lower()
    if "plug-in" in s or "phev" in s:
        return "Plug-in Hybrid"
    if "hybrid" in s:
        return "Hybrid"
    if "electric" in s:
        return "Electric"
    if "diesel" in s:
        return "Diesel"
    if "petrol" in s:
        return "Petrol"
    return None


def first_int(text: Any) -> int | None:
    """'43,750 miles' -> 43750, '£4,500' -> 4500."""
    m = re.search(r"\d[\d,]*", str(text or ""))
    return int(m.group().replace(",", "")) if m else None


def engine_litres(text: str | None) -> float | None:
    m = re.match(r"^\s*(\d\.\d)\b", text or "")
    return float(m.group(1)) if m else None
