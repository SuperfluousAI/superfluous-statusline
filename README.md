# superfluous-statusline

A status line for [Claude Code](https://code.claude.com) that shows **where you are, what you're running,
and how much of your plan you've burned** — with real progress bars for context and both rate-limit
windows.

```
dir code/my-project | branch main* | model Opus 5 1M | user you@example.com
cost $14.42 $6.40/h | elapsed 2h14m 27% api | effort medium | cache 94% | diff +1139/-40
ctx █████████████████░░░░░░░░░░░ 61% | active session ██████████░░░░┃░░░░░░░░░░░░░ 36% resets in 10m | weekly ████████┃██████████░░░░░░░░░ 68% cap in ~22h
```

**The part you can't get anywhere else:** your **5-hour** and **7-day** plan usage, with a countdown to
each reset. Claude Code knows both and surfaces neither — the 7-day window in particular is invisible
until you're already up against it.

**And the part that makes it actionable:** a **pace tick** (`┃`) on each meter showing where you'd be at
an even burn. Fill past the tick means you're going faster than the window replenishes — and if the
current rate would hit the cap *before* the reset, the countdown flips to say so:

```
on pace          weekly ███████████▎┃░░░░░░░░░░░░░░░ 41%  resets in 4d
ahead of pace    weekly ████████┃██████████░░░░░░░░░ 68%  cap in ~22h35m
under-using      weekly ███▎░░░░░░░░░░░░░░░░┃░░░░░░░ 12%  resets in 2d
```

68% is fine on day six and alarming on day two. The tick is what tells you which one you're in.

## Why you might want this one

- **Real meters, not numbers.** Eighth-block bars (`▏▎▍▌▋▊▉`) so they move smoothly, colour-coded by
  headroom, with pace ticks on the plan windows.
- **Session economics.** Spend rate per hour, elapsed wall-clock and what share of it was actually spent
  waiting on the API, reasoning effort, and cache-hit ratio.
- **Every segment is labelled.** `cost $14.42`, not a bare `$14.42` you have to decode by position.
- **All of it is optional.** Every segment and switch toggles from a config file, CLI flags, or the
  bundled `/statusline-config` skill.
- **It fits your terminal.** Sizes itself from `COLUMNS`. Three groups — identity, economics, meters —
  packed into as few lines as fit, with the least important segments dropped before it would ever wrap.
  Verified from 60 to 250 columns.
- **It can't blank your bar.** Every segment is independently sandboxed and the script always exits 0 — a
  status line that crashes disappears with no error shown anywhere.
- **It's fast.** No `git status` on the hot path: the branch is read straight from `.git/HEAD`, the dirty
  check is cached. ~66 ms per render.
- **Zero dependencies.** One file, Node's standard library only.

## Requirements

- **Claude Code** — v2.1.153+ recommended (that's when `COLUMNS` started being exported; older versions
  fall back to 80 columns)
- **Node.js 18+**
- A terminal with ANSI colour and Unicode block glyphs (`█ ░ ▏▎▍▌▋▊▉ ┃`)

### Platform support — stated honestly

| Platform | Status |
|---|---|
| **Linux** | ✅ developed and tested here |
| **macOS** | ⚠️ every code path is handled; **not run on a Mac.** Expected to work — it's the same POSIX paths as Linux |
| **Windows** | ⚠️ every Windows-specific path is handled and simulated (see below); **not run on Windows** |

Windows needed real fixes, not just goodwill: `$HOME` is undefined there (`USERPROFILE` instead) and the
old code **threw**; paths are `\`-separated so the directory never shortened; NTFS is case-insensitive so
the `~` substitution missed; `tput` doesn't exist; and `~/.cache` isn't created for you — which also
turned out to be a **silent bug on fresh macOS installs**, where every cache write failed and a 130 KB
file was re-read on every render while the bar still looked perfectly fine.

Simulated and verified on Linux: Windows-shaped paths (`C:\Users\…`, drive roots, UNC `\\server\share`),
`HOME` unset, missing cache dir, missing `git`, non-repo directories, and a read-only home.

**Not verified** — no Mac or Windows machine was available: that your terminal renders bright ANSI, that
your font has the block glyphs, that Claude Code exports `COLUMNS` on Windows (if it doesn't, the bar
falls back to 80 columns — it degrades, it doesn't break), and that `git.exe` resolves. **If you run this
on macOS or Windows, please open an issue either way** — a confirmation is as useful as a bug.

## Install

```bash
npx superfluous-statusline install
```

That's it. `install` writes the config into `~/.claude/settings.json` — **merging**, so your other
settings are untouched — backs up the old file first, and prints the bar rendered as proof:

```
✓ backed up  ~/.claude/settings.json.bak-2026-07-29T04-00-29-918Z
✓ statusLine node "/home/you/.claude/superfluous-statusline/statusline.js"
✓ subagent   node "/home/you/.claude/superfluous-statusline/statusline.js" --subagent
✓ wrote      ~/.claude/settings.json

  preview
    dir code/my-project | branch main | model Opus 5
    ctx ██████████████▋░░░░░░░░░ 61% | active session ████████▋░░░░░░░░░░░░░░░ 36%

→ appears on the next update (a new message, /compact, or 30s)
```

It refuses to touch `settings.json` if it isn't valid JSON, rather than overwriting a file it can't read.

**npx is the installer, not the runtime.** `npx` executes from `~/.npm/_npx/<hash>/`, a cache npm may
evict at any time — writing *that* path into `settings.json` would work today and leave you with a blank
bar weeks later, with nothing to explain it. So when it detects a temporary location, `install` copies
itself (and the skill) to `~/.claude/superfluous-statusline/` and points there. Verified: the bar still
renders after the npx cache is deleted.

**Prefer a git clone?** Then the file you edit is the file that runs, and `git pull` updates it live:

```bash
git clone https://github.com/SuperfluousAI/superfluous-statusline.git ~/.claude/superfluous-statusline
node ~/.claude/superfluous-statusline/statusline.js install
```

To reverse either: `npx superfluous-statusline uninstall` (or `node statusline.js uninstall`).

<details>
<summary>Or configure it by hand</summary>

Edit `~/.claude/settings.json`:

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"/absolute/path/to/superfluous-statusline/statusline.js\"",
    "refreshInterval": 30
  }
}
```

**Use an absolute path** — `~` is not expanded inside the `command` string by every shell it may run
under. Print one with:

```bash
echo "node \"$HOME/.claude/superfluous-statusline/statusline.js\""
```

### On Windows

Same steps, with one trap. **Use forward slashes in the path, even on Windows.** Anthropic's docs are
explicit: with Git Bash installed, backslashes in the `command` string are consumed as escape characters
before your script ever runs.

```json
{
  "statusLine": {
    "type": "command",
    "command": "node \"C:/Users/you/.claude/superfluous-statusline/statusline.js\"",
    "refreshInterval": 30
  }
}
```

Config and caches live under `%USERPROFILE%` (`.claude\statusline.json`, `.cache\statusline-*`) — the
script resolves your home directory itself rather than reading `$HOME`, which doesn't exist there.

The bar appears on the next update (a new message, `/compact`, or within `refreshInterval` seconds). No
restart needed.

</details>

## Something wrong? Ask the doctor

Every way a status line can fail is **silent** — a script that exits non-zero, prints nothing, or was
never wired up all look identical: a blank bar, no error anywhere. So don't guess:

```bash
npx superfluous-statusline --doctor      # or: node statusline.js --doctor
```

```
  ok   node v22.14.0 on linux
  ok   settings.json → this file
  ok   last real render saw 214 (via COLUMNS)
  ok   payload cache fresh (1s old), Claude Code 2.1.220
  warn no refreshInterval — reset countdowns will freeze while the session is idle
  fail config is not valid JSON, so it is being IGNORED — ~/.claude/statusline.json
```

It checks whether `settings.json` points at *this* file or a stale copy, whether `disableAllHooks` is
silently killing it, what width the last **real** render saw, whether your config actually parses, and
whether git and the cache are usable. Exits non-zero on failure, so you can use it as a check.

## Agent panel rows

`install` also sets up `subagentStatusLine` — a separate Claude Code setting that replaces the default
`name · description · token count` row for each subagent with something you can actually read:

```
▶ review:auth █▊░░░░░░░░ 18% 40m opus-5 high Reviewing the session token refresh path for race conditions
✓ find:callsites █████████░ 91% 25m sonnet-5 Locate every caller of resolveCwd across the repo
◦ security-auditor 10m Waiting on t1
✗ flaky █████████▊ 98% 8m haiku-4-5 Broke
```

Status glyph, name, its **own context meter** (from that agent's token count against its model's window),
elapsed time, model, effort, and what it's doing. Rows shrink to fit the panel — the description truncates
before any field is dropped — and a row that can't render keeps Claude Code's default rather than going
blank. Verified 25–200 columns.

### Why `refreshInterval: 30`

The reset countdowns are time-based, and Claude Code's event triggers go quiet while a session is idle —
without a timer, `resets in 43m` freezes on screen. 30s is well under the one-minute granularity shown.
Leave it out if you'd rather the script never runs on its own.

## Verify it works

```bash
# feed it a payload by hand — should print two lines
echo '{"workspace":{"current_dir":"'"$PWD"'"},"model":{"display_name":"Opus 5"},
"context_window":{"remaining_percentage":61},
"rate_limits":{"five_hour":{"used_percentage":36},"seven_day":{"used_percentage":68}}}' \
  | node statusline.js

# at a specific width, exactly how Claude Code invokes it
COLUMNS=100 node statusline.js < ~/.cache/statusline-last.json

# it must survive anything
echo '{}' | node statusline.js
echo 'not json' | node statusline.js; echo "exit=$?"   # exit=0
```

After it has rendered once, `~/.cache/statusline-last.json` holds your real payload — the most useful
fixture for testing changes.

## What each part means

**Identity — where you are**

| Segment | Shows |
|---|---|
| `dir` | working directory, `~`-relative; basename only on a narrow terminal |
| `repo` | `owner/name`, parsed by Claude Code from your `origin` remote |
| `branch` | git branch, with a red `*` when tracked files are dirty |
| `worktree` | worktree name — only during `--worktree` sessions |
| `pr` | open PR number + review state, tinted (approved green, changes-requested red, draft gray) |
| `model` | model name; `1M` tag for extended context, `⚡` when fast mode is on |
| `agent` | agent name — only under `--agent` |
| `vim` | current vim mode — only when vim mode is enabled |
| `user` | your signed-in Claude account |

**Economics — what it's costing**

| Segment | Shows |
|---|---|
| `cost` | session spend and `$/h`. The rate is hidden for the first 5 minutes, where one expensive call over 40 seconds reads as $400/h |
| `elapsed` | wall-clock, plus what share was actually spent *waiting on the API* (hidden below 10% — the rest of the time is you reading) |
| `effort` | reasoning effort. Live, so it reflects a mid-session `/effort` |
| `cache` | share of context input tokens served from cache. Green ≥80%. A sudden drop means your prefix was invalidated and you're paying full freight again |
| `diff` | lines added/removed this session |

**Meters — headroom**

| Meter | Shows |
|---|---|
| `ctx` | context window **used**. Fills up as you spend it — same direction and the same colour scale as the two plan meters, so all three read identically |
| `active session` | your 5-hour plan window |
| `weekly` | your 7-day plan window |

Meters use full blocks `█` with eighth-block leading edges (`▏▎▍▌▋▊▉`) so they advance smoothly instead of
jumping a cell at a time. The filled part carries the colour; the track stays gray so the boundary is
unmistakable.

## How the pace tick works

`resets_at` tells you when a window resets, and the window length is fixed (5 hours, 7 days) — so **elapsed
time is derivable**, and with it two things a bare percentage cannot tell you.

**Where you should be.** If you burned the window evenly, the fill would sit at `elapsed ÷ window`. That
position is drawn as `┃`:

```
weekly ███████████▎┃░░░░░░░░░░░░░░░ 41%   ← on pace: fill sits at the tick
weekly ████████┃██████████░░░░░░░░░ 68%   ← past the tick: burning faster than it replenishes
weekly ███▎░░░░░░░░░░░░░░░░┃░░░░░░░ 12%   ← behind the tick: plenty spare
```

**68% is fine on day six and alarming on day two.** The tick is what distinguishes them — and being past it
escalates the meter's colour one step even when the raw number still looks comfortable.

**When you'd actually run out.** From used-percent and elapsed time you get a burn rate, and from that the
moment it would reach 100%. If that lands *before* the reset, it replaces the countdown:

```
weekly ████████┃██████████░░░░░░░░░ 68%  cap in ~22h35m     (instead of "resets in 2d")
```

Because "resets in 2d" is cold comfort if you run out in 22 hours. If the projection lands after the reset
there's nothing to warn about, so the countdown stays.

Guards: nothing is shown in the first minute of a window (the rate is pure noise), or when `resets_at` is
missing or already past, or when the time remaining exceeds the window length.

## Configuring it

Everything is toggleable — "useful" is personal. Someone on API billing has no plan windows to show;
someone screen-sharing doesn't want their email up there.

**See what's on:**

```bash
node statusline.js --list
```

That prints every segment and switch with its current value and which config file is in effect. It's the
authoritative list — start there. Every field it can draw from, including the ones off by default, is
catalogued in [`docs/how-it-works.md` §6](docs/how-it-works.md).

**Option A — a config file** at `~/.claude/statusline.json` (or wherever `$STATUSLINE_CONFIG` points):

```json
{
  "segments": { "cost": false, "user": false, "cache": false },
  "pace": true,
  "projection": true,
  "labels": true,
  "maxBarWidth": 28,
  "separator": " | ",
  "singleLine": false
}
```

**Option B — flags on the command** in `settings.json`. These win over the file:

```
--no-cost  --no-user  --no-pace  --no-projection  --no-labels
--only=dir,branch,ctx   --bar=20   --sep=" · "   --single-line
```

**Segment keys:** `dir repo branch worktree pr model agent vim user` · `cost elapsed effort cache diff` ·
`ctx session weekly`

**Or just ask Claude.** Copy the bundled skill in and it'll do it conversationally:

```bash
mkdir -p ~/.claude/skills
cp -r ~/.claude/superfluous-statusline/skill/statusline-config ~/.claude/skills/
```

Then `/statusline-config hide my email and the cost` — it reads the live config, edits the file, and shows
you the bar rendered before and after.

### Config gotchas

- **A broken config file is ignored, not fatal.** Defaults stand rather than the bar vanishing — the
  failure mode here is always "show less", never "show nothing". So if a setting seems not to apply, check
  the JSON parses: `python3 -m json.tool ~/.claude/statusline.json`.
- **Flags beat the file.** A file setting that appears to do nothing usually has a contradicting flag on
  the `command` string.
- **`singleLine` drops, it doesn't shrink.** Groups keep their order and any that won't fit the row is
  dropped whole — on a narrow terminal that can cost you the meters. Pair it with `--only=`.
- **Turning everything off blanks the bar.** Legitimate, but it looks exactly like a crash.
- Meters keep their labels even with `labels: false` — three unlabelled bars are unreadable.
- Changes apply on the next render. No restart.

## Troubleshooting

**The bar is blank.** Claude Code blanks it silently if the script exits non-zero, prints nothing, or if
you haven't accepted the workspace trust dialog for that directory. Also check `disableAllHooks` isn't
`true` in your settings — it disables the status line too. Then run the script by hand (above) and
`claude --debug`, which logs the exit code and stderr of the first invocation.

**No `active session` / `weekly` bars.** `rate_limits` is only sent to Claude.ai **Pro/Max** subscribers,
and only after the first API response in a session. On API/Console billing it never appears, and the bars
correctly omit themselves.

**No `ctx` bar at the start.** Context fields are `null` until the first API response, and again right
after `/compact`.

**The email is wrong or missing.** It's read from `~/.claude.json` (`oauthAccount.emailAddress`) — your
**Claude** account, not `git config user.email`, which is often a different address. It's read **fresh on
every render and never cached**, so `/login` and account switching show up immediately with nothing to
clear. `--doctor` prints the account it resolved and when that file last changed.

**The dirty `*` is stale.** The `git status` behind it is cached for 4 seconds, deliberately, to keep the
script off the hot path. That cache leaves one small file per repo in `~/.cache/` — a byte each, safe to
delete any time.

**Boxes or `?` instead of bars.** Your terminal font lacks the block glyphs. Use a font with good Unicode
coverage, or swap the characters in `meter()` for `#` and `-`.

## Files

```
statusline.js               the whole thing — one file, no dependencies
package.json                npm manifest (bin: superfluous-statusline)
skill/statusline-config/    optional Claude Code skill: configure the bar by asking
docs/how-it-works.md        the status line feature documented in depth (official contract + this
                            build), the full stdin field reference, and the mistakes made getting here
```

Four entry points in that one file:

| | |
|---|---|
| *(no args)* | render the main bar — what Claude Code calls |
| `--subagent` | render agent-panel rows |
| `install` / `uninstall` | wire both into `settings.json` |
| `--doctor` / `--list` | diagnose an install / show every segment and switch |

[`docs/how-it-works.md`](docs/how-it-works.md) is worth reading even if you write your own — §1–6 document the feature itself:
every settings key, when it re-runs, what the failure modes are, the complete JSON payload with
absent/null semantics, and why `tput cols` doesn't work inside a status line.

## Credits

Built against [Anthropic's status line documentation](https://code.claude.com/docs/en/statusline).
Prior art worth knowing: [ccstatusline](https://github.com/sirmalloc/ccstatusline) and
[starship-claude](https://github.com/martinemde/starship-claude).

## License

[MIT](LICENSE).
