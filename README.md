# ymmv

*Your mileage may vary.* Track UK used-car prices across sites: scrape listings
into SQLite, then explore them in a web app with filters, contrasts and a
regression model you write as an R-style formula.

```
make                     # scrape the 3-door MINI Hatch from every source
make dev                 # run the web app (http://localhost:5173)
make check               # lint + typecheck + tests, Python and web
make db-snapshot         # save the database as SQL text in db/snapshot (tracked by git)
make site                # build the read-only published site (what GitHub Pages serves)
make help                # all targets

uv run scrape --source autotrader --car mini-hatch-3dr        # one source
uv run scrape --source onlymini --car mini-hatch-3dr --car mini-hatch-5dr
uv run ymmv cars                                              # cars defined in cars.yaml
uv run ymmv status                                            # runs and counts
```

Every command and option is documented in `--help` (pydantic-settings CLI).

## Cars and sources are separate

- **A car** is defined once in [`cars.yaml`](cars.yaml): make, model, optional doors
  and body type, and optional trim patterns that group variant text into trim families.
- **A source** is a site adapter in `src/ymmv/sources/`. It turns a car into that
  site's searches and maps what the site shows onto the **standard listing schema**
  (`src/ymmv/schema.py`): variant, trim, engine, fuel, gearbox, doors, body, colour,
  year, plate, mileage, seller type, location, distance, price, reserved.
  Fuel, gearbox and seller values are normalised, so listings from different
  sites can be compared directly.

| source | what | cars |
|---|---|---|
| `autotrader` | AutoTrader UK, whole country, distance from `--postcode` | any make/model |
| `onlymini` | Only Mini, Bristol MINI specialist (BS3 5RU), incl. reserved cars | MINIs only |

To add a car, add a table to `cars.yaml`. To add a site, subclass `Source`
(`sources/base.py`: implement `listings(car)`, optionally `unsupported(car)`) and
register it in `sources/__init__.py`.

## How the data works

- **AutoTrader** search cards don't show fuel or gearbox. For each car the scraper
  asks AutoTrader for that car's fuel-type and transmission values, searches each
  combination separately, and tags the cards. A combination over AutoTrader's
  100-page cap is split by year.
- **Sold** is inferred. After a *complete* scrape of a source for a car, adverts
  it no longer finds are marked `delisted`, with their last asking price kept.
  That's a proxy: cars are also withdrawn, and usually sell below asking. So sold
  data builds up only if you scrape regularly.
- Every sighting keeps the raw source data (`observations.raw`), so fields can be
  re-derived later without scraping again.
- **Marks** (interesting / want more / contacted / rejected, plus a note) are
  written by the web app to their own table. Scrapes never touch them.

## Layout

```
Makefile                  scrape / dev / check / migrate / ...
cars.yaml                 car definitions
src/ymmv/
  cli.py                  `ymmv` and `scrape` commands
  cars.py                 Car model + cars.yaml loader
  schema.py               the standard ListingRecord + normalisers
  sources/                base.py, autotrader.py, onlymini.py, registry
  db.py                   SQLAlchemy models, record/delist logic, auto-migrate
  migrations/             Alembic (0001 baseline, 0002 cars/marks/standard schema)
  geo.py                  postcode distances (postcodes.io)
tests/                    pytest
web/                      React + shadcn + Tailwind + ECharts app (reads the DB, writes marks)
db/snapshot/              the data as SQL text (tracked); db/ymmv.sqlite is built from it
```

## Database, snapshots and migrations

Git tracks the data as SQL text in `db/snapshot/`, not the SQLite file:

```
db/snapshot/tables.sql     the schema (CREATE TABLE / CREATE INDEX)
db/snapshot/{table}.sql    one INSERT per row, in primary-key order
```

`db/ymmv.sqlite` is a local, git-ignored build of that. If it's missing, any `ymmv`
command (and `make install`) rebuilds it from the snapshot and then applies newer
migrations. Values are escaped by SQLite and rows written in a fixed order, so an
unchanged table gives an identical file and `git diff` shows exactly which rows a
scrape, mark or erratum changed.

```
make db-snapshot           # write db/snapshot from db/ymmv.sqlite (do this before committing data)
make db-restore FORCE=1    # rebuild db/ymmv.sqlite from db/snapshot, replacing the local one
```

The schema is managed with Alembic, and every command upgrades the database
automatically (`make migrate` does just that). To change the schema: edit the models
in `db.py`, add a revision in `src/ymmv/migrations/versions/` (copy the style of
0005), and run `make check`. A test applies every migration to an empty database
and checks the result matches the models; another round-trips a snapshot exactly.

**Errata** correct individual listing fields with a before/after, reason and evidence
(`uv run ymmv errata add | show | revert`). The listings table shows corrected values,
the raw scraped data never changes, and scrapes re-apply a fix only while the source
still shows the old value.

## Published site

The read-only site at **nialltwomey.com/ymmv** is built and deployed by GitHub Actions
(`.github/workflows/pages.yml`) on every push to `main`. It has no server: the build
rebuilds a throwaway database from `db/snapshot/*.sql` and exports the same JSON the
dev API serves (`web/scripts/export-static.ts`, sharing `web/server/queries.ts`), so
the snapshot stays the single source of truth and no JSON is committed. Modelling,
Optimise and SHAP all run in the browser; marking and saving models need the local app.
`make site` builds the same thing into `web/dist`.

To update the site: scrape / mark / correct locally, `make db-snapshot`, commit, push.

## uv workspace note

`~/scratch` is a uv workspace and this project is a member, so the two share
`~/scratch/.venv`. `make install` runs `uv sync --all-packages` from there. A plain
`uv sync` inside this directory removes the root project's packages; `uv run` is always safe.
