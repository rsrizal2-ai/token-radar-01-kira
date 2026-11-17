// Token Radar's entrypoint (Node 22, standard library only).
//
// Reads the sealed snapshot, scores every eligible pre-token protocol with
// the calibrated model in lib/radar.ts, and writes the grader's /output:
//
//   board.json    the ranked board (rows, with farm plans and factor breakdowns)
//   data.js       the dashboard's dataset, written beside the page
//   dashboard/    this repository's dashboard/, copied whole
//   screenshots/  this repository's screenshots/, copied whole (3 images)
//   dossier.json  the judge's dossier, written last with the kit's library
//
// The dossier is byte-compared by the scorer against what buildDossier
// writes from the same /output, so it is always written after every other
// file. The run is deterministic: same snapshot in, same bytes out — no
// clock, no randomness, no network.
//
// Local run (outside the grader's container):
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <snapshot.json>

import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, buildPayload, dataScript, parseSnapshot } from './lib/radar.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const REPO_ROOT = fileURLToPath(new URL('.', import.meta.url));

/** The scorer's own caps, from the published gate: the text cap shapes the dossier's bytes. */
const DOSSIER_TEXT_MAX_BYTES = 65_536;
const SCREENSHOT_LIMIT = { max: 4, max_bytes: 524_288 };
const DASHBOARD_LIMIT = { max_files: 400, max_bytes: 4_194_304 };
const SCREENSHOT_NAME = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

/** The value of `--name <value>` / `--name=<value>`, or the fallback. */
function flag(name: string, fallback: string): string {
  const argv = process.argv;
  const at = argv.indexOf(`--${name}`);
  if (at >= 0 && at + 1 < argv.length) return argv[at + 1]!;
  const joined = argv.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

const inputArg = flag('input', '/input');
const inputFile = inputArg.endsWith('.json') ? inputArg : join(inputArg, 'snapshot.json');
if (!existsSync(inputFile)) {
  fail(
    `no snapshot at ${inputFile}: pass --input <snapshot.json|directory> or mount the sealed /input`,
  );
}
const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(inputFile, 'utf8'));
const { board, payload } = buildPayload(snapshot);
const issue = boardIssue(board, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ rows: board })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(payload));

/** Copy one directory's regular files into `to`, skipping dotfiles, and name what was copied. */
function copyDir(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const name of readdirSync(from).sort()) {
    if (name.startsWith('.')) continue;
    const path = join(from, name);
    if (!statSync(path).isFile()) continue;
    copyFileSync(path, join(to, name));
    copied.push(name);
  }
  return copied;
}

const dashboardFiles = copyDir(join(REPO_ROOT, 'dashboard'), join(outDir, 'dashboard'));
const shots = copyDir(join(REPO_ROOT, 'screenshots'), join(outDir, 'screenshots'));
if (shots.length < 3) {
  fail(
    `screenshots/ holds ${shots.length} image${shots.length === 1 ? '' : 's'}: hand in 3 — the board, a detail view and a filtered view`,
  );
}
for (const name of shots) {
  if (!SCREENSHOT_NAME.test(name)) {
    fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  }
}

// The dossier is written last: the scorer rebuilds it from this /output and compares bytes.
writeFileSync(
  join(outDir, 'dossier.json'),
  buildDossier(outDir, {
    text_max_bytes: DOSSIER_TEXT_MAX_BYTES,
    screenshots: SCREENSHOT_LIMIT,
    dashboard: DASHBOARD_LIMIT,
  }),
);

process.stdout.write(
  `token radar: ${snapshot.protocols.length} protocols scanned, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows ranked (${payload.early_size} early, below the floor)\n` +
    `token radar: wrote ${join(outDir, 'board.json')}, ${join(outDir, 'data.js')}, ` +
    `${join(outDir, 'dashboard')} (${dashboardFiles.length} files), ` +
    `${join(outDir, 'screenshots')} (${shots.length} images) and ${join(outDir, 'dossier.json')}\n`,
);
