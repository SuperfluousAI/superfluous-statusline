---
name: statusline-config
description: Configure the Claude Code status line — turn segments on or off (cost, email, cache, plan meters, pace ticks), change bar width, separator, or single-line mode. Reads the live config, edits ~/.claude/statusline.json, and shows the result rendered before and after. Usage: /statusline-config · /statusline-config hide the email and cost · /statusline-config show me what's on.
user_invocable: true
---

# statusline-config — tune the status line

Change what the bar at the bottom of Claude Code shows. Everything is toggleable; nothing here requires
editing the script.

> **Do not confuse this with `/statusline`** — that's the built-in command that *installs* a status line by
> writing `settings.json`. This skill configures **superfluous-statusline** once it's installed.

## 1. Find the script and read the CURRENT state

Never assume what's on. The script prints its own configuration, which is the one authoritative source —
this skill deliberately does not carry its own copy of the segment list, so the two cannot drift.

```bash
# where is it wired up?
python3 -c "import json,os;print(json.load(open(os.path.expanduser('~/.claude/settings.json')))['statusLine'])"

# what's on right now, and which config file is in effect
node <path-from-above> --list
```

`--list` prints every segment grouped as identity / economics / meters, every switch (`pace`,
`projection`, `labels`, `singleLine`, `maxBarWidth`, `separator`), and the config source. **Show the
operator this output** before changing anything — the answer to "what's on?" is this, not your memory.

## 2. Capture a BEFORE render

So the change can be seen, not just claimed. The last live payload is on disk:

```bash
COLUMNS=${COLUMNS:-120} node <script> < ~/.cache/statusline-last.json
```

If `~/.cache/statusline-last.json` doesn't exist yet, the status line hasn't rendered since install — say
so rather than inventing a fixture.

## 3. Make the change

Two places it can live. **Prefer the config file** unless the operator wants the change tied to one
machine's `settings.json`:

**`~/.claude/statusline.json`** — merge into the existing file, never overwrite it blind (read it first;
it may already hold their choices):

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

**Or flags on the command** in `~/.claude/settings.json` — these WIN over the file:

```
--no-cost --no-user --no-pace --bar=20 --sep=" · " --only=dir,branch,ctx --single-line --no-labels
```

Segment keys: `dir repo branch worktree pr model agent vim user` · `cost elapsed effort cache diff` ·
`ctx session weekly`. Take them from `--list`, not from this file, if the two ever disagree.

## 4. Verify — render it again, don't claim it

```bash
node <script> --list                                   # switches now read as intended
COLUMNS=120 node <script> < ~/.cache/statusline-last.json   # the AFTER render
echo '{}' | node <script>; echo "exit=$?"              # must still exit 0
```

Show before and after. A status line that fails renders **blank with no error anywhere**, so "it should
work" is not an acceptable report — the render is the proof.

## 5. Common requests → what to set

| They want | Do |
|---|---|
| "stop showing my email" (screen sharing) | `segments.user = false` |
| "I'm on API billing, the plan bars are always empty" | `segments.session/weekly = false` |
| "too noisy, just the essentials" | `--only=dir,branch,ctx` |
| "one line only" | `singleLine: true` — see the caveat below |
| "bars are too fat / too thin" | `maxBarWidth` (3–60) |
| "I don't want the ┃ tick" | `pace: false` |
| "stop the cap warning replacing my countdown" | `projection: false` |
| "drop the labels, I know what they mean" | `labels: false` |

## Gotchas worth telling them

- **`singleLine` drops, it does not shrink.** Groups are kept in order — identity, economics, meters — and
  any group that won't fit on the row is dropped entirely. On a narrow terminal that can mean losing the
  meters, which are usually the point. Pair it with `--only=` so the row holds what they actually want.
- **Turning everything off blanks the bar.** That is a legitimate choice, but say it out loud so it isn't
  mistaken for a crash later.
- **A broken config file is ignored, not fatal** — the script falls back to defaults rather than blanking.
  So "my setting didn't apply" usually means malformed JSON. Check with
  `python3 -m json.tool ~/.claude/statusline.json`.
- **Flags beat the file.** If a file setting appears to do nothing, look for a contradicting flag on the
  `command` string in `settings.json`.
- **Changes apply on the next render** (a new message, `/compact`, or the `refreshInterval` timer) — no
  restart needed.

## Reference

Full documentation of the status line — the payload, the layout algorithm, the pace maths — is in
[`docs/how-it-works.md`](../../docs/how-it-works.md).
