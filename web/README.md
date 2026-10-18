# ymmv-web

The YMMV dashboard: React + TypeScript (Vite), Tailwind v4 + shadcn/ui, lucide icons, and ECharts
for every chart. It reads the SQLite database the Python scrapers write. All filtering, statistics
and the regression run in the browser.

```sh
npm install
npm run dev          # http://localhost:5173
npm run build        # type-check + production bundle in dist/
npm run preview      # serve dist/ (the API works here too)
npm run lint         # oxlint
npm run typecheck    # tsc -b --noEmit
npm test             # vitest (formula parser, design matrix, OLS)
```

## Data and API

There is no separate backend. `server/api.ts` is a Vite plugin (dev and preview servers) that serves
`/api/*` from the database with Node's built-in `node:sqlite`, so there are no native modules to build.

- Database: `../db/ymmv.sqlite` relative to `web/`, or set `YMMV_DB=/path/to/file.sqlite`.
  The API never creates a database: if the file is missing it returns 503.
- `GET /api/meta`: cars, per-source counts, scrape runs.
- `GET /api/listings?car=<id>`: every listing for a car with its mark/note, number of
  sightings and first price (raw scraped JSON is never sent).
- `GET /api/listings/:id/history`: price/mileage per scrape sighting.
- `PUT /api/listings/:id/mark` with `{"mark": "interesting"|"want_more"|"contacted"|"rejected"|null, "note": "…"}`:
  the only write. It goes to the `marks` table, which the scrapers never touch. A running scrape
  holds the write lock between its commits, so a mark can briefly fail with "database is busy".

Reads open the database read-only with a busy timeout, so the app can stay open during a scrape.

## Using it

- **Filters** (left panel; a sheet on phones) apply to every tab and live in the URL, so a view can
  be bookmarked or shared. "Local area" sets which cars count as "near Bristol" (distance from the
  scrape postcode).
- **Overview**: price vs mileage (colour by any dimension) and price by year. Click a point to
  open the car.
- **Depreciation**: median price by age per trim with the middle-50% band.
- **Contrasts**: pick a dimension (seller, gearbox, fuel, trim, source, local, sold vs for sale,
  write-off, AutoTrader rating). It shows the raw curves by age and mileage, the mix of cars each
  group sells, and the like-for-like effect from the regression with 95% CIs.
- **Model**: edit the formula, then see coefficients, cross-validated error, predicted vs actual,
  AutoTrader's own price rating against this model's gap, and the "best value" list.
- **Listings**: sortable table with advert links and marks.
- **Sources**: per-source counts, other sources' cars against a model fitted on AutoTrader, and the
  scrape runs.
- The drawer (click any car) has the advert link, mark and notes, and price history.

## Model formulas

R-style (Wilkinson) formulas, parsed in `src/lib/formula.ts` and fitted by OLS in `src/lib/ols.ts`:

```
log(price) ~ age + I(age^2) + log1p(mileage) + C(engine_l) + trim + fuel + transmission + seller_type
```

Engine size is a factor in the default: within a MINI trim it mostly encodes the generation
(1.6 L = R56, 2007–14; 1.5/2.0 L = F56, 2014+), so a per-litre slope would be misleading.

| syntax | meaning |
|---|---|
| `a + b` | add terms |
| `a - b`, `- 1`, `0 +` | remove terms / drop the intercept |
| `a:b`, `a * b` | interaction; `a * b` = `a + b + a:b` (`:` binds tighter) |
| `log() log1p() sqrt() exp() abs()` | transforms |
| `I(expr)` | arithmetic inside a term: `I(age^2)`, `I(mileage / 1000)` |
| `C(x)`, `C(x, "Level")` | categorical, optionally with a reference level; works on numbers too (`C(engine_l)` → levels `1.5`, `2.0`) |

Text columns are categorical automatically, using dummy coding against the most common level.
Levels or terms that don't vary after filtering are dropped, and so are exactly collinear columns,
each with a warning. With a `log`/`log1p`/`sqrt` response, predictions are back-transformed to £.
After a log transform that's the median, not the mean.

Columns: `price` (alias of `price_gbp`), `age`, `year`, `mileage`, `engine_l`, `trim`, `fuel`,
`transmission`, `seller_type`, `source`, `local`, `state`, `writeoff` (`none` when clean),
`is_writeoff`, `rating` (AutoTrader's price rating), `colour`, `distance_miles`, `doors`,
`body_type`, `condition`.

## Layout

```
server/api.ts          Vite plugin: the /api endpoints
src/App.tsx            data loading, URL state, the model fit, layout
src/lib/               types, filters (+URL), formula parser, OLS + t distribution, model/CV,
                       stats, chart theme tokens, series builders, formatting
src/components/        header, filters panel, KPIs, drawer, marks, chart wrapper, tabs/*
src/components/ui/     shadcn/ui components (generated; not linted)
```

The app name lives in `src/lib/config.ts` (`APP_NAME`).
