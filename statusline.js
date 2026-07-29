#!/usr/bin/env node
/**
 * superfluous-statusline — a status line for Claude Code.
 *
 * https://github.com/SuperfluousAI/superfluous-statusline   (MIT)
 *
 * Contract (full reference: docs/spec-statusline.md):
 *   stdin  = one JSON object from Claude Code, per render
 *   stdout = the bar; ANSI colour allowed; may be more than one line
 *   exit   = always 0; NEVER throw. A crash blanks the bar with no error shown
 *            anywhere, so every segment is independently defensive and a
 *            missing field means "omit that segment," never "break the bar."
 *   width  = process.env.COLUMNS (exported by the harness; NOT tput — see §5)
 *
 * Point ~/.claude/settings.json at this file by absolute path, so the file you
 * edit IS the file that runs — no copy step, nothing to keep in sync.
 *
 * Every segment carries a LABEL. A bare value teaches nothing: "$34.02" and
 * "main" only read as cost and branch once you already know the layout.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const CACHE = path.join(process.env.HOME || '/tmp', '.cache');

// ── ANSI ─────────────────────────────────────────────────────────────────────
// BRIGHT palette (90–97) + bold, not the dim 30s. These are the terminal's own
// bright slots, so they still follow the colour scheme instead of hard-coding
// RGB the way 38;5;N would. Nothing uses SGR 2 (dim); gray (90) is as quiet as
// it gets — dim text was the main thing making the old bar hard to read.
const E = (c, s) => `\x1b[${c}m${s}\x1b[0m`;
const gray = s => E('90', s);
const red = s => E('1;91', s);
const green = s => E('1;92', s);
const yellow = s => E('1;93', s);
const blue = s => E('1;94', s);
const magenta = s => E('1;95', s);
const cyan = s => E('1;96', s);
const white = s => E('97', s);

/** Printable width — ANSI escapes occupy no columns. */
const vlen = s => s.replace(/\x1b\[[0-9;]*m/g, '').length;

/** `label value` — the label is always gray so the value stays the loud part. */
const seg = (label, value) => (value ? gray(label + ' ') + value : '');

/** Operator-chosen separator: a literal pipe, padded. */
const PIPE = gray(' | ');
const PIPE_W = 3;

// ── tiny disk cache ──────────────────────────────────────────────────────────
/**
 * The docs warn this script runs frequently and that shelling out (git status
 * especially) causes lag. Anything expensive goes through here: a TTL'd file
 * in ~/.cache, written atomically for the same reason the payload cache is
 * (a render can be reading while another writes).
 */
function cached(name, ttlMs, produce) {
  const f = path.join(CACHE, `statusline-${name}`);
  try {
    const st = fs.statSync(f);
    if (Date.now() - st.mtimeMs < ttlMs) return fs.readFileSync(f, 'utf8');
  } catch { /* cold cache */ }
  let v = '';
  try { v = produce() ?? ''; } catch { return ''; }
  try {
    const tmp = `${f}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, v);
    fs.renameSync(tmp, f);
  } catch { /* cache is an optimisation, never a requirement */ }
  return v;
}

// ── terminal width ───────────────────────────────────────────────────────────
/**
 * THE OFFICIAL ANSWER IS `COLUMNS`.
 *
 * Claude Code captures our stdout instead of connecting it to the terminal, so
 * `process.stdout.columns` is undefined and the docs state plainly that
 * "`tput cols` and language-level width detection cannot read the terminal size
 * from inside the script." Instead the harness EXPORTS `COLUMNS` and `LINES`
 * before running us (v2.1.153+).
 *   https://code.claude.com/docs/en/statusline  §"Sizing output to the terminal"
 *
 * We originally shipped `tput cols`, which appeared to work — it returned the
 * true 214. That was luck, not correctness: ncurses consults $COLUMNS itself,
 * so tput was reading the very variable we should have read directly.
 *
 * Order: COLUMNS (documented) → tput (fallback for < 2.1.153) → 80.
 */
function termWidth() {
  const n = parseInt(process.env.COLUMNS, 10);
  if (n >= 40 && n <= 500) return { w: n, src: 'COLUMNS' };
  try {
    const t = parseInt(execFileSync('tput', ['cols'], {
      encoding: 'utf8', stdio: ['inherit', 'pipe', 'ignore'],
    }).trim(), 10);
    if (t >= 40 && t <= 500) return { w: t, src: 'tput' };
  } catch { /* no tty reachable */ }
  return { w: 80, src: 'default' };
}

// ── the meter ────────────────────────────────────────────────────────────────
const EIGHTHS = ['', '▏', '▎', '▍', '▌', '▋', '▊', '▉'];

/**
 * A filled 0–100% meter, `width` cells wide. Eighth-blocks give the leading
 * edge sub-cell precision so it advances smoothly. Filled portion takes the
 * tint; the track stays gray so the boundary is unmistakable — that is the
 * whole point of a bar over a number.
 *
 * `markPct` draws a PACE TICK: one cell replaced by `┃`, marking where the
 * fill *would* be if you burned the window evenly. Fill past the tick = ahead
 * of pace. It's drawn per-cell rather than by string concatenation because the
 * tick can land inside either the filled run or the track.
 */
function meter(pct, width, tint, markPct) {
  const p = Math.max(0, Math.min(100, pct)) / 100;
  const exact = p * width;
  const full = Math.floor(exact);
  const frac = Math.floor((exact - full) * 8);

  const cells = [];
  for (let i = 0; i < width; i++) {
    if (i < full) cells.push(['fill', '█']);
    else if (i === full && frac > 0) cells.push(['fill', EIGHTHS[frac]]);
    else cells.push(['track', '░']);
  }
  if (typeof markPct === 'number' && markPct >= 0 && markPct <= 100 && width > 1) {
    cells[Math.min(width - 1, Math.floor((markPct / 100) * width))] = ['mark', '┃'];
  }

  const paint = (k, s) => (k === 'fill' ? tint(s) : k === 'mark' ? white(s) : gray(s));
  let out = '', run = '', kind = null;
  for (const [k, ch] of cells) {
    if (k !== kind) { if (run) out += paint(kind, run); run = ''; kind = k; }
    run += ch;
  }
  if (run) out += paint(kind, run);
  return out;
}

/** Milliseconds → compact "2h14m" / "14m" / "45s". */
function dur(ms) {
  if (!(ms > 0)) return '';
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}h${String(m % 60).padStart(2, '0')}m` : `${Math.floor(h / 24)}d${h % 24}h`;
}

/**
 * Pace + projection for one rate-limit window.
 *
 * `resets_at` is the END of the window, and the window length is known (5h or
 * 7d), so elapsed time is derivable — and with it, the two questions the raw
 * percentage can't answer:
 *   pace  — where the fill *should* be if the window were burned evenly
 *   capAt — if the current burn rate holds, when does it hit 100%?
 *
 * The projection only matters when it lands BEFORE the reset; otherwise the
 * window replenishes first and there is nothing to warn about.
 */
function pace(v, windowMs) {
  if (!v?.resets_at) return {};
  const msLeft = v.resets_at * 1000 - Date.now();
  if (!(msLeft > 0) || msLeft > windowMs) return {};      // reset in the past, or a window we can't reason about
  const elapsed = windowMs - msLeft;
  if (elapsed <= 60_000) return {};                        // just reset: rate is noise
  const pacePct = (elapsed / windowMs) * 100;
  const used = v.used_percentage;
  const ratePerMs = used / elapsed;                        // % per ms
  let capIn = '';
  if (ratePerMs > 0 && used > pacePct) {
    const msToCap = (100 - used) / ratePerMs;
    if (msToCap < msLeft) capIn = dur(msToCap);
  }
  return { pacePct, capIn };
}

/** Seconds-since-epoch → compact "42m" / "3h" / "2d". */
function until(epochSeconds) {
  const ms = epochSeconds * 1000 - Date.now();
  if (!(ms > 0)) return '';
  const min = ms / 6e4;
  if (min < 60) return `${Math.round(min)}m`;
  const hrs = min / 60;
  if (hrs < 24) return `${Math.round(hrs)}h`;
  return `${Math.round(hrs / 24)}d`;
}

const pad = (s, n) => s + ' '.repeat(Math.max(0, n - vlen(s)));

/**
 * Drop trailing padding at end of line. `pad()` aligns the % columns, but on
 * the LAST segment that padding is invisible whitespace running to the edge —
 * and the spaces sit *inside* the colour span, so they trail an ANSI reset
 * rather than ending the string. Strip both, repeatedly, until stable.
 */
function tidy(line) {
  let prev;
  do { prev = line; line = line.replace(/ +(\x1b\[0m)?$/, '$1'); } while (line !== prev);
  return line;
}

// ── stdin ────────────────────────────────────────────────────────────────────
// 3s guard: if the pipe never closes we exit quietly rather than hang the UI.
let input = '';
const guard = setTimeout(() => process.exit(0), 3000);
process.stdin.setEncoding('utf8');
process.stdin.on('data', c => (input += c));
process.stdin.on('end', () => {
  clearTimeout(guard);
  let d = {};
  try { d = JSON.parse(input) || {}; } catch { /* render what we can */ }

  // Keep the last raw payload so the contract can be re-verified from fact
  // instead of memory. Write-then-rename, NOT a plain write: renders fire
  // constantly and a reader that opens the file mid-write sees a truncated one
  // (it did, once). rename(2) within a filesystem is atomic.
  try {
    const dest = path.join(CACHE, 'statusline-last.json');
    const tmp = `${dest}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, input);
    fs.renameSync(tmp, dest);
  } catch { /* cache dir may not exist; irrelevant to rendering */ }

  const { w: W, src: WSRC } = termWidth();

  // Record the width the RENDER actually saw, and where it came from. Running
  // `tput cols` by hand in another shell measures that shell's pty — a
  // distinction that already produced one wrong diagnosis. Only this is evidence.
  try {
    const dest = path.join(CACHE, 'statusline-width');
    const tmp = `${dest}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, `${W} (via ${WSRC})\n`);
    fs.renameSync(tmp, dest);
  } catch { /* diagnostics only */ }

  let out = '';
  try { out = render(d, W); } catch { out = ''; }
  process.stdout.write(out);
});

// ── layout ───────────────────────────────────────────────────────────────────
function render(d, W) {
  const safe = fn => { try { return fn() || ''; } catch { return ''; } };

  // ── line 1: identity ──
  // Order is "where → what → how much → who". The conditional segments
  // (worktree/pr/agent/vim) are absent almost always, so they cost nothing
  // until they matter.
  //
  // Each carries a PRIORITY. Line 1 can now exceed the terminal — eleven
  // labelled segments is 250+ columns with everything present — and unlike the
  // meters there is no cheaper rendering of "cost $14.42". So when it doesn't
  // fit, the lowest-priority segments are DROPPED until it does. Explicit
  // priorities beat truncation: losing `repo` entirely is legible, losing the
  // right-hand third of the line to a hard cut is not.
  let l1items = [
    [100, safe(() => dirSeg(d, W))],
    [90, safe(() => branchSeg(d))],
    [80, safe(() => modelSeg(d))],
    [75, safe(() => prSeg(d))],          // actionable whenever it exists
    [70, safe(() => worktreeSeg(d))],    // you must know you're in one
    [65, safe(() => agentSeg(d))],
    [60, safe(() => vimSeg(d))],
    [55, safe(() => userSeg())],
    [30, safe(() => repoSeg(d))],        // usually implied by dir
  ].filter(([, s]) => s);

  // Display order is not priority order — read left-to-right as where/what/who.
  const ORDER = ['dir', 'repo', 'branch', 'worktree', 'pr', 'model', 'agent', 'vim', 'user'];
  const labelOf = s => (s.replace(/\x1b\[[0-9;]*m/g, '').split(' ')[0]);
  const lay = items => layBy(ORDER, items);

  // Shorten the email before sacrificing a whole segment — the local part still
  // answers "which account is this?", which is the reason it's on the bar.
  const shrinkUser = () => {
    l1items = l1items.map(([p, s]) =>
      labelOf(s) === 'user' ? [p, s.replace(/([\w.+-]+)@[\w.-]+/, '$1')] : [p, s]);
  };

  let l1 = lay(l1items);
  if (vlen(l1.join(PIPE)) > W - 1) { shrinkUser(); l1 = lay(l1items); }
  while (vlen(l1.join(PIPE)) > W - 1 && l1items.length > 1) {
    const min = Math.min(...l1items.map(([p]) => p));
    l1items = l1items.filter(([p]) => p !== min);
    l1 = lay(l1items);
  }

  // ── line 2: the meters ──
  // Labels are WORDS, not codes, so they are wide — "active session" alone is
  // 14 columns. Below ~100 columns the words plus "resets in Nm" plus three
  // bars cannot fit, and clamping the bar to a minimum width does NOT rescue
  // that: it just overflows instead (it did, at 80). So try progressively
  // cheaper variants and take the first that FITS, measured on the rendered
  // string rather than predicted. Degrading content beats degrading legibility.
  const hasCtx = typeof d.context_window?.remaining_percentage === 'number';
  const H = 3600_000, D = 24 * H;
  const raw = [
    ['active session', '5h', d.rate_limits?.five_hour, 5 * H],
    ['weekly', '7d', d.rate_limits?.seven_day, 7 * D],
  ].filter(([, , v]) => typeof v?.used_percentage === 'number');
  const meters = (hasCtx ? 1 : 0) + raw.length;

  // Trailing text per window: normally the reset countdown, but when the burn
  // rate projects a cap BEFORE the reset, that is the more urgent fact and it
  // replaces it — "resets in 2d" is cold comfort if you run out in 14h.
  const tailFor = (v, windowMs, showTail) => {
    if (!showTail) return { text: '', tint: gray };
    const { capIn } = pace(v, windowMs);
    if (capIn) return { text: ` cap in ~${capIn}`, tint: yellow };
    const r = v.resets_at ? until(v.resets_at) : '';
    return r ? { text: ` resets in ${r}`, tint: gray } : { text: '', tint: gray };
  };

  const buildMeters = ({ short, showTail, showPace }) => {
    if (!meters) return [];
    const PCT_W = 5;                       // "100%" + the separating space
    const lbl = ([long, code]) => (short ? code : long);
    const fixed =
      (hasCtx ? 'ctx '.length + PCT_W : 0) +
      raw.reduce((a, w) => a + lbl(w).length + 1 + PCT_W + tailFor(w[2], w[3], showTail).text.length, 0) +
      (meters - 1) * PIPE_W;
    const bw = Math.min(28, Math.floor((W - fixed - 1) / meters));
    if (bw < 6) return null;               // this variant cannot fit — try the next

    const outSeg = [];
    if (hasCtx) {
      const pct = Math.round(d.context_window.remaining_percentage);
      const tint = pct <= 10 ? red : pct <= 25 ? yellow : green;
      outSeg.push(gray('ctx ') + meter(pct, bw, tint) + ' ' + tint(pad(`${pct}%`, 4)));
    }
    for (const w of raw) {
      const v = w[2];
      const pct = Math.round(v.used_percentage);
      const { pacePct } = showPace ? pace(v, w[3]) : {};
      // Ahead of pace is the signal, so it escalates the colour a step even
      // when the raw percentage alone would still read as comfortable.
      const behind = typeof pacePct === 'number' && pct > pacePct;
      const tint = pct >= 90 ? red : pct >= 75 ? yellow : behind ? yellow : pct >= 50 ? cyan : green;
      const t = tailFor(v, w[3], showTail);
      outSeg.push(gray(lbl(w) + ' ') + meter(pct, bw, tint, pacePct) + ' ' +
                  tint(pad(`${pct}%`, 4)) + t.tint(t.text));
    }
    return outSeg;
  };

  let meterLine = [];
  for (const variant of [{ short: false, showTail: true, showPace: true },
                         { short: true, showTail: true, showPace: true },
                         { short: true, showTail: false, showPace: true }]) {
    const built = buildMeters(variant);
    if (built && vlen(built.join(' | ')) <= W - 1) { meterLine = built; break; }
    if (built) meterLine = built;           // keep the least-bad as a floor
  }

  // ── economics group ──
  // Kept apart from identity because it answers a different question: not
  // "where am I" but "what is this session costing me, and how hard is it
  // thinking". Same priority-drop treatment.
  let ecoItems = [
    [90, safe(() => costSeg(d))],
    [80, safe(() => elapsedSeg(d))],
    [70, safe(() => effortSeg(d))],
    [50, safe(() => cacheSeg(d))],
    [40, safe(() => diffSeg(d))],
  ].filter(([, s]) => s);
  const ECO_ORDER = ['cost', 'elapsed', 'effort', 'cache', 'diff'];
  const fitEco = () => {
    let out = layBy(ECO_ORDER, ecoItems);
    while (vlen(out.join(PIPE)) > W - 1 && ecoItems.length > 1) {
      const min = Math.min(...ecoItems.map(([p]) => p));
      ecoItems = ecoItems.filter(([p]) => p !== min);
      out = layBy(ECO_ORDER, ecoItems);
    }
    return out;
  };

  // ── pack the three groups into lines ──
  // Three logical rows — identity · economics · meters — merged greedily from
  // the top while they fit. A wide terminal collapses to one line; a narrow one
  // gets three. Merging is decided by MEASURING the joined string, never by a
  // width threshold, so it can't drift out of step with the content.
  const groups = [l1.join(PIPE), fitEco().join(PIPE), meterLine.join(PIPE)].filter(Boolean);
  const lines = [];
  for (const g of groups) {
    if (lines.length) {
      const merged = lines[lines.length - 1] + PIPE + g;
      if (vlen(merged) <= W - 1) { lines[lines.length - 1] = merged; continue; }
    }
    lines.push(g);
  }
  return lines.map(tidy).join('\n');
}

/** Order segments for display by their label, independent of drop priority. */
function layBy(order, items) {
  const labelOf = s => s.replace(/\x1b\[[0-9;]*m/g, '').split(' ')[0];
  return items.slice()
    .sort((x, y) => order.indexOf(labelOf(x[1])) - order.indexOf(labelOf(y[1])))
    .map(([, s]) => s);
}

// ── segments ─────────────────────────────────────────────────────────────────

/** Working directory. Basename only on a narrow terminal — the parent rarely earns its columns. */
function dirSeg(d, W) {
  const cwd = d.workspace?.current_dir || d.cwd || process.cwd();
  const home = process.env.HOME || '';
  let p = home && cwd.startsWith(home) ? '~' + cwd.slice(home.length) : cwd;
  const parts = p.split('/').filter(Boolean);
  if (parts.length > (W >= 120 ? 2 : 1)) p = parts.slice(W >= 120 ? -2 : -1).join('/');
  return seg('dir', blue(p));
}

/**
 * Repo identity straight from the payload — `workspace.repo` is parsed from the
 * origin remote by the harness, so this costs no subprocess. Absent outside a
 * git repo with an origin, which is exactly when it would be meaningless.
 */
function repoSeg(d) {
  const r = d.workspace?.repo;
  if (!r?.name) return '';
  return seg('repo', white((r.owner ? r.owner + '/' : '') + r.name));
}

/**
 * Branch + dirty marker.
 *
 * The branch is read straight out of `.git/HEAD` — no subprocess at all, where
 * this used to spawn `git rev-parse` on every render. The dirty check does need
 * git, and the docs single out `git status` as a lag source, so it goes through
 * the TTL cache keyed on the repo path. 4s is chosen to cover a burst of
 * renders (the harness debounces at 300ms) while still reflecting an edit
 * before you can plausibly look down at the bar.
 */
function branchSeg(d) {
  const cwd = d.workspace?.current_dir || d.cwd || process.cwd();

  let gitDir;
  try {
    let dir = path.resolve(cwd);
    for (;;) {
      const g = path.join(dir, '.git');
      if (fs.existsSync(g)) {
        const st = fs.statSync(g);
        gitDir = st.isDirectory() ? g : path.resolve(dir, fs.readFileSync(g, 'utf8').replace(/^gitdir:\s*/, '').trim());
        break;
      }
      const up = path.dirname(dir);
      if (up === dir) return '';
      dir = up;
    }
  } catch { return ''; }

  let branch = '';
  try {
    const head = fs.readFileSync(path.join(gitDir, 'HEAD'), 'utf8').trim();
    const m = head.match(/^ref:\s*refs\/heads\/(.+)$/);
    branch = m ? m[1] : head.slice(0, 7);   // detached HEAD → short sha
  } catch { return ''; }
  if (!branch) return '';

  const key = 'dirty-' + Buffer.from(gitDir).toString('base64url').slice(-40);
  const dirty = cached(key, 4000, () =>
    execFileSync('git', ['-C', cwd, 'status', '--porcelain', '--untracked-files=no'],
      { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim() ? '*' : '');

  return seg('branch', cyan(branch) + (dirty ? red('*') : ''));
}

/** Only during `--worktree` sessions; absent otherwise. */
function worktreeSeg(d) {
  const w = d.worktree?.name || d.workspace?.git_worktree;
  return w ? seg('worktree', yellow(w)) : '';
}

/** Open PR for this branch, mirroring the footer badge. Absent until one exists. */
function prSeg(d) {
  if (!d.pr?.number) return '';
  const state = d.pr.review_state;
  const tint = state === 'approved' ? green
    : state === 'changes_requested' ? red
      : state === 'draft' ? gray : yellow;
  return seg('pr', tint('#' + d.pr.number) + (state ? gray(' ' + state) : ''));
}

/** "Opus 5 (1M context)" → "Opus 5 1M"; flags fast mode, which changes behaviour. */
function modelSeg(d) {
  let m = d.model?.display_name;
  if (!m) return '';
  const oneM = /1M/.test(m);
  m = m.replace(/\s*\(1M context\)/, '');
  return seg('model', white(m) + (oneM ? gray(' 1M') : '') + (d.fast_mode ? yellow(' ⚡') : ''));
}

/** Only when running under `--agent` / agent settings. */
function agentSeg(d) {
  return d.agent?.name ? seg('agent', magenta(d.agent.name)) : '';
}

/**
 * Vim mode. Only present when vim mode is enabled — and if we ever show it,
 * `statusLine.hideVimModeIndicator` should be set so it isn't rendered twice.
 */
function vimSeg(d) {
  return d.vim?.mode ? seg('vim', yellow(d.vim.mode)) : '';
}

/**
 * Session spend + burn rate. Client-side estimate, not the bill.
 * The rate needs a few minutes of wall-clock before it means anything — early
 * on, one expensive call divided by 40 seconds reads as $400/h.
 */
function costSeg(d) {
  const c = d.cost?.total_cost_usd;
  if (typeof c !== 'number' || c < 0.01) return '';
  const ms = d.cost?.total_duration_ms;
  const perHour = ms > 5 * 60_000 ? c / (ms / 3600_000) : null;
  return seg('cost', magenta(`$${c.toFixed(2)}`) +
    (perHour ? gray(` $${perHour.toFixed(2)}/h`) : ''));
}

/** Wall-clock since the session started — not the same as time spent waiting on the API. */
function elapsedSeg(d) {
  const t = dur(d.cost?.total_duration_ms);
  if (!t) return '';
  // How much of that was actually spent in API calls. Below 10% the session is
  // mostly you reading, and the ratio stops being interesting.
  const api = d.cost?.total_api_duration_ms;
  const share = api > 0 && d.cost?.total_duration_ms > 0
    ? Math.round((api / d.cost.total_duration_ms) * 100) : null;
  return seg('elapsed', white(t) + (share >= 10 ? gray(` ${share}% api`) : ''));
}

/** Reasoning effort — live, so it reflects a mid-session /effort change. */
function effortSeg(d) {
  const l = d.effort?.level;
  if (!l) return '';
  const tint = l === 'max' || l === 'xhigh' ? magenta : l === 'high' ? cyan : white;
  return seg('effort', tint(l) + (d.thinking?.enabled === false ? gray(' no-think') : ''));
}

/**
 * Cache hit ratio — of the input tokens in the current context, how many came
 * from cache rather than being re-sent. High is good and cheap; a sudden drop
 * means the prefix was invalidated and you are paying full freight again.
 *
 * Uses the same input-only basis the docs define for `used_percentage`, so the
 * two numbers are talking about the same denominator.
 */
function cacheSeg(d) {
  const u = d.context_window?.current_usage;
  if (!u) return '';                                   // null before the first call, and after /compact
  const total = (u.input_tokens || 0) + (u.cache_creation_input_tokens || 0) + (u.cache_read_input_tokens || 0);
  if (total < 1000) return '';
  const pct = Math.round(((u.cache_read_input_tokens || 0) / total) * 100);
  const tint = pct >= 80 ? green : pct >= 50 ? cyan : yellow;
  return seg('cache', tint(`${pct}%`));
}

/** Net lines this session — the "did I actually do anything" signal. */
function diffSeg(d) {
  const a = d.cost?.total_lines_added, r = d.cost?.total_lines_removed;
  if (typeof a !== 'number' && typeof r !== 'number') return '';
  if (!a && !r) return '';
  return seg('diff', green('+' + (a || 0)) + gray('/') + red('-' + (r || 0)));
}

/**
 * Signed-in Claude account.
 *
 * NOT in the stdin payload — it lives in ~/.claude.json under
 * `oauthAccount.emailAddress`. That file is ~130 KB, so parsing it on every
 * render would be exactly the kind of per-render cost the docs warn about;
 * it goes through the TTL cache with a long expiry, since the signed-in
 * account changes about as often as the machine is re-provisioned.
 */
function userSeg() {
  const email = cached('identity', 6 * 3600 * 1000, () => {
    const raw = fs.readFileSync(path.join(process.env.HOME, '.claude.json'), 'utf8');
    // Targeted match rather than JSON.parse: on a cache miss this still only
    // scans, and never materialises a 130 KB object graph.
    const m = raw.match(/"emailAddress"\s*:\s*"([^"]+)"/);
    return m ? m[1] : '';
  });
  return email ? seg('user', white(email)) : '';
}
