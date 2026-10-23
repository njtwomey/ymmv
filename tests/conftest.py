import json
from pathlib import Path

import pytest

from ymmv import db
from ymmv.cars import load_cars

FIXTURES = Path(__file__).parent / "fixtures"


@pytest.fixture
def cars():
    return load_cars()


@pytest.fixture
def mini(cars):
    return cars["mini-hatch-3dr"]


@pytest.fixture
def autotrader_card():
    return json.loads((FIXTURES / "autotrader_card.json").read_text())


@pytest.fixture
def onlymini_html():
    return (FIXTURES / "onlymini_stock.html").read_text()


@pytest.fixture
def dicklovett_html():
    return (FIXTURES / "dicklovett_stock.html").read_text()


@pytest.fixture
def sessions(tmp_path):
    """A fresh database built by running every migration."""
    return db.connect(tmp_path / "test.sqlite")
