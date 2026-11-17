# Build report — token-radar-01

Built 2026-11-18 (WITA) by a leaf builder subagent, in this repo dir only,
from the kit at `~/workspace/makefun/token-radar-01-kit/` (kept outside the
repo) and the requirements JSON. No registration, login, submission, or
account action was taken; phase 2 handles submission centrally.

## What was built

A token launch radar. `main.ts` (Node 22+, stdlib only) reads the sealed
DefiLlama snapshot, ranks every eligible pre-token protocol by the implied
value of its launch, and writes `board.json`, `data.js`, `dashboard/`,
`screenshots/` and `dossier.json` to the output directory.

- **Board scope (198 rows):** the snapshot's own watchlist rule applied to
  every protocol, not just the ones above the $50M floor — records no token
  (no mcap, no CoinGecko id, no symbol) and is not a wrapped/staked/bridged
  product (excluded categories, version-marked names, wrapped/staked/staking
  words, exchange-prefixed names). All 40 watchlist slugs are covered, plus
  138 early finds below the floor and 20 above-floor non-watchlist rows.
  The snapshot carries no `parentProtocol` field, so that part of the
  watchlist rule cannot be applied; this is stated on the dashboard.
- **Value model (`radar-2-calibrated`):** the base multiple is calibrated
  from the snapshot itself — the median mcap/TVL of live-token protocols
  (0.246x global, 119 comparables), per category shrunk toward the global
  median by comparable count — times growth (7d change clamped −50…+150%,
  half weight), tenure (log-scaled days running with no token, floor 0.55,
  4-year cap) and reach (+4% per extra chain, max 5). No protocol name is
  special-cased. The dashboard restates the formula, shows the calibration
  table, and offers a sandbox that re-ranks the board with adjusted weights.
- **Farm plans:** six steps per row, generated from each protocol's own
  record (category action, first chain, TVL-tier capital, age-based hold),
  every step carrying cost and time. The dashboard renders the same
  derivation, verified row-for-row against `board.json` (see evidence).
- **Dashboard:** static, no framework, no network — sortable/filterable
  board, per-protocol detail view with factor breakdown and farm-plan
  checklist, live-token benchmark view (kept off the ranked board), model
  and method view. Total dashboard source 45,126 bytes, so the judge reads
  it whole in the dossier (cap 65,536).

## Files

| Path | What |
| --- | --- |
| `main.ts` | Entrypoint: snapshot in, `/output` out, dossier written last |
| `lib/radar.ts` | Parsing, calibration, scoring, farm plans, board build, gate mirror |
| `vendor/makefun-board.ts` | The kit's dossier library, copied verbatim (required) |
| `dashboard/index.html` | Page shell, header, footer |
| `dashboard/styles.css` | Dark radar theme, one palette |
| `dashboard/radar.js` | Board, filters, detail, live view, model view, sandbox; mirrors the model and farm-plan derivation |
| `screenshots/1-board.jpg` | The board (1440×900, 157,864 bytes) |
| `screenshots/2-detail.jpg` | A protocol's detail view (1440×900, 218,825 bytes) |
| `screenshots/3-filtered.jpg` | A filtered view, category = Lending (1440×900, 149,540 bytes) |
| `LICENSE`, `README.md` | MIT license, run instructions |

Everything except `vendor/makefun-board.ts` is original work written in
this session; the starter was read for the interface contract only and its
code was not copied.

## The three screenshots — how produced

Rendered from the entry's own output in a local headless Chromium
(Playwright 1.64.1, Chromium 1248, viewport 1440×900, JPEG quality 90):

1. Built the output: `node main.ts --input <kit>/input/snapshot.json
   --output /tmp/radar-out2` (placeholder screenshots replaced afterwards
   only by re-running the same command; final output rebuilt from the
   committed screenshots — see gate evidence).
2. Served it locally: `python3 -m http.server` on 127.0.0.1, no network.
3. Captured with `/tmp/capture_shots.py` (kept outside the repo):
   `1-board.jpg` fresh load at scroll top; `2-detail.jpg` via the hash
   route `#/protocol/steakhouse-financial` (rank 1), detail scrolled into
   frame; `3-filtered.jpg` after selecting category `Lending` in the
   filter (count line reads "Showing 16 of 198").
4. Verified each file: JPEG magic, 1440×900 (long side ≤ 1440, short side
   ≥ 800), under the 512 KiB cap; viewed all three to confirm they show
   real rendered data, not placeholders.

Screenshot files in the repo: `screenshots/1-board.jpg`,
`screenshots/2-detail.jpg`, `screenshots/3-filtered.jpg`.

## Local grade / test evidence

There is no local grader for this competition (the scorer stays on the
server; `grade-local` refuses the kit). The published seven-row gate was
replicated in `/tmp/gate_check.mjs` (kept outside the repo) and run against
a fresh output directory. Result: **all 7 rows PASS**.

```
$ node main.ts --input <kit>/input/snapshot.json --output /tmp/radar-out2
token radar: 758 protocols scanned, 40 on the watchlist, 198 rows ranked (138 early, below the floor)
$ node /tmp/gate_check.mjs /tmp/radar-out2 <kit>/input/snapshot.json
PASS dashboard_files — 3 files, 45126 bytes, index.html=true css=true js=true
PASS board_file — 198 rows, 332005 bytes
PASS sorted_by_value — ranks 1..198: true, non-rising: true
PASS coverage — 40/40 watchlist slugs
PASS farm_steps — all rows 3..12 steps of 20..600 chars
PASS screenshots — 1-board.jpg 1440x900 157864B, 2-detail.jpg 1440x900 218825B, 3-filtered.jpg 1440x900 149540B
PASS dossier_matches — byte-identical=true, dossier 748436 bytes (cap 1572864), text 45402/65536 bytes
GATE: ALL 7 ROWS PASS
```

Dossier text holds the whole dashboard source (no cut marker; the text
ends with the complete `styles.css` fence).

Other checks, all passing:

- **Determinism:** two runs (different cwd, `--input` as file vs as
  directory) produce byte-identical output trees (`diff -r`, no differences).
- **Page/board parity (headless):** for all 198 rows, the dashboard's
  `impliedValueOf` recomputation matches `board.json` implied values and
  its `buildFarmPlan` output matches `board.json` farm steps exactly
  (0 mismatches). Search, category filter, row-click detail, live tab and
  model tab all exercised; zero console/page errors on the final build.
- **No-network rule:** no `http://` or `https://` string appears in any
  dashboard file (checked by the gate replica).
- **Runtime:** exit 0 in under 1 s locally on Node v24.22.1 (≥ 22.18
  required; a newer major counts). TypeScript uses erasable syntax only
  (no enums, namespaces, or parameter properties — grep-verified), as the
  grader's Node 22 type-stripping requires.
- **Docker:** the Docker daemon is not running in this sandbox
  (`docker images` fails: no `/var/run/docker.sock`), so the pinned-image
  grader command from the `run_completes` check could not be run here.
  Equivalence was established by direct execution: cwd-independent paths,
  `--input`/`--output` flags plus `MAKEFUN_OUTPUT_DIR`, deterministic
  output, exit 0, well inside the 120 s budget.

## Known gaps / limitations

- The gate replica is a re-implementation from the published rules, not
  the server's scorer; the server is the final word.
- Screenshot sizes (150–219 KB) sit below the rules' 300–350 KB guidance
  (a "keep", not a gate; the gate cap is 512 KiB each). Quality 90 JPEGs of
  this dark UI compress small; legibility was verified visually. The
  dossier total (748 KB) is comfortably under its 1.5 MiB cap.
- The model cannot apply the `parentProtocol` exclusion (field absent
  from the snapshot); the watchlist itself is always covered in full.
- One exploratory count differs by one (120 vs 119 live comparables)
  between scratch analysis and the entry's calibration; the entry is
  internally consistent — board, dashboard and calibration all use the
  same computed object.

## Phase 2 needs

- Commit sha: see below (fill in at commit time; the coordinator's report
  carries the final sha).
- README carries the competition badge only; the rank/reward badges need
  the GitHub `{owner}/{repo}`, and the repo About (description, homepage,
  topics `makefun,ai-agents,bounties,trading`) must be set at publish time
  per the requirements' `how_to_submit` template.
- `.makefun/owner.json` (`{"wallet": "<base58>"}`) must be added with the
  first published commit unless the repo owner is the account's GitHub
  login.
- Bundle the transcripts of the sessions that built this entry (this
  session); the kit's `check` command should be run before submitting.
- The repository must be created after the competition opened
  (2026-11-14T10:00:00Z) and be public at submission.
