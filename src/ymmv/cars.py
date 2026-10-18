"""Car definitions (cars.yaml): what to search for, independent of any source."""

import re
from functools import cached_property
from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field

CARS_FILE = Path(__file__).resolve().parents[2] / "cars.yaml"


class Trim(BaseModel):
    name: str
    pattern: str  # regex matched against the variant text


class Car(BaseModel):
    id: str
    label: str
    make: str
    model: str
    doors: int | None = None
    body_type: str | None = None
    trims: list[Trim] = Field(default_factory=list, description="first match wins")
    sources: dict[str, dict[str, Any]] = Field(default_factory=dict, description="per-source field overrides")

    def for_source(self, source: str) -> "Car":
        """This car with any `sources.<source>` overrides applied."""
        return self.model_copy(update=self.sources.get(source, {}))

    @cached_property
    def _trim_patterns(self) -> list[tuple[str, re.Pattern[str]]]:
        return [(t.name, re.compile(t.pattern, re.I)) for t in self.trims]

    def trim_of(self, variant: str | None) -> str | None:
        for name, pattern in self._trim_patterns:
            if variant and pattern.search(variant):
                return name
        return None


def load_cars(path: Path = CARS_FILE) -> dict[str, Car]:
    data = yaml.safe_load(path.read_text())
    return {car_id: Car(id=car_id, **spec) for car_id, spec in data.items()}
