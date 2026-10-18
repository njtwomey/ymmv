import pytest

from ymmv.schema import ListingRecord, engine_litres, first_int, normalise_fuel


@pytest.mark.parametrize(
    ("raw", "fuel"),
    [
        ("Petrol", "Petrol"),
        ("Diesel", "Diesel"),
        ("Petrol Plug-in Hybrid", "Plug-in Hybrid"),
        ("Petrol Hybrid", "Hybrid"),
        ("Hybrid", "Hybrid"),
        ("Electric", "Electric"),
        ("Bi Fuel", None),
        (None, None),
    ],
)
def test_normalise_fuel(raw, fuel):
    assert normalise_fuel(raw) == fuel


def test_record_normalises_site_values():
    rec = ListingRecord.model_validate(
        dict(
            source_id="x",
            fuel="Petrol Plug-in Hybrid",
            transmission="Steptronic",
            seller_type="private",
            colour="  dark GREY ",
            writeoff="Cat S",
            price_indicator="PI_GREAT",
        )
    )
    assert (rec.fuel, rec.transmission, rec.seller_type) == ("Plug-in Hybrid", "Automatic", "PRIVATE")
    assert (rec.colour, rec.writeoff, rec.price_indicator) == ("Dark Grey", "Cat S", "GREAT")


def test_record_drops_unknown_ratings():
    rec = ListingRecord.model_validate(dict(source_id="x", price_indicator="NOANALYSIS", writeoff=None))
    assert rec.price_indicator is None and rec.writeoff is None


def test_helpers():
    assert first_int("43,750 miles") == 43750
    assert first_int("£4,500") == 4500
    assert first_int(None) is None
    assert engine_litres("1.5 Cooper Euro 6") == 1.5
    assert engine_litres("Cooper") is None
