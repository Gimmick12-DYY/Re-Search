# Re-Search

On-demand **Perplexity API → Markdown → Obsidian** pipeline. Run a research query, get structured notes, and create or append a note in your vault using the [Obsidian CLI](https://obsidian.md/cli).

## Prerequisites

- **Node.js 18+**
- **Perplexity API key** — set `PERPLEXITY_API_KEY` (see [Perplexity API docs](https://docs.perplexity.ai/))
- **Obsidian 1.12.4+** with CLI enabled:
  - Settings → **General** → **Command line interface** → enable and register
  - Ensure `obsidian` is on your `PATH` (restart terminal after setup)

## Setup

```bash
cp .env.example .env
# Edit .env and set PERPLEXITY_API_KEY=...
```

Load env vars in your shell (or use a tool like `direnv`):

```bash
export PERPLEXITY_API_KEY="your-key"
# Optional if you use multiple vaults:
export OBSIDIAN_VAULT="YourVaultName"
```

## Usage

```bash
# Preview Markdown only (still calls Perplexity unless you use --fixture)
npm run research -- --query "Your research question" --dry-run

# Create a note in the vault root (calls Obsidian CLI)
npm run research -- --query "Your research question"

# Put the note in a folder inside the vault
npm run research -- --query "..." --folder "Research/Inbox"

# Custom title / filename base (sanitized)
npm run research -- --query "..." --title "My Topic Note"

# Append to an existing note with the same path
npm run research -- --query "..." --folder "Research" --title "Running log" --append

# Use a different Perplexity model
npm run research -- --query "..." --model sonar-pro

# Offline / CI: skip Perplexity using a saved JSON body (same shape as API response)
npm run research -- --query "Fixture test" --fixture fixtures/sample-completion.json --dry-run
```

### CLI flags

| Flag | Description |
|------|-------------|
| `--query` | **Required.** Research question or prompt |
| `--context` | Extra context appended to the user message |
| `--folder` | Vault subpath, e.g. `Research/Inbox` |
| `--title` | Note title / basename (default: `YYYY-MM-DD-slug`) |
| `--vault` | Vault name, or use `OBSIDIAN_VAULT` |
| `--model` | Perplexity model (default: `sonar`) |
| `--append` | Pass `--append` to Obsidian CLI |
| `--dry-run` | Print Markdown to stdout; do not call Obsidian |
| `--fixture` | JSON file with `choices[0].message.content` (skips API) |
| `-h`, `--help` | Help |

## Note format

Generated Markdown includes optional frontmatter (`title`, `created_at`, `tags`) and:

- `## Question`
- `## Additional Context` (only if `--context` is set)
- Model output with `## Key Findings`, `## Sources`, `## Suggested Next Questions`

## npm scripts

| Script | Purpose |
|--------|---------|
| `npm run research` | Runs `node scripts/research-to-obsidian.mjs` (pass flags after `--`) |
| `npm run research:demo` | Offline demo: `--fixture` + `--dry-run` (no API key) |

## Troubleshooting

- **`PERPLEXITY_API_KEY is not set`** — Export the variable or use `--fixture` for offline tests.
- **`Obsidian CLI not available` / `command not found: obsidian`** — Enable and register the CLI in Obsidian, add it to `PATH`, restart the terminal.
- **`Obsidian CLI failed`** — Check vault name (`--vault` / `OBSIDIAN_VAULT`), folder path, and that the app is allowed to run CLI commands. Try `obsidian create --help` locally.
- **Very large notes** — If the combined Markdown exceeds ~200k characters, the script exits with a hint to use `--dry-run` and save manually (OS argv limits for `--content`).

## Project layout

- [`scripts/research-to-obsidian.mjs`](scripts/research-to-obsidian.mjs) — Pipeline entrypoint
- [`fixtures/sample-completion.json`](fixtures/sample-completion.json) — Sample API-shaped JSON for tests