# Re-Search

**Perplexity API → Markdown** notes in your Obsidian vault folder. Default flow: set `ONCE_DEFAULT_OUT_DIR` once, then run `npm run once -- -research "..."`.

Optional: use `-obsidian` to call the [Obsidian CLI](https://obsidian.md/cli) (with automatic fallback to file output when `ONCE_DEFAULT_OUT_DIR` is set).

## Prerequisites

- **Node.js 18+**
- **Perplexity API key** — `PERPLEXITY_API_KEY` (see [Perplexity API docs](https://docs.perplexity.ai/))
- **Obsidian CLI** (optional): Settings → **General** → **Command line interface**, register CLI, `obsidian` on `PATH`

## Setup

```bash
cp .env.example .env
# Edit .env or export in shell:
export PERPLEXITY_API_KEY="your-key"
export ONCE_DEFAULT_OUT_DIR="/path/to/your/vault/Import"
# Optional for Obsidian CLI:
export OBSIDIAN_VAULT="Gimmicks"
```

## Usage

**Short command** (recommended when `ONCE_DEFAULT_OUT_DIR` is set):

```bash
cd "/path/to/Re-Search"
npm run once -- -research "Your question"
```

Other examples:

```bash
# Preview only (stdout)
npm run once -- -research "Your question" -dry-run

# Explicit file path
npm run once -- -research "Your question" -out "/path/to/note.md"

# Obsidian CLI (falls back to ONCE_DEFAULT_OUT_DIR if CLI fails)
npm run once -- -research "Your question" -folder "Import" -obsidian

# Offline test (no API)
npm run once -- -research "Fixture" -fixture fixtures/sample-completion.json -dry-run
```

### CLI flags

| Flag | Description |
|------|-------------|
| `-research` | Research question (alias for `--query`) |
| `--query` | Same as `-research` |
| `-context` / `--context` | Extra context |
| `-folder` / `--folder` | Subpath for note name (e.g. `Import`) |
| `-title` / `--title` | Note title / filename base |
| `-vault` / `--vault` | Vault name for Obsidian CLI |
| `-model` / `--model` | Perplexity model (default: `sonar`) |
| `-append` / `--append` | Append to file or pass `--append` to CLI |
| `-dry-run` / `--dry-run` | Print Markdown only |
| `-obsidian` | Prefer Obsidian CLI write |
| `-out` / `--out` | Write to this `.md` path |
| `-fixture` / `--fixture` | Skip API; use saved JSON |
| `-h` / `--help` | Help |

With `ONCE_DEFAULT_OUT_DIR` set and no `-out`: a `.md` file is written under that directory. With `-obsidian` and a failed CLI, the same directory is used as fallback.

## npm scripts

| Script | Purpose |
|--------|---------|
| `npm run once` | Run the CLI (pass flags after `--`) |

## Troubleshooting

- **`PERPLEXITY_API_KEY is not set`** — Export it or use `--fixture` for offline tests.
- **`Obsidian CLI not available`** — Use file mode (`ONCE_DEFAULT_OUT_DIR` or `-out`), or fix CLI in Obsidian settings. Check `obsidian --help`.
- **Very large notes** — Above ~200k characters, Obsidian `--content` may fail; use `-out` or `-dry-run` and save manually.

## Project layout

- [`scripts/research-to-obsidian.mjs`](scripts/research-to-obsidian.mjs) — Entrypoint
- [`fixtures/sample-completion.json`](fixtures/sample-completion.json) — Sample fixture for tests
