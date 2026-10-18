from bs4 import BeautifulSoup

from ymmv.sources.autotrader import parse_card as parse_autotrader
from ymmv.sources.onlymini import card_raw, matches
from ymmv.sources.onlymini import parse_card as parse_onlymini


def test_autotrader_card(autotrader_card, mini):
    rec = parse_autotrader(autotrader_card, mini, "Petrol", "Automatic")
    assert rec.variant == "2.0 Cooper S Classic Steptronic Euro 6 (s/s) 3dr"
    assert (rec.trim, rec.engine_l, rec.doors) == ("Cooper S", 2.0, 3)
    assert (rec.fuel, rec.transmission) == ("Petrol", "Automatic")  # from the search partition
    assert (rec.year, rec.plate, rec.mileage) == (2019, "19", 55000)
    assert rec.seller_type == "PRIVATE"
    assert rec.writeoff == "Cat S"
    assert rec.price_gbp and rec.price_gbp > 0
    assert rec.url == f"https://www.autotrader.co.uk/car-details/{rec.source_id}"


def test_onlymini_cards(onlymini_html, mini):
    items = BeautifulSoup(onlymini_html, "html.parser").select("li.cwSLVehicle")
    raws = [card_raw(li) for li in items]
    assert all(matches(r, mini) for r in raws)
    recs = [parse_onlymini(r, mini, distance=2) for r in raws]
    reserved, priced = recs
    assert reserved.reserved and reserved.price_gbp is None
    assert reserved.variant == "1.5 Cooper Auto Euro 6 (s/s) 3dr"
    assert (reserved.trim, reserved.transmission, reserved.colour) == ("Cooper", "Automatic", "Green")
    assert not priced.reserved and priced.price_gbp == 11490
    assert all(r.url and r.url.startswith("https://www.onlymini.co.uk/vehicle/") for r in recs)
    assert all(r.distance_miles == 2 and r.seller_type == "TRADE" for r in recs)
    assert all("vrm" not in r for r in raws)  # number plates aren't stored


def test_onlymini_rejects_other_models(onlymini_html, cars):
    raw = card_raw(BeautifulSoup(onlymini_html, "html.parser").select("li.cwSLVehicle")[0])
    assert not matches(raw, cars["mini-hatch-5dr"])  # it's a 3-door
    assert not matches(raw | {"model": "Clubman"}, cars["mini-hatch-3dr"])
