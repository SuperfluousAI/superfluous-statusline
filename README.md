# superfluous-statusline

A status line for [Claude Code](https://code.claude.com) that shows **where you are, what you're running,
and how much of your plan you've burned** — with real progress bars for context and both rate-limit
windows.

```
dir code/my-project | branch main* | model Opus 5 1M | cost $14.42 | diff +1139/-40 | user you@example.com
ctx █████████████████░░░░░░░░░░░ 61% | active session ██████████░░░░░░░░░░░░░░░░░░ 36% resets in 10m | weekly ███████████████████░░░░░░░░░ 68% resets in 14h
```

**The part you can't get anywhere else:** your **5-hour** and **7-day** plan usage, with a countdown to
each reset. Claude Code knows both and surfaces neither — the 7-day window in particular is invisible
until you're already up against it.

## Why you might want this one

- **Real meters, not numbers.** Eighth-block bars (`▏▎▍▌▋▊▉`) so they move smoothly, colour-coded by
  headroom.
- **Every segment is labelled.** `cost $14.42`, not a bare `$14.42` you have to decode by position.
- **It fits your terminal.** Sizes itself from `COLUMNS`, collapses to one line when there's room, splits
  to two when there isn't, drops the least important segments before it would ever wrap. Verified from 60
  to 250 columns.
- **It can't blank your bar.** Every segment is independently sandboxed and the script always exits 0 — a
  status line that crashes disappears with no error shown anywhere.
- **It's fast.** No `git status` on the hot path: the branch is read straight from `.git/HEAD`, the dirty
  check is cached. ~66 ms per render.
- **Zero dependencies.** One file, Node's standard library only.

## Requirements

- **Claude Code** — v2.1.153+ recommended (that's when `COLUMNS` started being exported; older versions
  fall back to a subprocess, then to 80 columns)
- **Node.js 18+**
- A terminal with ANSI colour and Unicode block glyphs — any modern one

## Install

```bash
git clone https://github.com/SuperfluousAI/superfluous-statusline.git ~/.claude/superfluous-statusline
```

Then point Claude Code at it. Either ask Claude — *"set my status line to
`node ~/.claude/superfluous-statusline/statusline.js`"* — or edit `~/.claude/settings.json` yourself:

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

The bar appears on the next update (a new message, `/compact`, or within `refreshInterval` seconds). No
restart needed.

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

## Customising

It's one readable file; edit it directly.

| Want to | Do this |
|---|---|
| Remove a segment | Delete its line from the `l1items` array in `render()` |
| Reorder segments | Edit the `ORDER` array |
| Change what's dropped first when space is tight | Change the priority numbers in `l1items` (higher = kept longer) |
| Change bar characters | `meter()` — `█` filled, `░` track, `EIGHTHS` for the leading edge |
| Change colour thresholds | The `tint` ternaries in `render()` and `contextSeg` |
| Make bars wider/narrower | The `Math.min(28, …)` cap in `buildMeters()` |
| Hide the email | Delete the `userSeg()` line from `l1items` |

Fields available but not used by default — `pr`, `vim`, `agent`, `worktree`, `effort`, `session_name`,
`thinking`, cache-hit counts — are catalogued in
[`docs/how-it-works.md` §6](docs/how-it-works.md).

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

**The email is wrong or missing.** It's read from `~/.claude.json` (`oauthAccount.emailAddress`) and cached
for 6 hours — this is your **Claude** account, not `git config user.email`. Force a refresh with
`rm ~/.cache/statusline-identity`.

**The dirty `*` is stale.** The `git status` behind it is cached for 4 seconds, deliberately, to keep the
script off the hot path.

**Boxes or `?` instead of bars.** Your terminal font lacks the block glyphs. Use a font with good Unicode
coverage, or swap the characters in `meter()` for `#` and `-`.

## Files

```
statusline.js          the whole thing — one file, no dependencies
docs/how-it-works.md   the status line feature documented in depth (official contract + this build),
                       including the full stdin field reference and the mistakes made getting here
```

`docs/how-it-works.md` is worth reading even if you write your own — §1–6 document the feature itself:
every settings key, when it re-runs, what the failure modes are, the complete JSON payload with
absent/null semantics, and why `tput cols` doesn't work inside a status line.

## Credits

Built against [Anthropic's status line documentation](https://code.claude.com/docs/en/statusline).
Prior art worth knowing: [ccstatusline](https://github.com/sirmalloc/ccstatusline) and
[starship-claude](https://github.com/martinemde/starship-claude).

## License

[MIT](LICENSE).
