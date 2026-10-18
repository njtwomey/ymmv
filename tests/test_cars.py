import pytest


@pytest.mark.parametrize(
    ("variant", "trim"),
    [
        ("2.0 John Cooper Works Euro 6 (s/s) 3dr", "JCW"),
        ("2.0 Cooper SD Euro 6 (s/s) 3dr", "Cooper S"),
        ("2.0 Cooper S Sport Steptronic Euro 6 (s/s) 3dr", "Cooper S"),
        ("1.5 Cooper D Auto Euro 6 (s/s) 3dr", "Cooper"),
        ("1.5 One 1499 GT Euro 6 (s/s) 3dr", "One"),
        ("1.4 First Euro 5 3dr", "One"),
        ("2.0 Challenge 210 Euro 6 (s/s) 3dr", "JCW"),
        ("1.6 Something Else", None),
        (None, None),
    ],
)
def test_mini_trims(mini, variant, trim):
    assert mini.trim_of(variant) == trim


def test_yaml_anchor_shares_trims(cars):
    assert cars["mini-hatch-5dr"].trims == cars["mini-hatch-3dr"].trims
    assert cars["mini-hatch-5dr"].doors == 5


def test_golf_trim_order(cars):
    golf = cars["vw-golf"]
    assert golf.trim_of("2.0 TSI R-Line 5dr") == "R-Line"  # not R
    assert golf.trim_of("2.0 TSI R DSG 4Motion Euro 6 (s/s) 5dr") == "R"
    assert golf.trim_of("1.4 TSI GT DSG Euro 5 5dr") == "GT"  # not GTI


def test_source_overrides(mini):
    car = mini.model_copy(update={"sources": {"autotrader": {"model": "Cooper"}}})
    assert car.for_source("autotrader").model == "Cooper"
    assert car.for_source("onlymini").model == "Hatch"
