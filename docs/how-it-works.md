# How the Claude Code status line works

> **Two things in one document.** Sections 1–6 are a **reference for the status line feature itself** —
> useful whether or not you use this script. The rest is **how this implementation works** and why.
>
> **Provenance is marked throughout**: **📘 OFFICIAL** — Anthropic's docs, cited · **🔬 OBSERVED** —
> measured on a real machine · **⚙️ OURS** — a decision this project made.
>
> Primary source: **<https://code.claude.com/docs/en/statusline>** (read 2026-07-28; note
> `docs.claude.com/en/docs/claude-code/statusline` 301s to it). Observed against Claude Code **2.1.220**
> on Linux.

---

## 1. What it is

📘 A customizable bar at the bottom of Claude Code that **runs any shell script you configure**. It
receives JSON session data on stdin and displays whatever the script prints. It renders in its own row
**above** the built-in footer badges and does not replace them.

📘 It runs **locally and consumes no API tokens**. It hides temporarily during some UI interactions —
autocomplete, the help menu, permission prompts.

**Plain English:** it's a tiny program Claude Code runs over and over, handing it a blob of facts about
your session and printing back whatever it says.

---

## 2. Configuring it

📘 Three ways to set one up: the `/statusline` command, the `statusline-setup` agent, or editing
`settings.json` directly. Ours is the third:

```json
"statusLine": {
  "type": "command",
  "command": "node \"/path/to/superfluous-statusline/statusline.js\"",
  "refreshInterval": 30
}
```

| Key | 📘 Meaning |
|---|---|
| `type` | always `"command"` |
| `command` | the shell command to run (required) |
| `padding` | extra horizontal spacing in characters; default `0` |
| `refreshInterval` | also re-run every N seconds **in addition to** event triggers; minimum `1` |
| `hideVimModeIndicator` | hide the built-in `-- INSERT --`, for scripts that render `vim.mode` themselves |

Related keys elsewhere in settings:

- 📘 **`subagentStatusLine`** — a separate per-subagent status line shown in the agent panel; same
  `{type, command}` shape, receives row context on stdin.
- 📘 **`disableAllHooks: true` disables the status line too.** If the bar vanishes, check this *before*
  debugging the script.
- 📘 **`footerLinksRegexes`** — if all you want is clickable badges when an ID appears in conversation,
  use this instead of writing a script.

⚙️ Ours points at an **absolute path into this repo**, so the file you edit is the file that runs — no
copy step, no drift. See the project docs for why, and its cost.

---

## 3. When it runs

📘 Once at session start (including resume), then again when:

- a new assistant message arrives
- `/compact` finishes
- the permission mode changes
- vim mode toggles
- a `refreshInterval` timer elapses, if set

📘 Updates are **debounced at 300ms**, so rapid changes batch. **If a new update triggers while your
script is still running, the in-flight script is cancelled.** Edits to your script take effect on the next
trigger.

📘 Event triggers **go quiet when the session is idle** — e.g. a coordinator waiting on background
subagents. If a segment is time-based (ours are: the reset countdowns), `refreshInterval` is the only way
to keep it current while idle.

> ⚙️ **We set `refreshInterval: 30`.** Our countdowns are time-based, so without it a "resets in 43m"
> sits frozen for as long as the session is idle. 30s is well under the 1-minute granularity we display,
> and the cost is now negligible because the expensive part (git) is cached (§7 #5).

📘 Before v2.1.216, resuming a session ran the command twice in quick succession, so the first result
could flicker.

---

## 4. Output rules

📘 Whatever the script prints to **stdout** is displayed.

| Capability | Status |
|---|---|
| **Multiple lines** | 📘 supported — each `echo`/`print` is a separate row |
| **ANSI colours** | 📘 supported (terminal must support them) |
| **Clickable links** | 📘 OSC 8 escape sequences; needs iTerm2/Kitty/WezTerm. Terminal.app does not support them. `FORCE_HYPERLINK=1` overrides detection |
| **Length** | 📘 "keep output short — long output may get truncated or wrap awkwardly" |

📘 **Failure modes that produce a blank bar, silently:**

- the script exits **non-zero**, or
- the script produces **no output**, or
- **workspace trust** has not been accepted for the directory (`claude --debug` logs
  `Status line command skipped: workspace trust not accepted`).

📘 **Notifications share your row.** MCP errors, auto-update notices, and transient warnings (context-low)
display on the **right side of the same row**; verbose mode adds a token counter there. On narrow
terminals these can truncate your output.

📘 Multi-line output *with escape codes* is **more prone to rendering glitches** than single-line plain
text. If output looks corrupted, simplify.

⚙️ This is why our script never throws and always exits 0 (§7 rule 1): every failure mode above is
invisible, so the script must not add another.

---

## 5. Sizing output to the terminal — the one that bit us

📘 **`tput cols` and language-level width detection cannot read the terminal size from inside the
script.** Claude Code captures stdout instead of connecting it to the terminal. Instead the harness
**exports `COLUMNS` and `LINES`** before running your script (v2.1.153+). Read those.

🔬 What we found the hard way, in order:

1. `process.stdout.columns` is `undefined` — stdout is a pipe. ✅ consistent with the docs.
2. We ran `tput cols` **in a tool shell**, got **80**, and concluded the terminal was 80 columns and the
   bar was overflowing. **Wrong.** `tput` measures the pty of whoever runs it — that was the tool's pty,
   not the user's terminal.
3. The real terminal is **214 columns**, proven by the render recording its own width.
4. We then shipped `tput cols` *inside* the script and it appeared to work — returning the true 214.
   **That was luck.** ncurses consults `$COLUMNS` itself, so `tput` was laundering the very variable we
   should have read directly, at the cost of a subprocess per render.

⚙️ **Now:** `COLUMNS` → `tput` (harmless fallback for < 2.1.153) → `80`. Every render writes what it used
to `~/.cache/statusline-width`, e.g. `214 (via COLUMNS)`.

> **The lesson worth keeping:** "it works" is not "it's correct." A wrong mechanism that returns the right
> answer is a bug that hasn't surfaced yet. And *where you measure* is part of the measurement — a number
> from a different pty, shell, or agent is not evidence about this one.

---

## 6. The data — full field reference

📘 The complete stdin payload. 🔬 marks fields we have actually seen on this machine.

### Identity & session

| Field | Notes |
|---|---|
| `session_id` | 🔬 unique session identifier |
| `session_name` | 🔬 custom name (`--name` / `/rename`) or the AI-generated title. **Absent** for the default `my-app-3f` style name |
| `prompt_id` | 🔬 UUID of the prompt being processed. **Absent** before first user input |
| `transcript_path` | 🔬 path to the conversation `.jsonl` |
| `version` | 🔬 Claude Code version (we saw `2.1.220`) |
| `output_style.name` | 🔬 current output style |
| `agent.name` | agent name. **Absent** unless `--agent` / agent settings |

### Model & mode

| Field | Notes |
|---|---|
| `model.id`, `model.display_name` | 🔬 `claude-opus-5[1m]` / `Opus 5 (1M context)` |
| `fast_mode` | 🔬 bool |
| `thinking.enabled` | 🔬 bool |
| `effort.level` | 🔬 `low`\|`medium`\|`high`\|`xhigh`\|`max`; live, reflects mid-session `/effort`. **Absent** if the model has no effort parameter. Ultracode is *not* a distinct level |
| `vim.mode` | `NORMAL`\|`INSERT`\|`VISUAL`\|`VISUAL LINE`. **Absent** unless vim mode is on |

### Location

| Field | Notes |
|---|---|
| `cwd`, `workspace.current_dir` | 🔬 same value; **`workspace.current_dir` is the preferred one** |
| `workspace.project_dir` | 🔬 where Claude Code was launched — may differ from `cwd` |
| `workspace.added_dirs` | 🔬 from `/add-dir`; `[]` if none |
| `workspace.git_worktree` | worktree name. **Absent** in the main working tree |
| `workspace.repo.host/.owner/.name` | parsed from the `origin` remote. **Absent** outside a git repo with an origin |
| `worktree.name/.path/.branch/.original_cwd/.original_branch` | **Absent** unless a `--worktree` session; `branch`/`original_branch` absent for hook-based worktrees |

### Cost

| Field | Notes |
|---|---|
| `cost.total_cost_usd` | 🔬 **client-side estimate**, may differ from your bill. Resets to $0 on `/clear` (2.1.211+) |
| `cost.total_duration_ms` | 🔬 wall-clock since session start |
| `cost.total_api_duration_ms` | 🔬 time waiting on the API |
| `cost.total_lines_added` / `_removed` | 🔬 lines changed |

### Context window

| Field | Notes |
|---|---|
| `context_window.context_window_size` | 🔬 `200000`, or `1000000` on extended-context models |
| `context_window.total_input_tokens` / `total_output_tokens` | 🔬 **current context, not cumulative** (as of v2.1.132 — older builds differed). `0` before the first API response |
| `context_window.used_percentage` / `remaining_percentage` | 🔬 pre-calculated. May be `null` early |
| `context_window.current_usage` | 🔬 `input_tokens`, `output_tokens`, `cache_creation_input_tokens`, `cache_read_input_tokens`. **`null`** before the first API call *and again after `/compact`* until the next call |

📘 **`used_percentage` is input-only:** `input_tokens + cache_creation_input_tokens + cache_read_input_tokens`.
It excludes `output_tokens`. If you compute it yourself, use the same formula or your number won't match.
📘 It may also differ from `/context` output, because the two are calculated at different moments.

| Field | Notes |
|---|---|
| `exceeds_200k_tokens` | 🔬 bool — a **fixed 200k threshold** regardless of the actual window size, and it counts input + cache + output |

### Rate limits

| Field | Notes |
|---|---|
| `rate_limits.five_hour.used_percentage` | 🔬 0–100 |
| `rate_limits.five_hour.resets_at` | 🔬 **unix epoch seconds** |
| `rate_limits.seven_day.used_percentage` / `.resets_at` | 🔬 same |

📘 **`rate_limits` appears only for Claude.ai subscribers (Pro/Max), and only after the first API response
in the session.** Each window may be independently absent.

### Pull request

| Field | Notes |
|---|---|
| `pr.number`, `pr.url` | open PR for the current branch; mirrors the footer PR badge. **Absent** until found, outside git, or once merged/closed |
| `pr.review_state` | `approved`\|`pending`\|`changes_requested`\|`draft`. May be absent even when `pr` is present |

⚙️ **All of these are now rendered when present** (`pr`, `vim`, `agent`, `worktree`, `workspace.repo`).
They are absent in normal sessions, so they cost nothing until they matter — and when they do appear,
they are exactly the facts you need (you are in a worktree; a PR wants changes; an agent is driving).

### The rule that governs all of it

📘 Fields are **absent** (missing) or **`null`** depending on the case; handle both.
⚙️ Our rule (§7 #2): a missing field means *omit that segment*, never *break the bar*. This is what lets
the script survive a Claude Code update that renames something.

---

## 7. Design rules for our script

1. ⚙️ **Never throw; always exit 0.** A crash blanks the bar with no error anywhere (§4). Every segment
   runs in its own `try`; a thrown segment is dropped and the rest still renders.
2. ⚙️ **A missing field omits a segment, never breaks the bar.**
3. ⚙️ **Silence over noise — but never hide a number you can't get elsewhere.** Cost hides below $0.01 and
   the edit counter at zero; the rate-limit windows are *always* shown, because nothing else in the UI
   reports them.
4. ⚙️ **Colour is a signal, not decoration.** Green/yellow/red mean headroom/attention/urgent.
5. ⚙️ **Cheap.** 📘 The docs warn the script runs frequently and that `git status` causes lag. So:
   the branch is read straight from `.git/HEAD` (**no subprocess at all**), and the only remaining shell
   call — the dirty check — goes through a **4s TTL disk cache**. The account email, which lives in a
   ~130 KB `~/.claude.json`, is cached for 6h and matched by regex rather than `JSON.parse`. Measured
   ~66 ms per warm render.
6. ⚙️ **3-second stdin guard.** If the pipe never closes, exit quietly rather than hang the UI.
7. ⚙️ **Bright colours, not dim.** Bright ANSI slots (90–97) + bold, never SGR 2 — bright slots follow the
   terminal's own theme, unlike hard-coded `38;5;N`. Gray (90) for separators and secondary labels only.
8. ⚙️ **Write the payload cache atomically.** Renders fire constantly; a plain write lets a reader see a
   truncated file (it did). Write to `<dest>.<pid>.tmp` then `rename()`.
9. ⚙️ **Fit the terminal; never wrap.** Size from `COLUMNS` (§5), check the assembled line against
   `W - 1` — a glyph in the final column wraps some terminals — and strip alignment padding at
   end-of-line, including when it sits inside a colour span and trails an ANSI reset.

---

## 8. Our layout

```
dir code/my-project | branch main* | model Opus 5 1M | cost $14.42 | diff +1139/-40 | user you@example.com
ctx █████████████████████▎░░░░░░ 76%  | active session ███████░░░░░░░░░░░░░░░░░░░░░ 25%  resets in 12m | weekly ██████████████████▍░░░░░░░░░ 66%  resets in 14h
```

Three logical groups, **packed greedily into as few lines as fit**:

- **identity** — where am I, on what, as whom
- **economics** — what is this session costing, and how hard is it thinking
- **meters** — context headroom and both plan windows

Groups merge from the top while the joined string fits in `W - 1`, so a wide terminal collapses to one or
two lines and a narrow one gets three. Merging is decided by **measuring**, never by a width threshold, so
it can't drift out of step with the content. Observed: 2 lines at ≥214 columns, 3 below ~180.
- ⚙️ Segments are separated by a literal **`|`** (operator's choice) and **every segment is labelled**.
  A bare value teaches nothing — `$14.42` and `main` only read as cost and branch if you already know the
  layout by heart.

### Line 1 segments

Rendered in reading order — where → what → who — but **dropped in priority order** when space runs out.

| Order | Segment | Source | Priority | Shown |
|---|---|---|---|---|
| 1 | `dir` | `workspace.current_dir` | 100 | always |
| 2 | `repo` | `workspace.repo.owner/name` | 30 | in a repo with an `origin` |
| 3 | `branch` | `.git/HEAD` + cached dirty check | 90 | in a git repo |
| 4 | `worktree` | `worktree.name` / `workspace.git_worktree` | 70 | worktree sessions |
| 5 | `pr` | `pr.number` + `pr.review_state` | 75 | open PR on this branch |
| 6 | `model` | `model.display_name`, `fast_mode` | 80 | always |
| 7 | `agent` | `agent.name` | 65 | `--agent` sessions |
| 8 | `vim` | `vim.mode` | 60 | vim mode on |
| 9 | `user` | `~/.claude.json` → `oauthAccount.emailAddress` | 55 | always |

### Economics segments

Split from identity because they answer a different question — not *where am I* but *what is this costing*.
Same priority-drop treatment.

| Segment | Source | Priority | Shows |
|---|---|---|---|
| `cost` | `cost.total_cost_usd` + `total_duration_ms` | 90 | `$14.42 $10.93/h` — the rate is suppressed for the first 5 minutes, when one expensive call over 40s reads as $400/h |
| `elapsed` | `cost.total_duration_ms`, `total_api_duration_ms` | 80 | `1h19m 27% api` — wall-clock, plus how much of it was actually spent waiting on the API (hidden below 10%) |
| `effort` | `effort.level`, `thinking.enabled` | 70 | `medium`; `max`/`xhigh` magenta, `high` cyan. Live — reflects a mid-session `/effort` |
| `cache` | `context_window.current_usage` | 50 | share of context input tokens served from cache. Green ≥80%. A sudden drop means the prefix was invalidated and you're paying full freight |
| `diff` | `cost.total_lines_added/_removed` | 40 | `+1139/-40` |

**Why priorities.** With every optional field present, line 1 is 250+ columns. Unlike the meters there is
no cheaper way to render `cost $14.42`, so when the line doesn't fit the **lowest-priority segments are
dropped whole**. Explicit dropping beats truncation: losing `repo` entirely is legible; losing the
right-hand third of the line to a hard cut is not. Before anything is dropped, the **email is shortened to
its local part** (`you`) — that still answers "which account is this?", which is why it's there.

> ⚙️ **The email is not in the payload.** No field carries the signed-in account, so it is read from
> `~/.claude.json` (`oauthAccount.emailAddress`) — cached 6h, regex-matched rather than `JSON.parse`d,
> because that file is ~130 KB and this runs on every render. Note this is the **Claude account**, which
> is not the same as `git config user.email` (`you@git.example.com` here).

### Meters

`label ▸ bar ▸ percentage ▸ reset`. Full blocks `█` filled, `░` track, **eighth-blocks** (`▏▎▍▌▋▊▉`) on
the leading edge so the bar advances smoothly rather than a cell at a time. Filled portion carries the
colour, track stays gray — the boundary is the point of a bar over a number.

| Meter | Label | Source | Thresholds |
|---|---|---|---|
| context | `ctx` | `context_window.remaining_percentage` (**left**, not used) | green >25% · yellow ≤25% · red ≤10% |
| 5-hour | `active session` | `rate_limits.five_hour` | green <50% · cyan ≥50% · yellow ≥75% · red ≥90% |
| 7-day | `weekly` | `rate_limits.seven_day` | same |

Labels are **words, not codes** — `5h`/`7d` said nothing about what they measured. Reset countdowns are
**spelled out** (`resets in 12m`); they were briefly a `↻` glyph the operator couldn't read, and a symbol
that needs explaining is not a label. Percentages are padded to a fixed column so the `|` separators don't
jump as digits are gained and lost.

Bar width is **computed**: fixed costs are summed **from the actual strings** — never assumed, or a rename
silently mis-sizes everything — subtracted from `COLUMNS`, and the remainder split between the meters,
capped at 28 cells.

### Pace markers — the thing the raw percentage can't tell you

`resets_at` is the **end** of the window and the window length is known (5h, 7d), so elapsed time is
derivable — and with it, the two questions a bare "68%" cannot answer.

**The tick (`┃`)** marks where the fill *would* be if you burned the window evenly:

```
on pace          weekly ███████████▎┃░░░░░░░░░░░░░░░ 41%  resets in 4d
ahead of pace    weekly ████████┃██████████░░░░░░░░░ 68%  cap in ~22h35m
under-using      weekly ███▎░░░░░░░░░░░░░░░░┃░░░░░░░ 12%  resets in 2d
```

Fill **past** the tick means you're burning faster than the window replenishes. That escalates the meter's
colour one step even when the raw percentage still looks comfortable — being at 68% is fine on day six and
alarming on day two.

**The projection** replaces the reset countdown when the current burn rate would hit 100% *before* the
window resets: `cap in ~22h35m` instead of `resets in 2d`. "Resets in 2d" is cold comfort if you run out in
22 hours. When the projection lands after the reset there's nothing to warn about, so the countdown stays.

Guards: no pace or projection within the first minute of a window (the rate is pure noise), if `resets_at`
is missing or past, or if the time remaining exceeds the window length (a window we can't reason about).

### The fallback ladder

Below ~100 columns the words + reset phrases + three bars cannot fit, and clamping the bar to a minimum
width does **not** rescue that — it overflows instead (it did, at 80). So three variants are tried and the
first that *measures* as fitting wins:

| # | Variant | Kicks in |
|---|---|---|
| 1 | full words + reset phrase | ≥100 cols |
| 2 | short codes `5h`/`7d` + reset phrase | ~75–100 cols |
| 3 | short codes, no reset phrase | <75 cols |

Verified: no overflow at any width from 60 to 250, with both a normal payload and one carrying every
optional field.

---

## 8b. Configuration

⚙️ Everything on the bar is toggleable, because "useful" is personal — someone on API billing has no rate
limits to show, someone screen-sharing doesn't want their email up there, someone on a laptop has no room
for three meters.

**Three sources, later winning over earlier:**

1. built-in defaults (everything on)
2. a JSON file — `$STATUSLINE_CONFIG`, else `~/.claude/statusline.json`
3. CLI flags on the `command` string in `settings.json`

Flags win because `settings.json` is the file you're already editing to install this; a per-machine tweak
shouldn't require a second one.

```json
{
  "segments": { "cost": false, "user": false },
  "pace": true, "projection": true, "labels": true,
  "maxBarWidth": 28, "separator": " | ", "singleLine": false
}
```

```
--no-cost  --no-user  --no-pace  --no-projection  --no-labels
--only=dir,branch,ctx   --bar=20   --sep=" · "   --single-line
```

**Segment keys** — `dir repo branch worktree pr model agent vim user` (identity) ·
`cost elapsed effort cache diff` (economics) · `ctx session weekly` (meters).

**`node statusline.js --list`** prints every segment and switch with its current value and the config
source. It is the authoritative list: the `/statusline-config` skill reads it rather than carrying its own
copy, so the two can't drift.

Behaviour worth knowing:

- **A broken config file is ignored, not fatal.** Defaults stand rather than the bar blanking — the failure
  mode for this script is always "show less", never "show nothing".
- **`singleLine` drops, it does not shrink.** Groups stay in order and any that won't fit the row is
  dropped whole. On a narrow terminal that can cost you the meters, so pair it with `--only=`.
- **Turning everything off blanks the bar** — legitimate, but it looks identical to a crash.
- Meters keep their labels even under `labels: false`; three unlabelled bars are unreadable.

---

## 8c. Platforms

⚙️ The script is written to run on Linux, macOS and Windows. What that took, and what is actually proven,
are two different things — both are recorded here.

### What Windows breaks, and the fix

| Assumption | Why it fails on Windows | Fix |
|---|---|---|
| `process.env.HOME` | Windows uses `USERPROFILE`; `$HOME` is undefined, and `path.join(undefined, …)` **throws** | `os.homedir()` |
| `'/tmp'` fallback | not a path on Windows | `os.tmpdir()` |
| `cwd.split('/')` | Windows paths are `\`-separated, so `C:\Users\me\code` is **one** component and the directory never shortens | split on `/[\\/]+/`, always render with `/` |
| `cwd.startsWith(home)` | NTFS is case-insensitive, so `C:\Users\Me` vs `C:\users\me` misses | case-insensitive compare on Windows only |
| `tput cols` fallback | no `tput`; spawns a doomed process on every render | skipped entirely when `process.platform === 'win32'` |
| `~/.cache` exists | true by convention on Linux, **not** on Windows or a fresh macOS — every cache write failed silently, so the 130 KB identity file was re-read on every render | `mkdirSync(recursive)` at startup |

📘 One more, from the docs: **on Windows with Git Bash installed, backslashes in the `command` path are
consumed as escape characters before the script runs.** Use **forward slashes** in `settings.json` even on
Windows.

### What is actually verified

**Verified — by simulating Windows conditions on Linux:**

- Windows-shaped paths render correctly: `C:\Users\you\code\my-project` → `code/my-project`,
  drive roots, and UNC paths (`\\server\share\proj`)
- `HOME` unset entirely — resolves and renders
- cache directory created when absent
- `git` binary missing from `PATH` — branch still renders (it comes from `.git/HEAD`), only the dirty
  marker disappears
- not a git repo — branch segment omits itself
- read-only home — cache writes fail silently, bar renders
- the full 60–250 column sweep still clean after the platform changes

**NOT verified — no Windows or macOS machine was available:**

- that ANSI bright colours render in the target terminal
- that the font has the block glyphs (`█ ░ ▏▎▍▌▋▊▉ ┃`)
- that Claude Code exports `COLUMNS` on Windows (if not, the bar falls back to 80 columns — it degrades,
  it doesn't break)
- that `git.exe` resolves through `execFileSync('git', …)` (CreateProcess should append `.exe`, untested)
- `rename()` behaviour under Windows file locking — the atomic cache write may occasionally fail there,
  which is caught and non-fatal

> **Say this accurately.** The code paths are handled and the failure modes degrade rather than crash. That
> is *not* the same as "tested on Windows", and the README does not claim it is.

---

## 8d. The other three modes

The script is one file with four entry points. Everything below `--subagent` is a mode, not a segment.

### `install` / `uninstall`

```bash
node statusline.js install       # wires BOTH bars into ~/.claude/settings.json
node statusline.js uninstall     # removes both
```

Merges rather than overwrites, backs up to a **timestamped** `settings.json.bak-<iso>` (so running it
twice doesn't destroy the pre-install original), and **refuses to proceed if `settings.json` is
unparseable** — overwriting a file you can't read is how someone loses their whole configuration. Then it
renders a preview, because "installed" isn't a claim worth making without output behind it.

It installs `subagentStatusLine` too. Nobody discovers that setting on their own, and it costs nothing
when no agents are running.

### `--doctor`

Diagnoses an install. Every failure mode here is silent — a script that exits non-zero, prints nothing, or
was never wired up all look identical: a blank bar, no error. So the check reports what it actually found:

- is `settings.json` valid, and does `statusLine` point at **this** file (not another copy)?
- is `refreshInterval` set — otherwise countdowns freeze while idle
- is `disableAllHooks` on, which silently disables the status line too
- what width did the **last real render** see (from `~/.cache/statusline-width` — not a `tput` here, which
  would measure the wrong pty)
- is the payload cache fresh, and did it contain `rate_limits`
- does the config file parse — an unparseable one is *ignored*, so settings appear not to apply
- is the cache writable; is `git` runnable

Exits non-zero on failure so it can be used as a check.

> One diagnostic was wrong before it was right: `git` on this machine is a wrapper script under `$HOME`,
> so it *executes* fine normally but fails when `HOME` is unusual. Reporting that as "not found on PATH"
> sent me looking in the wrong place. It now distinguishes ENOENT from a run failure and prints the error.

### `--subagent`

📘 A **separate Claude Code setting**, `subagentStatusLine`, rendering one row per subagent in the agent
panel — replacing the default `name · description · token count`.

The contract differs from the main bar:

| | main bar | subagent bar |
|---|---|---|
| stdin | one session object | one object with `columns` **and a `tasks` array** |
| width | must be discovered from `COLUMNS` | **handed to you** as `columns` |
| stdout | the bar text | **one JSON line per row**: `{"id": …, "content": …}` |
| opting out | n/a | omit a task → default row; `content: ""` → hide it |

Per task: `id`, `name`, `type`, `status`, `description`, `label`, `startTime`, `model`, `effort`,
`contextWindowSize`, `tokenCount`, `tokenSamples`, `cwd`. 📘 `model`/`contextWindowSize` need CC ≥ 2.1.205
and are absent until the model resolves; `effort` needs ≥ 2.1.214 and is absent when the subagent inherits
the session's effort.

Our row: status glyph · name · context meter from `tokenCount / contextWindowSize` · elapsed · model ·
effort · description.

```
▶ review:auth █▊░░░░░░░░ 18% 40m opus-5 high Reviewing the session token refresh path for race conditions
✓ find:callsites █████████░ 91% 25m sonnet-5 Locate every caller of resolveCwd across the repo
◦ security-auditor 10m Waiting on t1
✗ flaky █████████▊ 98% 8m haiku-4-5 Broke
```

Same measure-then-degrade approach as the main bar: six variants widest-to-narrowest, and the description
(the only arbitrarily-long field) is **truncated before any field is dropped**. A row we can't render at
all returns `''`, which keeps Claude Code's default rather than blanking it. Verified 25–200 columns.

---

## 9. Testing it

⚙️ The file in this repo **is** the file that runs, so edit and the next render shows it.

```bash
# real data — the last live payload doubles as a fixture
node statusline.js < ~/.cache/statusline-last.json

# at a specific width (this is exactly how the harness does it)
COLUMNS=80 node statusline.js < ~/.cache/statusline-last.json

# degenerate input — must still exit 0
echo '{}'       | node statusline.js
echo 'not json' | node statusline.js; echo "exit=$?"
```

📘 The docs' own suggested smoke test:

```bash
echo '{"model":{"display_name":"Opus"},"workspace":{"current_dir":"/home/user/project"},"context_window":{"used_percentage":25},"session_id":"test"}' | node statusline.js
```

> ⚠️ **Measure display width with a character-aware tool, not `awk`/`wc -c`.** `█` is three bytes, so
> byte-counting reported a 76-column line as 158, and later reported a real overflow as fine. This wasted
> a cycle twice. Use Python and strip ANSI first.

### Re-capturing the payload contract

Every render writes its raw stdin to `~/.cache/statusline-last.json`. After a Claude Code update, refresh
§6 from fact rather than memory:

```bash
python3 -c "
import json
d=json.load(open('~/.cache/statusline-last.json'))
def walk(o,p=''):
    if isinstance(o,dict):
        for k,v in o.items(): walk(v,f'{p}.{k}' if p else k)
    else: print(f'  {p:42} {str(o)[:60]}')
walk(d)"
```

📘 Debugging aids: `claude --debug` logs the exit code and stderr of the first invocation in a session.

---

## 10. Gaps — closed 2026-07-28

All five gaps this document previously listed are now closed:

| # | Gap | Resolution |
|---|---|---|
| 1 | No `refreshInterval` | **`refreshInterval: 30`** — countdowns stay live while idle |
| 2 | Git calls uncached | Branch read from `.git/HEAD` (no subprocess); dirty check on a **4s TTL disk cache** |
| 3 | `workspace.repo` unused | Rendered as the `repo` segment, straight from the payload |
| 4 | `pr` / `vim` / `agent` / `worktree` unused | All rendered when present |
| 5 | `padding` unset | **Evaluated; deliberately left at `0`.** The harness applies padding *outside* the script, so the script can't see it — any non-zero value would silently shrink the usable width below the `COLUMNS` we size against, reintroducing exactly the wrapping the layout works to avoid. The bar manages its own edges. |

Remaining known trade-offs, stated rather than hidden:

- The **dirty marker can be up to 4s stale**. Deliberate: it buys back a `git status` per render.
- The **email is cached 6h**, so switching accounts won't show for up to 6h (`rm ~/.cache/statusline-identity`
  to force it).
- `refreshInterval: 30` means the script runs on a timer forever, even when idle. That is the price of a
  live countdown; the work per run is ~66 ms and mostly cached.

---

## 11. Sources

- 📘 **<https://code.claude.com/docs/en/statusline>** — the official page; everything marked 📘 comes from
  it (read 2026-07-28). `docs.claude.com/en/docs/claude-code/statusline` 301-redirects here.
- 📘 Settings schema — the `statusLine` / `subagentStatusLine` / `disableAllHooks` key definitions, also
  visible in the local `update-config` skill's bundled schema.
- 🔬 `~/.cache/statusline-last.json` — last live payload (Claude Code 2.1.220).
- 🔬 `~/.cache/statusline-width` — last measured width and its source.
- Community prior art referenced by the docs: [ccstatusline](https://github.com/sirmalloc/ccstatusline),
  [starship-claude](https://github.com/martinemde/starship-claude).

---

## 12. History — and the mistakes worth keeping

Recorded because each is a trap the next person can fall into.

- **Built against 4 guessed fields**, then rebuilt against the full payload once a live render was
  captured. **This is why the script caches every payload** — the contract stays verified from fact.
- **The payload cache was written non-atomically**, and a live render truncated it mid-read.
- **"The terminal is 80 columns" — wrong.** `tput cols` in a *different shell* measures that shell's pty.
  The real terminal was 214. Where you measure is part of the measurement.
- **`tput cols` inside the script appeared to work.** Luck: ncurses reads `$COLUMNS` itself — the variable
  the docs tell you to read directly. **"It works" is not "it's correct."**
- **A minimum bar width made things worse** — clamping to ≥6 cells overflowed instead of rescuing.
  Degrade *content*, never legibility.
- **Renaming a label broke the layout**, because the width budget had the old label's length baked in.
- **`awk`/`wc -c` count bytes, and `█` is three of them.** Byte-counting called a 76-column line 158, then
  called a real overflow fine.
- **`~/.cache` was assumed to exist** — true on Linux, false on Windows and fresh macOS. Every cache write
  failed silently and a 130 KB file was re-read on every render, with the bar still looking correct.
- **Trailing whitespace survived** because the trimmer expected one ANSI reset and empty content emitted
  two. Fixed by not emitting escapes for empty content at all.
- **"git not found on PATH" was the wrong diagnosis** — git was a wrapper script under `$HOME` that failed
  only when `HOME` was unusual. Distinguish "absent" from "present but broken."
