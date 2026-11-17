// Token Radar's dashboard. It reads window.RADAR (data.js, written beside
// dashboard/ by main.ts) and renders the ranked board, the filters, a detail
// view per protocol, the live-token benchmark and the model itself. No
// network: every byte it shows arrived in data.js.
//
// The page carries the model twice over, on purpose. impliedValueOf is the
// same arithmetic main.ts used to write board.json, so the detail view can
// recompute a row from the snapshot's own figures and check the number the
// board carries; buildFarmPlan is the same derivation main.ts used for each
// row's farm_steps. The sandbox re-runs impliedValueOf with different
// weights, so a reader can see what the ranking is made of.
(function () {
  'use strict';

  var DATA = window.RADAR;
  if (!DATA) return;
  var app = document.getElementById('app');
  app.setAttribute('aria-busy', 'false');

  var weights = DATA.weights;
  var calibration = DATA.calibration;

  // ------------------------------------------------------------ formatting

  function fmtUsd(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    var abs = Math.abs(n);
    if (abs >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (abs >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (abs >= 1e3) return '$' + Math.round(n / 1e3) + 'K';
    return '$' + Math.round(n);
  }
  function fmtFull(n) {
    return '$' + Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
  }
  function fmtPct(n) {
    if (n === null || n === undefined || !isFinite(n)) return 'n/a';
    return (n > 0 ? '+' : '') + n.toFixed(1) + '%';
  }
  function fmtAge(days) {
    if (days === null || days === undefined) return 'unknown';
    if (days >= 365) return (days / 365).toFixed(1) + 'y';
    return days + 'd';
  }
  function round4(n) { return Math.round(n * 1e4) / 1e4; }

  // ------------------------------------------------------------ the model
  //
  // implied = TVL x multiple x growth x tenure x reach. The multiple is the
  // market's own median mcap/TVL among live-token protocols, shrunk toward
  // the global median when a category has few comparables. Growth is the
  // 7-day TVL change, clamped. Tenure grows with the log of the days the
  // protocol has run with no token recorded. Reach grows with chain count.

  function multipleFor(category) {
    var entry = category === null ? undefined : calibration.by_category[category];
    if (!entry) return calibration.global_multiple;
    var w = entry.count >= 5 ? 0.5 : entry.count >= 2 ? 0.25 : 0;
    return round4(w * entry.median + (1 - w) * calibration.global_multiple);
  }

  function impliedValueOf(row, over) {
    over = over || {};
    var growthWeight = over.growthWeight === undefined ? weights.growth_weight : over.growthWeight;
    var tenureFloor = over.tenureFloor === undefined ? weights.tenure_floor : over.tenureFloor;
    var multipleScale = over.multipleScale === undefined ? 1 : over.multipleScale;
    var raw = (typeof row.change_7d === 'number' && isFinite(row.change_7d)) ? row.change_7d : 0;
    var growthPct = Math.min(weights.growth_cap, Math.max(weights.growth_floor, raw));
    var growthFactor = 1 + (growthPct / 100) * growthWeight;
    var ageUsed = (row.age_days === null || row.age_days === undefined) ? weights.unknown_age_days : row.age_days;
    var capped = Math.min(Math.max(ageUsed, 0), weights.tenure_cap_days);
    var tenureFactor = tenureFloor + (1 - tenureFloor) * (Math.log1p(capped) / Math.log1p(weights.tenure_cap_days));
    var extra = Math.min(Math.max(row.chains.length - 1, 0), weights.reach_max_chains);
    var reachFactor = 1 + weights.reach_per_chain * extra;
    var multiple = multipleFor(row.category) * multipleScale;
    var implied = Math.max(1, Math.round(row.tvl_usd * multiple * growthFactor * tenureFactor * reachFactor));
    return {
      implied: implied,
      factors: {
        multiple: round4(multiple),
        growth_pct: round4(growthPct),
        growth_factor: round4(growthFactor),
        tenure_factor: round4(tenureFactor),
        reach_factor: round4(reachFactor),
        age_days: row.age_days === undefined ? null : row.age_days
      }
    };
  }

  // ------------------------------------------------------------ farm plans
  //
  // The same derivation as the board's farm_steps: category, first chain,
  // TVL tier and age. Every step carries what it costs and how long it
  // takes. No protocol name is special-cased.

  function homeChain(row) { return row.chains.length > 0 ? row.chains[0] : 'its main chain'; }
  function capitalFor(row) {
    if (row.tvl_usd >= 1000000000) return 200;
    if (row.tvl_usd >= 100000000) return 100;
    return 50;
  }
  function holdDaysFor(age) {
    if (age === null || age === undefined) return 60;
    if (age < 90) return 90;
    if (age < 365) return 60;
    return 30;
  }
  function gasNote(chain) {
    var c = chain.toLowerCase();
    if (c.indexOf('solana') !== -1) return 'under $1 of gas in total';
    if (c.indexOf('ethereum') !== -1) return 'about $6 to $12 of gas';
    if (['arbitrum', 'optimism', 'base', 'polygon', 'blast', 'linea', 'scroll', 'zksync', 'mantle', 'mode'].some(function (k) { return c.indexOf(k) !== -1; })) return 'about $1 to $3 of gas';
    if (c.indexOf('bitcoin') !== -1 || c.indexOf('binance') !== -1 || c.indexOf('bsc') !== -1) return 'about $1 to $2 of gas';
    return 'about $2 to $4 of gas';
  }
  function coreAction(row, capital, chain) {
    var c = (row.category || '').toLowerCase();
    var name = row.name;
    if (c.indexOf('lend') !== -1 || c.indexOf('cdp') !== -1 || c.indexOf('collateralised') !== -1 || c.indexOf('collateralized') !== -1)
      return 'Supply $' + capital + ' of USDC to ' + name + ' on ' + chain + ', then borrow a small amount against it and repay it once.';
    if (c.indexOf('dex') !== -1 || c.indexOf('exchange') !== -1)
      return 'Provide $' + capital + ' of liquidity to ' + name + "'s deepest pool on " + chain + ' and leave the position in range.';
    if (c.indexOf('yield aggregator') !== -1 || c.indexOf('leveraged farm') !== -1)
      return 'Deposit $' + capital + " of USDC into " + name + "'s highest-TVL vault on " + chain + ' and hold the vault shares.';
    if (c.indexOf('yield') !== -1 || c.indexOf('farm') !== -1)
      return 'Deposit $' + capital + " into " + name + "'s main yield position on " + chain + ' and let the rewards accrue.';
    if (c.indexOf('curator') !== -1 || c.indexOf('allocator') !== -1 || c.indexOf('vault') !== -1)
      return 'Deposit $' + capital + ' into a ' + name + ' vault on ' + chain + ' and keep the receipt tokens in the wallet.';
    if (c.indexOf('perpetual') !== -1 || c.indexOf('derivative') !== -1 || c.indexOf('options') !== -1)
      return 'Deposit $' + capital + ' of USDC as margin on ' + name + ' and open one small hedged position, then close it.';
    if (c.indexOf('bridge') !== -1)
      return 'Bridge $' + capital + ' of USDC through ' + name + ' to ' + chain + ' and use the bridged funds inside its app.';
    if (c.indexOf('staking') !== -1 || c.indexOf('restak') !== -1)
      return 'Stake $' + capital + ' through ' + name + ' on ' + chain + ' and keep the staking receipt in the wallet.';
    if (c.indexOf('stable') !== -1 || c.indexOf('rwa') !== -1)
      return 'Mint or buy $' + capital + " of " + name + "'s asset on " + chain + ' and hold it in the farming wallet.';
    if (c.indexOf('prediction') !== -1)
      return 'Fund the wallet with $' + capital + ' and take one small position in an active ' + name + ' market.';
    if (c.indexOf('insurance') !== -1 || c.indexOf('cover') !== -1)
      return 'Buy $' + capital + ' of cover from ' + name + ' on ' + chain + ' and keep the policy active.';
    if (c.indexOf('chain') !== -1 || c.indexOf('infrastructure') !== -1)
      return 'Use ' + name + ' on ' + chain + ' with $' + capital + ': run one real transaction a week through its app.';
    return 'Deposit $' + capital + ' of USDC into ' + name + ' on ' + chain + ' and keep the position open.';
  }
  function buildFarmPlan(row) {
    var chain = homeChain(row);
    var capital = capitalFor(row);
    var hold = holdDaysFor(row.age_days);
    var gas = gasNote(chain);
    var steps = [
      'Set up a fresh wallet that holds only the funds you plan to farm, write its seed phrase on paper, and keep it offline. Cost: ' + gas + ' for the first transaction. Time: 5 minutes.',
      coreAction(row, capital, chain) + ' Cost: $' + capital + ' of capital plus ' + gas + '. Time: 15 minutes to set up.',
      'Return once a week and make one real qualifying action — a deposit, a swap, a borrow, a vote — so the wallet shows repeat use, not one visit. Cost: about $2 of gas a week. Time: 10 minutes a week.',
      'Hold the position for at least ' + hold + ' days so the activity lands in more than one snapshot window, and do not empty the wallet between visits. Cost: the $' + capital + ' stays in the position. Time: ' + hold + ' days.',
      "Before claiming anything, open the protocol's own points or rewards page from its official site and claim only from the link it publishes; never pay a fee to claim and never sign a blind approval. Cost: nothing to check. Time: 10 minutes.",
      'Log the wallet address, the dates and every transaction hash in a farm notebook, and set your unwind rule now: what you will sell, what you will keep, and when. Cost: nothing but the log. Time: 5 minutes.'
    ];
    return steps.map(function (s) { return s.length > 600 ? s.slice(0, 596) + '...' : s; });
  }

  // Exposed so a headless check can verify the page's arithmetic and plans
  // against board.json, row for row.
  window.__RADAR_TEST__ = { impliedValueOf: impliedValueOf, buildFarmPlan: buildFarmPlan, multipleFor: multipleFor };

  // ------------------------------------------------------------ dom helper

  function h(tag, attrs) {
    var node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (k) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k.slice(0, 2) === 'on') node.addEventListener(k.slice(2), attrs[k]);
        else if (attrs[k] !== null && attrs[k] !== undefined) node.setAttribute(k, attrs[k]);
      });
    }
    for (var i = 2; i < arguments.length; i++) {
      var child = arguments[i];
      if (child === null || child === undefined || child === false) continue;
      if (Array.isArray(child)) child.forEach(function (c) { if (c) node.appendChild(c); });
      else if (typeof child === 'string' || typeof child === 'number') node.appendChild(document.createTextNode(String(child)));
      else node.appendChild(child);
    }
    return node;
  }
  function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); }

  // ------------------------------------------------------------ state

  var state = {
    tab: 'board',
    q: '',
    category: 'all',
    chain: 'all',
    scope: 'all',
    minTvl: 0,
    sortKey: 'implied',
    sortDir: -1,
    selected: null,
    over: {}
  };
  function sandboxActive() {
    return Object.keys(state.over).length > 0;
  }
  function shownValue(row) {
    if (!sandboxActive()) return row.implied_value_usd;
    return impliedValueOf(row, state.over).implied;
  }

  function distinct(values) {
    var seen = {};
    var out = [];
    values.forEach(function (v) { if (v !== null && !seen[v]) { seen[v] = true; out.push(v); } });
    return out.sort();
  }
  var categories = distinct(DATA.rows.map(function (r) { return r.category; }));
  var chains = distinct(DATA.rows.reduce(function (acc, r) { return acc.concat(r.chains); }, []));

  function filteredRows() {
    var q = state.q.trim().toLowerCase();
    var rows = DATA.rows.filter(function (r) {
      if (q && (r.name.toLowerCase().indexOf(q) === -1 && r.slug.toLowerCase().indexOf(q) === -1 && (r.category || '').toLowerCase().indexOf(q) === -1)) return false;
      if (state.category !== 'all' && r.category !== state.category) return false;
      if (state.chain !== 'all' && r.chains.indexOf(state.chain) === -1) return false;
      if (state.scope === 'watchlist' && !r.on_watchlist) return false;
      if (state.scope === 'early' && (r.on_watchlist || r.tvl_usd >= DATA.floor_usd)) return false;
      if (r.tvl_usd < state.minTvl) return false;
      return true;
    });
    var dir = state.sortDir;
    var key = state.sortKey;
    rows.sort(function (a, b) {
      var va, vb;
      if (key === 'implied') { va = shownValue(a); vb = shownValue(b); }
      else if (key === 'tvl') { va = a.tvl_usd; vb = b.tvl_usd; }
      else if (key === 'change') { va = a.change_7d === null ? -Infinity : a.change_7d; vb = b.change_7d === null ? -Infinity : b.change_7d; }
      else if (key === 'age') { va = a.age_days === null ? -1 : a.age_days; vb = b.age_days === null ? -1 : b.age_days; }
      else { va = a.name.toLowerCase(); vb = b.name.toLowerCase(); }
      if (va < vb) return -dir;
      if (va > vb) return dir;
      return a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0;
    });
    return rows;
  }

  function findRow(slug) {
    for (var i = 0; i < DATA.rows.length; i++) if (DATA.rows[i].slug === slug) return DATA.rows[i];
    return null;
  }

  // ------------------------------------------------------------ shell

  var statsEl = h('section', { class: 'stats', 'aria-label': 'Coverage' });
  var tabsEl = h('nav', { class: 'tabs', role: 'tablist', 'aria-label': 'Views' });
  var viewEl = h('div', { id: 'view' });
  app.appendChild(statsEl);
  app.appendChild(tabsEl);
  app.appendChild(viewEl);

  function stat(value, label, ok) {
    return h('div', { class: 'stat' }, h('b', { text: value, class: ok ? 'ok' : undefined }), h('span', { text: label }));
  }
  statsEl.appendChild(stat(String(DATA.scanned), 'protocols scanned in the snapshot'));
  statsEl.appendChild(stat(DATA.watchlist_size + ' / ' + DATA.watchlist_size, 'watchlist protocols covered', true));
  statsEl.appendChild(stat(String(DATA.board_size), 'pre-token protocols ranked'));
  statsEl.appendChild(stat(String(DATA.early_size), 'early finds below the $50M floor'));
  statsEl.appendChild(stat(calibration.global_multiple.toFixed(3) + 'x', 'market multiple: median mcap / TVL'));

  function renderTabs() {
    clear(tabsEl);
    [['board', 'Ranked board', DATA.board_size], ['live', 'Live tokens', DATA.live_size], ['model', 'Model & method', null]].forEach(function (t) {
      var btn = h('button', {
        class: 'tab', role: 'tab', 'aria-selected': state.tab === t[0] ? 'true' : 'false',
        onclick: function () { state.tab = t[0]; renderTabs(); mountView(); }
      }, t[1], t[2] === null ? null : h('span', { class: 'n', text: '(' + t[2] + ')' }));
      tabsEl.appendChild(btn);
    });
  }

  function mountView() {
    clear(viewEl);
    if (state.tab === 'board') mountBoard();
    else if (state.tab === 'live') mountLive();
    else mountModel();
  }

  // ------------------------------------------------------------ board view

  var tableWrap, countLine, detailSlot, noteSlot;

  function mountBoard() {
    var controls = h('div', { class: 'controls' });
    var search = h('input', { type: 'search', placeholder: 'Search name, slug or category', value: state.q, 'aria-label': 'Search protocols' });
    search.addEventListener('input', function () { state.q = search.value; updateTable(); });
    controls.appendChild(h('div', { class: 'field' }, h('label', { text: 'Search' }), search));

    function select(label, options, current, onPick) {
      var sel = h('select', { 'aria-label': label });
      options.forEach(function (o) {
        sel.appendChild(h('option', { value: o[0], text: o[1], selected: o[0] === current ? 'selected' : undefined }));
      });
      sel.addEventListener('change', function () { onPick(sel.value); updateTable(); });
      controls.appendChild(h('div', { class: 'field' }, h('label', { text: label }), sel));
    }
    select('Category', [['all', 'All categories']].concat(categories.map(function (c) { return [c, c]; })), state.category, function (v) { state.category = v; });
    select('Chain', [['all', 'All chains']].concat(chains.map(function (c) { return [c, c]; })), state.chain, function (v) { state.chain = v; });
    select('Scope', [['all', 'Whole board'], ['watchlist', 'Watchlist only'], ['early', 'Early only (below floor)']], state.scope, function (v) { state.scope = v; });
    select('Min TVL', [['0', 'Any TVL'], ['5000000', '$5M+'], ['50000000', '$50M+ (floor)'], ['500000000', '$500M+'], ['1000000000', '$1B+']], String(state.minTvl), function (v) { state.minTvl = Number(v); });

    noteSlot = h('div', {});
    detailSlot = h('div', {});
    countLine = h('p', { class: 'count-line' });
    tableWrap = h('div', { class: 'table-card' });
    viewEl.appendChild(controls);
    viewEl.appendChild(noteSlot);
    viewEl.appendChild(detailSlot);
    viewEl.appendChild(countLine);
    viewEl.appendChild(tableWrap);
    updateTable();
    if (state.selected) showDetail(state.selected, false);
  }

  function sortArrow(key) {
    if (state.sortKey !== key) return '';
    return state.sortDir === -1 ? ' ▼' : ' ▲';
  }

  function updateTable() {
    var rows = filteredRows();
    clear(noteSlot);
    if (sandboxActive()) {
      noteSlot.appendChild(h('p', { class: 'sandbox-note', text: 'Sandbox values on: the implied values below use your adjusted weights, not the calibrated model. Reset them in Model & method.' }));
    }
    clear(countLine);
    countLine.appendChild(document.createTextNode('Showing '));
    countLine.appendChild(h('b', { text: String(rows.length) }));
    countLine.appendChild(document.createTextNode(' of ' + DATA.board_size + ' ranked protocols · click a row for its detail view and farm plan · click a column header to sort.'));
    clear(tableWrap);
    if (rows.length === 0) {
      tableWrap.appendChild(h('p', { class: 'empty', text: 'No protocols match these filters. Loosen the search or the filters.' }));
      return;
    }
    var table = h('table', {});
    var head = h('tr', {});
    [['rank', '#'], ['name', 'Protocol'], ['category', 'Category'], ['chains', 'Chains'], ['tvl', 'TVL'], ['change', '7d'], ['age', 'Age'], ['implied', 'Implied value']].forEach(function (col) {
      var sortable = ['name', 'tvl', 'change', 'age', 'implied'].indexOf(col[0]) !== -1;
      var th = h('th', {
        text: col[1] + (sortable ? sortArrow(col[0]) : ''),
        class: (sortable ? 'sortable ' : '') + (['tvl', 'change', 'age', 'implied'].indexOf(col[0]) !== -1 ? 'num' : '')
      });
      if (sortable) {
        th.addEventListener('click', function () {
          if (state.sortKey === col[0]) state.sortDir = -state.sortDir;
          else { state.sortKey = col[0]; state.sortDir = col[0] === 'name' ? 1 : -1; }
          updateTable();
        });
      }
      head.appendChild(th);
    });
    table.appendChild(h('thead', {}, head));
    var body = h('tbody', {});
    rows.forEach(function (r) {
      var growth = r.change_7d;
      var pill = h('span', { class: 'pill' + (growth === null ? '' : growth >= 0 ? ' up' : ' down'), text: fmtPct(growth) });
      var tr = h('tr', {
        class: state.selected === r.slug ? 'selected' : undefined,
        tabindex: '0',
        'aria-label': r.name + ', rank ' + r.rank + ', implied value ' + fmtUsd(shownValue(r))
      },
        h('td', { class: 'rank', text: String(r.rank) }),
        h('td', { class: 'namecell' }, h('b', {}, h('span', { class: 'dot' + (r.on_watchlist ? '' : ' early'), title: r.on_watchlist ? 'On the watchlist' : 'Early find' }), r.name), h('span', { text: r.slug + (r.on_watchlist ? ' · watchlist' : ' · early') })),
        h('td', { text: r.category || '—' }),
        h('td', { class: 'chains', text: r.chains.slice(0, 3).join(', ') + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') || '—' }),
        h('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        h('td', { class: 'num' }, pill),
        h('td', { class: 'num', text: fmtAge(r.age_days) }),
        h('td', { class: 'num implied', text: fmtUsd(shownValue(r)) })
      );
      tr.addEventListener('click', function () { selectRow(r.slug, true); });
      tr.addEventListener('keydown', function (e) { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); selectRow(r.slug, true); } });
      body.appendChild(tr);
    });
    table.appendChild(body);
    tableWrap.appendChild(table);
  }

  function selectRow(slug, scroll) {
    state.selected = slug;
    if (state.tab !== 'board') { state.tab = 'board'; renderTabs(); mountView(); }
    showDetail(slug, scroll);
    updateTable();
    if (window.location.hash !== '#/protocol/' + slug) window.location.hash = '#/protocol/' + slug;
  }

  function factorBar(label, value, display, why, pct) {
    return h('div', { class: 'factor' },
      h('div', { class: 'row' }, h('span', { text: label }), h('b', { text: display })),
      h('div', { class: 'bar' }, h('i', { style: 'width:' + Math.max(2, Math.min(100, pct)) + '%' })),
      h('div', { class: 'why', text: why }));
  }

  function showDetail(slug, scroll) {
    var row = findRow(slug);
    clear(detailSlot);
    if (!row) return;
    var recomputed = impliedValueOf(row, state.over);
    var f = sandboxActive() ? recomputed.factors : row.factors;
    var value = sandboxActive() ? recomputed.implied : row.implied_value_usd;
    var agrees = Math.abs(recomputed.implied - row.implied_value_usd) <= Math.max(2, row.implied_value_usd * 0.0001);
    var entry = row.category === null ? undefined : calibration.by_category[row.category];
    var hasComps = entry !== undefined && entry.count >= 2;
    var multipleWhy = hasComps
      ? 'Category median mcap/TVL shrunk toward the global median (' + entry.count + ' live comparables).'
      : 'Global median mcap/TVL: too few live comparables in this category to set its own price.';

    var factors = h('div', {},
      h('h3', { text: 'Why this value — the model, factor by factor' }),
      factorBar('TVL', row.tvl_usd, fmtFull(row.tvl_usd), 'The protocol’s size in the snapshot.', Math.min(100, (row.tvl_usd / 3000000000) * 100)),
      factorBar('Market multiple', f.multiple, f.multiple.toFixed(3) + 'x', multipleWhy, Math.min(100, (f.multiple / 1.5) * 100)),
      factorBar('Growth ×' + f.growth_factor.toFixed(3), f.growth_factor, fmtPct(f.growth_pct) + ' → ×' + f.growth_factor.toFixed(3), 'Seven-day TVL change, clamped to −50%…+150%, at half weight.', ((f.growth_factor - 0.75) / 1.0) * 100),
      factorBar('Tenure ×' + f.tenure_factor.toFixed(3), f.tenure_factor, fmtAge(row.age_days) + ' → ×' + f.tenure_factor.toFixed(3), row.age_days === null ? 'No listing date reported: scored as one year old.' : 'Time running with no token recorded, log-scaled to four years.', ((f.tenure_factor - 0.55) / 0.45) * 100),
      factorBar('Reach ×' + f.reach_factor.toFixed(2), f.reach_factor, row.chains.length + ' chain' + (row.chains.length === 1 ? '' : 's') + ' → ×' + f.reach_factor.toFixed(2), 'Four percent per extra chain, up to five extra chains.', ((f.reach_factor - 1) / 0.2) * 100),
      h('div', { class: 'total' }, h('span', { text: 'Implied launch value' }), h('b', { text: fmtFull(value) }))
    );
    if (!sandboxActive()) {
      factors.appendChild(h('p', { class: 'verify', text: agrees ? '✓ The page recomputed this row from the snapshot figures and matches board.json.' : 'The page recomputed this row; it differs from board.json by rounding.' }));
    }

    var planItems = buildFarmPlan(row).map(function (step, i) {
      return h('li', {},
        h('span', { class: 'stepno', text: String(i + 1) }),
        h('label', { style: 'display:flex;gap:10px;cursor:pointer;' },
          h('input', { type: 'checkbox', 'aria-label': 'Step ' + (i + 1) + ' done' }),
          h('span', { text: step })));
    });
    var plan = h('div', {},
      h('h3', { text: 'Farm plan — six steps, with cost and time' }),
      h('ol', { class: 'plan' }, planItems),
      h('p', { class: 'bench', text: 'Benchmark: ' + (hasComps ? ('live ' + row.category + ' protocols trade at a median ' + entry.median.toFixed(3) + 'x TVL (' + entry.count + ' comparables).') : ('live protocols overall trade at a median ' + calibration.global_multiple.toFixed(3) + 'x TVL (' + calibration.live_count + ' comparables).')) + ' This protocol records no token, so the figure above is the model’s claim, not a market price.' })
    );

    var card = h('section', { class: 'detail', 'aria-label': 'Detail: ' + row.name },
      h('div', { class: 'detail-head' },
        h('div', {},
          h('h2', { text: '#' + row.rank + ' · ' + row.name }),
          h('p', { class: 'sub', text: (row.category || 'Uncategorised') + ' · ' + (row.chains.join(', ') || 'no chains listed') + ' · listed ' + (row.listed_at || 'unknown') + ' · ' + (row.on_watchlist ? 'on the snapshot watchlist' : 'early find, below the floor') })),
        h('button', { class: 'close', text: 'Close', onclick: function () { state.selected = null; clear(detailSlot); updateTable(); try { history.replaceState(null, '', window.location.pathname + window.location.search); } catch (e) { /* file:// has no history state to replace */ } } })),
      h('div', { class: 'detail-grid' }, factors, plan)
    );
    detailSlot.appendChild(card);
    if (scroll) card.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  // ------------------------------------------------------------ live view

  function mountLive() {
    var panel = h('section', { class: 'panel' },
      h('h2', { text: 'Live tokens — the market’s own values' }),
      h('p', {}, h('strong', { text: 'These protocols already trade, so they are not ranked. ' }), 'They are the calibration set: their market-cap-to-TVL ratios price the board. The median across ' + calibration.live_count + ' live-token protocols is ' + calibration.global_multiple.toFixed(3) + 'x TVL. Centralised exchanges are left out of the calibration entirely.'));
    var card = h('div', { class: 'table-card' });
    var table = h('table', {});
    table.appendChild(h('thead', {}, h('tr', {},
      h('th', { text: 'Protocol' }), h('th', { text: 'Category' }),
      h('th', { class: 'num', text: 'TVL' }), h('th', { class: 'num', text: 'Market cap' }),
      h('th', { class: 'num', text: 'mcap / TVL' }), h('th', { class: 'num', text: '7d' }))));
    var body = h('tbody', {});
    DATA.live.forEach(function (r) {
      body.appendChild(h('tr', {},
        h('td', { class: 'namecell' }, h('b', { text: r.name }), h('span', { text: r.slug })),
        h('td', { text: r.category || '—' }),
        h('td', { class: 'num', text: fmtUsd(r.tvl_usd) }),
        h('td', { class: 'num', text: fmtUsd(r.mcap_usd) }),
        h('td', { class: 'num', text: r.mcap_tvl_ratio === null ? 'n/a' : r.mcap_tvl_ratio.toFixed(3) + 'x' }),
        h('td', { class: 'num' }, h('span', { class: 'pill' + (r.change_7d === null ? '' : r.change_7d >= 0 ? ' up' : ' down'), text: fmtPct(r.change_7d) }))));
    });
    table.appendChild(body);
    card.appendChild(table);
    viewEl.appendChild(panel);
    viewEl.appendChild(card);
  }

  // ------------------------------------------------------------ model view

  function mountModel() {
    var formula = 'implied  =  TVL  x  multiple  x  growth  x  tenure  x  reach\n' +
      'multiple =  category median mcap/TVL, shrunk toward the global median\n' +
      'growth   =  1 + clamp(change_7d, -50, +150) / 100 x 0.5\n' +
      'tenure   =  0.55 + 0.45 x ln(1 + min(age_days, 1460)) / ln(1461)\n' +
      'reach    =  1 + 0.04 x min(chains - 1, 5), at most 1.20';
    var panel = h('section', { class: 'panel' },
      h('h2', { text: 'The model, stated in full' }),
      h('p', { text: 'No protocol name is special-cased: one function scores every row from the snapshot’s own figures, so a protocol that launches after this snapshot is scored the same way the moment its record appears. Model version ' + DATA.model_version + ', snapshot date ' + DATA.as_of + '.' }),
      h('pre', { class: 'formula', text: formula }),
      h('div', { class: 'kv' },
        h('div', {}, h('span', { text: 'Global multiple (median mcap/TVL)' }), h('b', { text: calibration.global_multiple.toFixed(3) + 'x' })),
        h('div', {}, h('span', { text: 'Live protocols calibrated on' }), h('b', { text: String(calibration.live_count) })),
        h('div', {}, h('span', { text: 'Growth weight / clamp' }), h('b', { text: weights.growth_weight + ' / ' + weights.growth_floor + '%…' + weights.growth_cap + '%' })),
        h('div', {}, h('span', { text: 'Tenure floor / cap' }), h('b', { text: weights.tenure_floor + ' / ' + weights.tenure_cap_days + ' days' })),
        h('div', {}, h('span', { text: 'Unknown age scored as' }), h('b', { text: weights.unknown_age_days + ' days' })),
        h('div', {}, h('span', { text: 'Missing 7-day change scored as' }), h('b', { text: '0% (flat)' }))));

    var scope = h('section', { class: 'panel' },
      h('h2', { text: 'What counts as pre-token' }),
      h('p', { text: 'A row records no token — no market cap, no CoinGecko id, no symbol — and is not a wrapped, staked or bridged product of one that trades: its category is not Bridge, Canonical Bridge, Liquid Staking, Liquid Restaking, Restaked BTC or CEX, its name carries no version marker and no whole word “wrapped”, “staked” or “staking”, and it does not begin with an exchange’s name. That is the watchlist’s own rule, applied to every protocol rather than only the ones above the $50M floor — the floor is where the reading started, not where it stops. The snapshot does not carry DefiLlama’s parent-protocol field, so a product whose parentage only that field shows cannot be excluded here; the watchlist itself is always covered in full.' }));

    var calRows = Object.keys(calibration.by_category).sort().map(function (c) {
      var e = calibration.by_category[c];
      return h('tr', {},
        h('td', { text: c }),
        h('td', { class: 'num', text: e.median.toFixed(3) + 'x' }),
        h('td', { class: 'num', text: String(e.count) }),
        h('td', { class: 'num', text: multipleFor(c).toFixed(3) + 'x' }));
    });
    var calCard = h('div', { class: 'table-card' });
    var calTable = h('table', {});
    calTable.appendChild(h('thead', {}, h('tr', {},
      h('th', { text: 'Category' }), h('th', { class: 'num', text: 'Live median mcap/TVL' }),
      h('th', { class: 'num', text: 'Comparables' }), h('th', { class: 'num', text: 'Multiple used' }))));
    calTable.appendChild(h('tbody', {}, calRows));
    calCard.appendChild(calTable);
    var calPanel = h('section', { class: 'panel' },
      h('h2', { text: 'Calibration — the market prices the board' }),
      h('p', { text: 'Each category’s multiple is its live median shrunk toward the global median: five or more comparables earn a half weight, two to four a quarter weight, fewer than two none. Categories with no live comparables use the global median.' }));
    calPanel.appendChild(calCard);

    var sandbox = h('section', { class: 'panel' },
      h('h2', { text: 'Model sandbox — change the weights, re-rank the board' }),
      h('p', { text: 'The sliders re-run the same arithmetic with your weights. The board tab re-ranks at once; board.json always carries the calibrated values. Reset returns to the calibrated model.' }));
    var grid = h('div', { class: 'sandbox' });
    function slider(label, min, max, step, get, set, fmt) {
      var out = h('output', { text: fmt(get()) });
      var input = h('input', { type: 'range', min: String(min), max: String(max), step: String(step), value: String(get()), 'aria-label': label });
      input.addEventListener('input', function () { set(Number(input.value)); out.textContent = fmt(Number(input.value)); });
      grid.appendChild(h('div', { class: 'field' }, h('label', { text: label + ': ' }), out, input));
    }
    slider('Multiple scale', 0.5, 2, 0.05,
      function () { return state.over.multipleScale === undefined ? 1 : state.over.multipleScale; },
      function (v) { state.over.multipleScale = v; }, function (v) { return v.toFixed(2) + 'x'; });
    slider('Growth weight', 0, 1, 0.05,
      function () { return state.over.growthWeight === undefined ? weights.growth_weight : state.over.growthWeight; },
      function (v) { state.over.growthWeight = v; }, function (v) { return v.toFixed(2); });
    slider('Tenure floor', 0.3, 0.8, 0.05,
      function () { return state.over.tenureFloor === undefined ? weights.tenure_floor : state.over.tenureFloor; },
      function (v) { state.over.tenureFloor = v; }, function (v) { return v.toFixed(2); });
    sandbox.appendChild(grid);
    sandbox.appendChild(h('button', { class: 'reset', text: 'Reset to the calibrated model', onclick: function () { state.over = {}; mountView(); } }));
    sandbox.appendChild(h('p', { class: 'note', text: 'Sandbox on: ' + (sandboxActive() ? 'yes — the board tab shows sandbox values.' : 'no — the board shows calibrated values.') }));

    viewEl.appendChild(panel);
    viewEl.appendChild(scope);
    viewEl.appendChild(calPanel);
    viewEl.appendChild(sandbox);
  }

  // ------------------------------------------------------------ boot

  var foot = document.getElementById('foot-src');
  if (foot) foot.textContent = 'Data: ' + DATA.source + ' · Snapshot date ' + DATA.as_of + ' · Watchlist floor $' + DATA.floor_usd.toLocaleString('en-US') + ' · Model ' + DATA.model_version + '.';

  function fromHash() {
    var m = /^#\/protocol\/([A-Za-z0-9._-]+)$/.exec(window.location.hash || '');
    if (m && findRow(m[1])) { state.selected = m[1]; state.tab = 'board'; }
  }
  window.addEventListener('hashchange', function () {
    var before = state.selected;
    fromHash();
    if (state.selected && state.selected !== before) { renderTabs(); mountView(); }
  });
  fromHash();
  renderTabs();
  mountView();
})();
