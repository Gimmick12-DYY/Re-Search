# Re-Search

**Perplexity + Claude → Markdown** notes in your Obsidian vault folder.

Optional: use `-obsidian` to call the [Obsidian CLI](https://obsidian.md/cli) (with automatic fallback to file output when `ONCE_DEFAULT_OUT_DIR` is set).

## Prerequisites

- **Node.js 18+**
- **Perplexity API key** — `PERPLEXITY_API_KEY` for `-research` (see [Perplexity API docs](https://docs.perplexity.ai/))
- **Anthropic API key** — `ANTHROPIC_API_KEY` for `-summarize`
- **Obsidian CLI** (optional): Settings → **General** → **Command line interface**, register CLI, `obsidian` on `PATH`

## Setup

```bash
cp .env.example .env
# Edit .env or export in shell:
export PERPLEXITY_API_KEY="your-key"
export ANTHROPIC_API_KEY="your-anthropic-key"
export ONCE_DEFAULT_OUT_DIR="/path/to/your/vault/Import"
export ONCE_NEED_DIR="/path/to/your/vault/need"
# Optional for Obsidian CLI:
export OBSIDIAN_VAULT="Gimmicks"
```

### Run `once` from any directory (recommended)

One-time link from the repo root:

```bash
cd "/path/to/Re-Search"
npm link
```

After that, from **any** folder:

```bash
once -research "Your question"
once -r "Your question"
once --help
```

No `npm run` or `--` needed.

## Usage

**From the repo** (when you have not linked globally):

```bash
cd "/path/to/Re-Search"
npm run once -- -research "Your question"
```

**From anywhere** (after `npm link`):

```bash
once -research "Your question"
once -r "Your question"
once -sum "paper.pdf" -study
```

Other examples:

```bash
# Preview only (stdout)
once -r "Your question" -dry-run

# Explicit file path
once -r "Your question" -out "/path/to/note.md"

# Summarize academic paper PDF from need folder
once -sum "paper.pdf" -study

# Summarize slide deck PDF from need folder
once -sum "slides.pdf" -slide

# Obsidian CLI (falls back to ONCE_DEFAULT_OUT_DIR if CLI fails)
once -r "Your question" -folder "Import" -obsidian

# Offline test (no API; run from repo or use absolute -fixture path)
once -r "Fixture" -fixture /path/to/Re-Search/fixtures/sample-completion.json -dry-run
```

### CLI flags

| Flag | Description |
|------|-------------|
| `-r` / `-research` | Research question (alias for `--query`) |
| `-sum` / `-summarize` | Summarize a PDF file from need folder |
| `-slide` | Summarize as slide-deck mode (`-sum`) |
| `-study` | Summarize as academic-paper mode (`-sum`, default) |
| `--query` | Same as `-research` |
| `-context` / `--context` | Extra context |
| `-folder` / `--folder` | Subpath for note name (e.g. `Import`) |
| `-title` / `--title` | Note title / filename base |
| `-vault` / `--vault` | Vault name for Obsidian CLI |
| `-model` / `--model` | Perplexity model (default: `sonar`) |
| `-claude-model` / `--claude-model` | Claude model for `-summarize` (default: `claude-haiku-4-5`) |
| `-append` / `--append` | Append to file or pass `--append` to CLI |
| `-dry-run` / `--dry-run` | Print Markdown only |
| `-obsidian` | Prefer Obsidian CLI write |
| `-out` / `--out` | Write to this `.md` path |
| `-fixture` / `--fixture` | Skip API; use saved JSON |
| `-h` / `--help` | Help |

With `ONCE_DEFAULT_OUT_DIR` set and no `-out`: a `.md` file is written under that directory. With `-obsidian` and a failed CLI, the same directory is used as fallback.
For `-sum`/`-summarize`, source PDFs are loaded from `ONCE_NEED_DIR`; if unset, `once` infers `../Need` beside your output folder.

## npm scripts

| Script | Purpose |
|--------|---------|
| `npm run once` | Same as global `once` (pass flags after `--`) |
| `npm link` (once) | Installs global `once` on your PATH |

## Troubleshooting

- **`PERPLEXITY_API_KEY is not set`** — Needed for `-r`/`-research` (or use `--fixture`).
- **`ANTHROPIC_API_KEY is not set`** — Needed for `-sum`/`-summarize` (or use `--fixture`).
- **`Obsidian CLI not available`** — Use file mode (`ONCE_DEFAULT_OUT_DIR` or `-out`), or fix CLI in Obsidian settings. Check `obsidian --help`.
- **Very large notes** — Above ~200k characters, Obsidian `--content` may fail; use `-out` or `-dry-run` and save manually.

## Project layout

- [`scripts/research-to-obsidian.mjs`](scripts/research-to-obsidian.mjs) — Entrypoint
- [`fixtures/sample-completion.json`](fixtures/sample-completion.json) — Sample fixture for tests
