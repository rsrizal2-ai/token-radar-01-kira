// Token Radar — the ranking model.
//
// One sealed DefiLlama snapshot goes in, one ranked board comes out. Every
// number on the board is derived from the snapshot's own figures; no protocol
// name is ever special-cased, so the same code scores a protocol that does not
// exist yet the day the snapshot is refreshed.
//
// The board's scope applies the snapshot's own watchlist rule to every
// protocol, not just the ones above the floor: a row must record no token
// (no market cap, no CoinGecko id, no symbol) and must not be a wrapped,
// staked or bridged product of a token that already trades. The watchlist
// itself is always covered in full, whatever the rule says.
//
// The value model calibrates itself against the protocols whose tokens
// already trade. The market's own verdict — the median market-cap-to-TVL
// ratio of live-token protocols — becomes the base multiple, shrunk toward
// the global median when a category has few live comparables:
//
//   multiple  = category median mcap/TVL, shrunk toward the global median
//   growth    = 1 + clamp(change_7d, -50, 150) / 100 * 0.5
//   tenure    = 0.55 + 0.45 * ln(1 + min(age_days, 1460)) / ln(1461)
//   reach     = 1 + 0.04 * min(max(chains - 1, 0), 5)
//   implied   = max(1, round(tvl_usd * multiple * growth * tenure * reach))
//
// Growth rewards momentum without letting one hot week dominate. Tenure
// rewards a long tokenless track record with diminishing returns: a protocol
// that has run for years with no token recorded has more built-up launch
// value than one listed last month. Reach rewards a presence on several
// chains. A protocol with no reported age is scored as one year old, and a
// protocol with no reported 7-day change is scored as flat; both fallbacks
// are stated on the dashboard.
//
// Farm plans are generated from each protocol's own record (category, first
// chain, TVL tier, age). They are the same derivation the dashboard renders,
// so the page and board.json can never disagree.

/** One protocol entry: exactly the ten fields the sealed snapshot carries. */
export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

/** The market calibration: live-token mcap/TVL medians, global and per category. */
export interface Calibration {
  /** Median mcap/TVL across every live-token protocol used for calibration. */
  global_multiple: number;
  /** How many live-token protocols fed the global median. */
  live_count: number;
  /** Per-category medians: category -> { median, count }. */
  by_category: Record<string, { median: number; count: number }>;
}

/** The model's tunable weights, stated on the dashboard and adjustable in its sandbox. */
export interface ModelWeights {
  growth_weight: number;
  growth_floor: number;
  growth_cap: number;
  tenure_floor: number;
  tenure_cap_days: number;
  unknown_age_days: number;
  reach_per_chain: number;
  reach_max_chains: number;
}

export const WEIGHTS: ModelWeights = {
  growth_weight: 0.5,
  growth_floor: -50,
  growth_cap: 150,
  tenure_floor: 0.55,
  tenure_cap_days: 1460,
  unknown_age_days: 365,
  reach_per_chain: 0.04,
  reach_max_chains: 5,
};

export const MODEL_VERSION = 'radar-2-calibrated';

/** How many live-token protocols the dashboard's benchmark view carries. */
export const LIVE_ROWS = 30;

/** The five factors behind one row's implied value, for the detail view. */
export interface Factors {
  multiple: number;
  growth_pct: number;
  growth_factor: number;
  tenure_factor: number;
  reach_factor: number;
  age_days: number | null;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  factors: Factors;
  farm_steps: string[];
}

/** A live-token protocol, shown at market value — never ranked. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  mcap_tvl_ratio: number | null;
}

/** One compact dashboard row: the board row minus the token fields the page never shows. */
export interface DashboardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  listed_at: string | null;
  on_watchlist: boolean;
  age_days: number | null;
  implied_value_usd: number;
  factors: Factors;
}

/** Everything the dashboard needs, written to data.js beside the page. */
export interface RadarPayload {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  weights: ModelWeights;
  calibration: Calibration;
  scanned: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  rows: DashboardRow[];
  live: LiveRow[];
}

/** Why the snapshot cannot be scored. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;
const VERSION_MARKER = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCLUDED_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);
const EXCHANGE_PREFIXES = [
  'Binance',
  'Coinbase',
  'Bybit',
  'Kraken',
  'Bitget',
  'OKX',
  'Bitfinex',
  'Gemini',
];

/** Whole days from `listedAt` to `asOf`, clamped at zero; null when either date is missing or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const start = Date.parse(`${listedAt}T00:00:00Z`);
  const end = Date.parse(`${asOf}T00:00:00Z`);
  if (!Number.isFinite(start) || !Number.isFinite(end)) return null;
  return Math.max(0, Math.floor((end - start) / DAY_MS));
}

/** The median of a non-empty list of finite numbers. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function round4(n: number): number {
  return Math.round(n * 1e4) / 1e4;
}

/** Whether the record shows no token at all: no market cap, no CoinGecko id, no symbol. */
export function recordsNoToken(p: Protocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether the protocol looks like a wrapped, staked or bridged product of a
 * token that already trades: an excluded category, a versioned name, a
 * wrapped/staked word in the name, or an exchange-prefixed name. This is the
 * watchlist's own rule, minus the parent-protocol test the snapshot does not
 * carry (DefiLlama's parentProtocol is not one of its ten fields).
 */
export function isWrappedOrStakedProduct(p: Protocol): boolean {
  if (p.category !== null && EXCLUDED_CATEGORIES.has(p.category)) return true;
  if (VERSION_MARKER.test(p.name)) return true;
  if (WRAPPED_WORD.test(p.name)) return true;
  return EXCHANGE_PREFIXES.some((prefix) => p.name.startsWith(prefix));
}

/** Whether a protocol belongs on the ranked board. */
export function isBoardEligible(p: Protocol): boolean {
  return recordsNoToken(p) && !isWrappedOrStakedProduct(p);
}

/**
 * Calibrate the base multiple from the protocols whose tokens already trade:
 * the median market-cap-to-TVL ratio, globally and per category. Centralised
 * exchanges are left out — their token economics are not a protocol's — and
 * only records with a positive market cap and TVL count.
 */
export function calibrate(protocols: Protocol[]): Calibration {
  const live = protocols.filter(
    (p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0 && p.category !== 'CEX',
  );
  const ratios = live.map((p) => p.mcap_usd! / p.tvl_usd);
  const byCategory: Record<string, { median: number; count: number }> = {};
  const grouped = new Map<string, number[]>();
  for (const p of live) {
    if (p.category === null) continue;
    const list = grouped.get(p.category) ?? [];
    list.push(p.mcap_usd! / p.tvl_usd);
    grouped.set(p.category, list);
  }
  for (const [category, list] of [...grouped.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    byCategory[category] = { median: round4(median(list)), count: list.length };
  }
  return {
    global_multiple: ratios.length > 0 ? round4(median(ratios)) : 0.25,
    live_count: live.length,
    by_category: byCategory,
  };
}

/**
 * The base multiple for one category: its live median shrunk toward the
 * global median. Five or more comparables earn a half weight, two to four a
 * quarter weight, fewer than two none — a thin category must not set its
 * own price.
 */
export function multipleFor(category: string | null, calibration: Calibration): number {
  const entry = category === null ? undefined : calibration.by_category[category];
  if (entry === undefined) return calibration.global_multiple;
  const weight = entry.count >= 5 ? 0.5 : entry.count >= 2 ? 0.25 : 0;
  return round4(weight * entry.median + (1 - weight) * calibration.global_multiple);
}

/** The five factors and the implied value one protocol gets. */
export function scoreProtocol(
  p: Protocol,
  asOf: string,
  calibration: Calibration,
  weights: ModelWeights = WEIGHTS,
): { implied: number; factors: Factors } {
  const age = ageDays(asOf, p.listed_at);
  const rawGrowth = typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : 0;
  const growthPct = Math.min(weights.growth_cap, Math.max(weights.growth_floor, rawGrowth));
  const growthFactor = 1 + (growthPct / 100) * weights.growth_weight;
  const ageUsed = age ?? weights.unknown_age_days;
  const cappedAge = Math.min(Math.max(ageUsed, 0), weights.tenure_cap_days);
  const tenureFactor =
    weights.tenure_floor +
    (1 - weights.tenure_floor) * (Math.log1p(cappedAge) / Math.log1p(weights.tenure_cap_days));
  const extraChains = Math.min(Math.max(p.chains.length - 1, 0), weights.reach_max_chains);
  const reachFactor = 1 + weights.reach_per_chain * extraChains;
  const multiple = multipleFor(p.category, calibration);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * growthFactor * tenureFactor * reachFactor));
  return {
    implied,
    factors: {
      multiple,
      growth_pct: round4(growthPct),
      growth_factor: round4(growthFactor),
      tenure_factor: round4(tenureFactor),
      reach_factor: round4(reachFactor),
      age_days: age,
    },
  };
}

/** The ranked board: every eligible protocol, watchlist first-class, strongest first. */
export function buildBoard(snapshot: Snapshot, calibration: Calibration): BoardRow[] {
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const chosen = new Map<string, Protocol>();
  // The watchlist is the floor: every slug it names is on the board, even if
  // the eligibility rule would set it aside.
  for (const slug of snapshot.watchlist) {
    const p = bySlug.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isBoardEligible(p)) chosen.set(p.slug, p);
  }
  const watchlist = new Set(snapshot.watchlist);
  const scored = [...chosen.values()].map((p) => {
    const { implied, factors } = scoreProtocol(p, snapshot.as_of, calibration);
    return { p, implied, factors };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => ({
    rank: i + 1,
    slug: s.p.slug,
    name: s.p.name,
    category: s.p.category,
    chains: s.p.chains,
    tvl_usd: s.p.tvl_usd,
    change_7d: s.p.change_7d,
    mcap_usd: s.p.mcap_usd,
    listed_at: s.p.listed_at,
    gecko_id: s.p.gecko_id,
    symbol: s.p.symbol,
    token_status: 'pre-token' as const,
    on_watchlist: watchlist.has(s.p.slug),
    age_days: s.factors.age_days,
    implied_value_usd: s.implied,
    factors: s.factors,
    farm_steps: farmPlan(s.p, s.factors.age_days),
  }));
}

/** The live-token benchmark: the market's own values, kept off the ranked board. */
export function buildLiveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !recordsNoToken(p) && p.category !== 'CEX')
    .sort(
      (a, b) =>
        (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) ||
        b.tvl_usd - a.tvl_usd ||
        (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0),
    )
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      mcap_tvl_ratio:
        p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildPayload(snapshot: Snapshot): { board: BoardRow[]; payload: RadarPayload } {
  const calibration = calibrate(snapshot.protocols);
  const board = buildBoard(snapshot, calibration);
  const live = buildLiveRows(snapshot);
  const payload: RadarPayload = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    weights: WEIGHTS,
    calibration,
    scanned: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !r.on_watchlist && r.tvl_usd < snapshot.floor_usd).length,
    live_size: live.length,
    rows: board.map((r) => ({
      rank: r.rank,
      slug: r.slug,
      name: r.name,
      category: r.category,
      chains: r.chains,
      tvl_usd: r.tvl_usd,
      change_7d: r.change_7d,
      listed_at: r.listed_at,
      on_watchlist: r.on_watchlist,
      age_days: r.age_days,
      implied_value_usd: r.implied_value_usd,
      factors: r.factors,
    })),
    live,
  };
  return { board, payload };
}

// --------------------------------------------------------------- farm plans

/** The first chain a protocol names, or a neutral phrase when it names none. */
function homeChain(p: Protocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** The farm's working capital, sized to the protocol's TVL tier. */
function capitalFor(p: Protocol): number {
  if (p.tvl_usd >= 1_000_000_000) return 200;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get longer to prove the position. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 60;
  if (age < 90) return 90;
  if (age < 365) return 60;
  return 30;
}

/** A plain-language gas expectation for the home chain. */
function gasNote(chain: string): string {
  const c = chain.toLowerCase();
  if (c.includes('solana')) return 'under $1 of gas in total';
  if (c.includes('ethereum')) return 'about $6 to $12 of gas';
  if (
    c.includes('arbitrum') ||
    c.includes('optimism') ||
    c.includes('base') ||
    c.includes('polygon') ||
    c.includes('blast') ||
    c.includes('linea') ||
    c.includes('scroll') ||
    c.includes('zksync') ||
    c.includes('mantle') ||
    c.includes('mode')
  )
    return 'about $1 to $3 of gas';
  if (c.includes('bitcoin') || c.includes('binance') || c.includes('bsc')) return 'about $1 to $2 of gas';
  return 'about $2 to $4 of gas';
}

/** The category's core action, in words a farmer can follow. */
function coreAction(p: Protocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateralised') || c.includes('collateralized'))
    return `Supply $${capital} of USDC to ${name} on ${chain}, then borrow a small amount against it and repay it once.`;
  if (c.includes('dex') || c.includes('exchange'))
    return `Provide $${capital} of liquidity to ${name}'s deepest pool on ${chain} and leave the position in range.`;
  if (c.includes('yield aggregator') || c.includes('leveraged farm'))
    return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and hold the vault shares.`;
  if (c.includes('yield') || c.includes('farm'))
    return `Deposit $${capital} into ${name}'s main yield position on ${chain} and let the rewards accrue.`;
  if (c.includes('curator') || c.includes('allocator') || c.includes('vault'))
    return `Deposit $${capital} into a ${name} vault on ${chain} and keep the receipt tokens in the wallet.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options'))
    return `Deposit $${capital} of USDC as margin on ${name} and open one small hedged position, then close it.`;
  if (c.includes('bridge'))
    return `Bridge $${capital} of USDC through ${name} to ${chain} and use the bridged funds inside its app.`;
  if (c.includes('staking') || c.includes('restak'))
    return `Stake $${capital} through ${name} on ${chain} and keep the staking receipt in the wallet.`;
  if (c.includes('stable') || c.includes('rwa'))
    return `Mint or buy $${capital} of ${name}'s asset on ${chain} and hold it in the farming wallet.`;
  if (c.includes('prediction'))
    return `Fund the wallet with $${capital} and take one small position in an active ${name} market.`;
  if (c.includes('insurance') || c.includes('cover'))
    return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy active.`;
  if (c.includes('chain') || c.includes('infrastructure'))
    return `Use ${name} on ${chain} with $${capital}: run one real transaction a week through its app.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/**
 * A protocol's farm plan: six steps, each carrying what it costs and how
 * long it takes. Derived only from the protocol's own record — category,
 * chains, TVL and age — never from a hand-written list of names. The
 * dashboard renders this same derivation, so the page and board.json agree.
 */
export function farmPlan(p: Protocol, age: number | null): string[] {
  const chain = homeChain(p);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const gas = gasNote(chain);
  const steps = [
    `Set up a fresh wallet that holds only the funds you plan to farm, write its seed phrase on paper, and keep it offline. Cost: ${gas} for the first transaction. Time: 5 minutes.`,
    `${coreAction(p, capital, chain)} Cost: $${capital} of capital plus ${gas}. Time: 15 minutes to set up.`,
    `Return once a week and make one real qualifying action — a deposit, a swap, a borrow, a vote — so the wallet shows repeat use, not one visit. Cost: about $2 of gas a week. Time: 10 minutes a week.`,
    `Hold the position for at least ${hold} days so the activity lands in more than one snapshot window, and do not empty the wallet between visits. Cost: the $${capital} stays in the position. Time: ${hold} days.`,
    `Before claiming anything, open the protocol's own points or rewards page from its official site and claim only from the link it publishes; never pay a fee to claim and never sign a blind approval. Cost: nothing to check. Time: 10 minutes.`,
    `Log the wallet address, the dates and every transaction hash in a farm notebook, and set your unwind rule now: what you will sell, what you will keep, and when. Cost: nothing but the log. Time: 5 minutes.`,
  ];
  return steps.map((s) => (s.length > 600 ? `${s.slice(0, 596)}...` : s));
}

// ------------------------------------------------------------ parsing, gate

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new SnapshotError('snapshot.json is not a JSON object');
  }
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) {
    throw new SnapshotError('snapshot.json has no as_of date');
  }
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) {
    throw new SnapshotError('snapshot.json has no floor_usd');
  }
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) {
    throw new SnapshotError('snapshot.json has no watchlist of slugs');
  }
  const protocols: Protocol[] = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) {
      throw new SnapshotError(`snapshot.json protocol ${i} is not an object`);
    }
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/**
 * Why a board is not one the gate will take, or null. Mirrors the published
 * gate: size, coverage, ranks, order, distinct values, farm steps, and
 * slugs that exist in the snapshot.
 */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100 to 4000`;
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  for (const r of board) {
    if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
    if (seen.has(r.slug)) return `${r.slug} appears twice`;
    seen.add(r.slug);
    if (typeof r.name !== 'string' || r.name.length === 0) return `${r.slug} has no name`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const trimmed = s.trim();
      if (trimmed.length < 20 || trimmed.length > 600) return `${r.slug} has a farm step of ${trimmed.length} characters`;
    }
  }
  const missing = snapshot.watchlist.filter((s) => !seen.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) {
    if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  }
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) {
      return `rank ${byRank[i]!.rank} outranks rank ${byRank[i - 1]!.rank} on implied value`;
    }
  }
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) {
    return 'every row shares the same implied value: a board that ranks nothing by value is not a ranking';
  }
  return null;
}

/** The dashboard's dataset as one script: no fetch, no network. */
export function dataScript(payload: RadarPayload): string {
  return `window.RADAR=${JSON.stringify(payload)};\n`;
}
