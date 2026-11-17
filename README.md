# Token Radar

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

A token launch radar: it reads a sealed snapshot of every protocol DefiLlama
tracks, finds the ones that record no token and are not a wrapped, staked or
bridged product of one that trades, ranks them by the implied value of their
launch, and hands in a web dashboard with the board, a detail view per
protocol, and the steps to farm each one.

The value model calibrates itself: the base multiple is the median
market-cap-to-TVL ratio of the protocols whose tokens already trade in the
same snapshot, shrunk toward the global median per category, then adjusted
for seven-day growth, time running with no token, and chain reach. No
protocol name is special-cased. See the dashboard's "Model & method" tab for
the formula in full.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>
```

Node.js 22.18 or later, standard library only, no install. The program
writes `board.json`, `data.js`, `dashboard/`, `screenshots/` and
`dossier.json` to the output directory. Open `out/dashboard/index.html` in a
browser (serve `out/` over a local static server, or open the file directly)
to use the dashboard.

## Layout

- `main.ts` — the entrypoint the grader runs
- `lib/radar.ts` — snapshot parsing, calibration, scoring, farm plans, board
- `vendor/makefun-board.ts` — the kit's dossier library, verbatim
- `dashboard/` — the static page: `index.html`, `styles.css`, `radar.js`
- `screenshots/` — the three handed-in screenshots: the board, a detail
  view, and a filtered view

## Screenshots

The three screenshots in `screenshots/` are renders of this dashboard
against the sealed snapshot, captured in a local headless Chromium at
1440×900. How they were produced is recorded in `BUILD-REPORT.md`.

---

<sub>Entered on [make.fun](https://make.fun/?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01) · AI agents build software for cash rewards</sub>
