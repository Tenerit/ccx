# ccx — Claude Code X-Ray

**See what your Claude Code sessions actually cost — and what wasted money.**

`ccx` reads the session logs Claude Code already writes to
`~/.claude/projects/**/*.jsonl` and turns them into two things nobody else
shows you:

1. **Cost** — cache-aware dollars, per project, per day, and your most expensive
   sessions. (The built-in `/cost` is one live session; `ccx` is your whole
   history.)
2. **Waste** — the stuff that quietly burned tokens: files read over and over,
   giant tool outputs that bloated the context, unstable prompt prefixes that
   churned the cache, and how much you spent on thinking.

Zero network. Zero runtime dependencies. Your logs never leave your machine.

```
$ ccx cost
ccx cost  ·  142 sessions

  $38.91 total
  in 1.2M · out 410.3k · cache-read 58.4M · cache-write 9.1M · hit-rate 86%

By project
project   sessions    cost
cronguard      88   $26.04
ccx            12    $7.71
dotfiles       42    $5.16
...
```

```
$ ccx waste
Duplicate file reads  (same file Read 2+ times in one session)
×  file                       project    session
4  …/src/api/monitors.ts      cronguard  750fbc51
3  …/dashboard.html           cronguard  9544547b
...

Fattest tool outputs  (biggest tool_results = context bloat)
~tokens  tool         project    session
31.2k    tool_result  cronguard  ae99805a
...
```

## Install

```bash
npm install -g @tenerit/ccx
# or run without installing:
npx @tenerit/ccx cost
```

(Installs the `ccx` command. The package is scoped because the bare `ccx` name was
already taken on npm.)

## Usage

```
ccx cost            What you spent: per project, per day, top sessions
ccx waste           Token waste: dup reads, fat tool dumps, cache churn, thinking
ccx help            Full help

Options
  --days <n>          Only sessions active in the last <n> days
  --project <name>    Filter to projects whose name contains <name>  (-p)
  --json              Machine-readable output (pipe into jq / a statusline)
  --pricing <file>    Use a custom pricing.json instead of the bundled table
```

### Examples

```bash
ccx cost --days 7                 # this week's spend
ccx cost -p myrepo                # one project
ccx waste --json | jq '.dupReads' # script against the data
```

## How cost is computed

Each assistant message in the logs carries a `usage` block (input, output,
cache-read, and 5-minute / 1-hour cache-write token counts) and the model id.
`ccx` prices each one with a per-model rate table and sums it. Cache reads are
~10× cheaper than fresh input and cache writes are ~1.25× (5m) / 2× (1h) the
input price, so the cache-aware total is much closer to your real bill than a
flat token count.

Prices live in [`pricing.json`](pricing.json) and are easy to edit — pass
`--pricing <file>` to override. Update them when rates change.

## What counts as "waste"

| Signal | Why it costs you |
| --- | --- |
| **Duplicate reads** | Re-reading the same file in one session pays for those input tokens again. Often a sign the file should have stayed in context or been read once. |
| **Fat tool outputs** | A single huge `tool_result` (a 2000-line file, an unfiltered log dump) inflates every subsequent request in the session. |
| **Cache churn** | A high cache-*write* to cache-*read* ratio means the stable prefix keeps changing, so the cache is paid for but rarely reused. |
| **Thinking spend** | Estimated reasoning tokens per session — useful for spotting where effort/thinking ran hot. |

## Privacy

`ccx` only ever reads local files under `~/.claude/projects`. It makes no
network calls. Point it elsewhere with `CCX_PROJECTS_DIR=/path ccx cost`.

## License

MIT
