#!/usr/bin/env node
/**
 * Perplexity → Obsidian pipeline (on-demand CLI).
 * Requires: Node 18+, PERPLEXITY_API_KEY (unless --fixture). Optional: ONCE_DEFAULT_OUT_DIR for short writes.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const PERPLEXITY_URL = 'https://api.perplexity.ai/chat/completions';
const DEFAULT_MODEL = 'sonar';
/** Very large bodies can exceed OS argv limits when passed as --content */
const CONTENT_ARG_SAFE_MAX = 200_000;

function printHelp() {
  console.log(`
once — Perplexity API → Obsidian vault

Typical usage:
  npm run once -- -research "Your question"
 (set ONCE_DEFAULT_OUT_DIR to your vault Import folder)

Script usage:
  node scripts/research-to-obsidian.mjs --query "Your question" [options]
  npm run once -- -research "Your question" [-obsidian]

Required:
  --query <text>           Research question (or prompt)
  -research <text>         Alias for --query

Options:
  --context <text>         Extra user context
  -context <text>          Alias for --context
  --title <text>           Note title / base filename (default: dated slug from query)
  -title <text>            Alias for --title
  --folder <path>          Subfolder inside vault, e.g. "Research/Inbox"
  -folder <path>           Alias for --folder
  --vault <name>           Obsidian vault name (or set OBSIDIAN_VAULT)
  -vault <name>            Alias for --vault
  --model <id>             Perplexity model (default: ${DEFAULT_MODEL})
  -model <id>              Alias for --model
  --append                 Append to existing note instead of creating/overwriting
  -append                  Alias for --append
  --dry-run                Print Markdown only; do not call Obsidian CLI
  -dry-run                 Alias for --dry-run
  -obsidian                Explicitly enable Obsidian write mode (no-op if already enabled)
  --out <path>             Write markdown directly to a .md file (bypasses Obsidian CLI)
  -out <path>              Alias for --out
  --fixture <jsonPath>     Use a saved API JSON response instead of calling Perplexity (for tests)
  -fixture <jsonPath>      Alias for --fixture
  -h, --help               Show this help

Environment:
  PERPLEXITY_API_KEY       Required unless --fixture is used
  OBSIDIAN_VAULT           Optional default vault name
  ONCE_DEFAULT_OUT_DIR     Optional default directory for auto file output

Examples:
  npm run once -- -research "Summarize CRISPR off-target mitigation"
  npm run once -- -research "..." -out "/absolute/path/Import/note.md"
  npm run once -- -research "..." -dry-run
  npm run once -- -research "..." -folder "Inbox" -title "CRISPR notes" -obsidian
  npm run once -- --help
`);
}

function parseArgs(argv) {
  const out = {
    query: null,
    context: null,
    title: null,
    folder: null,
    vault: null,
    model: DEFAULT_MODEL,
    append: false,
    dryRun: false,
    obsidian: false,
    outPath: null,
    fixture: null,
    help: false,
  };
  const args = argv.slice(2);
  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === '-h' || a === '--help') {
      out.help = true;
      continue;
    }
    if (a === '--append') {
      out.append = true;
      continue;
    }
    if (a === '-append') {
      out.append = true;
      continue;
    }
    if (a === '--dry-run') {
      out.dryRun = true;
      continue;
    }
    if (a === '-dry-run') {
      out.dryRun = true;
      continue;
    }
    if (a === '-obsidian') {
      out.obsidian = true;
      continue;
    }
    if (a.startsWith('--')) {
      const eq = a.indexOf('=');
      const key = eq >= 0 ? a.slice(2, eq) : a.slice(2);
      let val;
      if (eq >= 0) {
        val = a.slice(eq + 1);
      } else {
        val = args[++i];
        if (val == null) throw new Error(`Missing value for --${key}`);
      }
      switch (key) {
        case 'query':
          out.query = val;
          break;
        case 'context':
          out.context = val;
          break;
        case 'title':
          out.title = val;
          break;
        case 'folder':
          out.folder = val;
          break;
        case 'vault':
          out.vault = val;
          break;
        case 'model':
          out.model = val;
          break;
        case 'out':
          out.outPath = val;
          break;
        case 'fixture':
          out.fixture = val;
          break;
        default:
          throw new Error(`Unknown flag: --${key}`);
      }
      continue;
    }
    if (a.startsWith('-')) {
      const key = a.slice(1);
      let val;
      if (key !== 'obsidian' && key !== 'append' && key !== 'dry-run') {
        val = args[++i];
        if (val == null) throw new Error(`Missing value for -${key}`);
      }
      switch (key) {
        case 'research':
          out.query = val;
          break;
        case 'context':
          out.context = val;
          break;
        case 'title':
          out.title = val;
          break;
        case 'folder':
          out.folder = val;
          break;
        case 'vault':
          out.vault = val;
          break;
        case 'model':
          out.model = val;
          break;
        case 'out':
          out.outPath = val;
          break;
        case 'fixture':
          out.fixture = val;
          break;
        case 'append':
          out.append = true;
          break;
        case 'dry-run':
          out.dryRun = true;
          break;
        case 'obsidian':
          out.obsidian = true;
          break;
        default:
          throw new Error(`Unknown flag: -${key}`);
      }
      continue;
    }
    throw new Error(`Unexpected argument: ${a}`);
  }
  return out;
}

function slugify(text, maxLen = 48) {
  const s = text
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return (s || 'research').slice(0, maxLen);
}

function sanitizePathSegment(segment) {
  return segment
    .replace(/[/\\:*?"<>|]/g, '-')
    .replace(/\s+/g, ' ')
    .trim();
}

function escapeYamlScalar(s) {
  return String(s)
    .replace(/\\/g, '\\\\')
    .replace(/"/g, '\\"')
    .replace(/\n/g, ' ');
}

function isoDateStamp(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function isoDateTime(d = new Date()) {
  return d.toISOString();
}

function buildNoteMarkdown({ title, query, context, body, createdAt }) {
  const lines = [
    '---',
    `title: "${escapeYamlScalar(title)}"`,
    `created_at: "${createdAt}"`,
    'tags:',
    '  - research',
    '  - perplexity',
    '---',
    '',
    '## Question',
    '',
    query.trim(),
    '',
  ];
  if (context?.trim()) {
    lines.push('## Additional Context', '', context.trim(), '', '---', '');
  }
  lines.push(body.trim(), '');
  return lines.join('\n');
}

const SYSTEM_PROMPT = `You are a research assistant. Answer using clear markdown with exactly these top-level sections (in this order), each heading on its own line starting with ##:

## Key Findings
Use bullets or a short numbered list. Cite sources inline with markdown links where URLs exist.

## Sources
List each source as a markdown link: [label](url). If you cannot provide a URL, describe the source in plain text without a fake link.

## Suggested Next Questions
A numbered list of 3–7 focused follow-up questions.

Do not add any heading before the first "## Key Findings". Do not wrap the answer in a code fence.`;

async function callPerplexity({ apiKey, model, query, context }) {
  const userParts = [`Research question:\n${query.trim()}`];
  if (context?.trim()) {
    userParts.push(`Additional context from the user:\n${context.trim()}`);
  }
  const user = userParts.join('\n\n');

  const res = await fetch(PERPLEXITY_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: user },
      ],
      temperature: 0.3,
    }),
  });

  const text = await res.text();
  if (!res.ok) {
    let msg = text;
    try {
      const j = JSON.parse(text);
      msg = j.error?.message ?? j.message ?? text;
    } catch {
      /* keep raw text */
    }
    throw new Error(`Perplexity API error ${res.status}: ${msg}`);
  }
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Perplexity returned non-JSON body');
  }
  const content = data.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new Error('Unexpected Perplexity response (missing choices[0].message.content)');
  }
  return content;
}

function loadFixtureContent(fixturePath) {
  let raw;
  try {
    raw = readFileSync(fixturePath, 'utf8');
  } catch (e) {
    throw new Error(`Cannot read --fixture file: ${fixturePath} (${e.message})`);
  }
  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new Error(`--fixture file must be JSON (saved chat/completions response)`);
  }
  const content = data.choices?.[0]?.message?.content;
  if (!content || typeof content !== 'string') {
    throw new Error('Fixture JSON must include choices[0].message.content string');
  }
  return content;
}

function obsidianCommandExists() {
  const r = spawnSync('obsidian', ['--help'], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    timeout: 8000,
  });
  if (r.error?.code === 'ENOENT') return false;
  return r.status === 0 || (r.stdout?.length ?? 0) > 0 || (r.stderr?.length ?? 0) > 0;
}

function runObsidianCreate({ vault, notePath, markdown, append }) {
  if (markdown.length > CONTENT_ARG_SAFE_MAX) {
    throw new Error(
      `Note body is very large (${markdown.length} chars). Run with --dry-run, save the output to a .md file in your vault, or shorten the prompt. (Safe limit for --content is ~${CONTENT_ARG_SAFE_MAX} characters.)`
    );
  }

  const args = ['create'];
  if (vault) args.push('--vault', vault);
  args.push(notePath);
  if (append) args.push('--append');
  args.push('--content', markdown);

  /** @type {import('node:child_process').SpawnSyncOptionsWithStringEncoding} */
  const opts = {
    encoding: 'utf8',
    maxBuffer: 50 * 1024 * 1024,
    stdio: ['pipe', 'pipe', 'pipe'],
  };

  const r = spawnSync('obsidian', args, opts);
  if (r.error?.code === 'ENOENT') {
    throw new Error(
      'Obsidian CLI not found on PATH. Install Obsidian 1.12+, enable CLI in Settings → General, register it, restart terminal.'
    );
  }
  if (r.status !== 0) {
    const err = (r.stderr || r.stdout || '').trim() || `exit ${r.status}`;
    throw new Error(`Obsidian CLI failed: ${err}`);
  }
}

function writeMarkdownFile({ outPath, markdown, append }) {
  const absPath = resolve(outPath);
  mkdirSync(dirname(absPath), { recursive: true });
  if (append) {
    appendFileSync(absPath, `${markdown}\n`, 'utf8');
  } else {
    writeFileSync(absPath, markdown, 'utf8');
  }
  return absPath;
}

function resolveAutoOutPath({ opts, notePath }) {
  const dir = process.env.ONCE_DEFAULT_OUT_DIR?.trim();
  if (!dir) return null;
  const safeName = notePath.split('/').pop() || 'note';
  return resolve(dir, `${safeName}.md`);
}

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv);
  } catch (e) {
    console.error(e.message);
    process.exitCode = 1;
    return;
  }

  if (opts.help) {
    printHelp();
    return;
  }

  if (!opts.query?.trim()) {
    console.error('Error: -research or --query is required.');
    printHelp();
    process.exitCode = 1;
    return;
  }

  const apiKey = process.env.PERPLEXITY_API_KEY;
  let body;
  if (opts.fixture) {
    body = loadFixtureContent(opts.fixture);
  } else {
    if (!apiKey?.trim()) {
      console.error(
        'Error: PERPLEXITY_API_KEY is not set. Export it or use a .env loader; or use --fixture for offline tests.'
      );
      process.exitCode = 1;
      return;
    }
    try {
      body = await callPerplexity({
        apiKey: apiKey.trim(),
        model: opts.model,
        query: opts.query,
        context: opts.context,
      });
    } catch (e) {
      console.error(e.message || String(e));
      process.exitCode = 1;
      return;
    }
  }

  const now = new Date();
  const title =
    opts.title?.trim() ||
    `${isoDateStamp(now)}-${slugify(opts.query, 40)}`;
  const noteTitle = sanitizePathSegment(title);
  const folder = opts.folder?.trim()
    ? opts.folder
        .split(/[/\\]+/)
        .map((s) => sanitizePathSegment(s))
        .filter(Boolean)
        .join('/')
    : '';
  const notePath = folder ? `${folder}/${noteTitle}` : noteTitle;

  const markdown = buildNoteMarkdown({
    title,
    query: opts.query,
    context: opts.context,
    body,
    createdAt: isoDateTime(now),
  });

  if (opts.dryRun) {
    process.stdout.write(markdown);
    return;
  }

  const explicitOutPath = opts.outPath?.trim() || null;
  const autoOutPath = resolveAutoOutPath({ opts, notePath });
  if (explicitOutPath || (!opts.obsidian && autoOutPath)) {
    try {
      const written = writeMarkdownFile({
        outPath: explicitOutPath || autoOutPath,
        markdown,
        append: opts.append,
      });
      console.error(`Wrote markdown file: ${written}`);
    } catch (e) {
      console.error(`Failed to write output file: ${e.message || String(e)}`);
      process.exitCode = 1;
    }
    return;
  }

  if (!obsidianCommandExists()) {
    if (autoOutPath) {
      try {
        const written = writeMarkdownFile({
          outPath: autoOutPath,
          markdown,
          append: opts.append,
        });
        console.error(`Obsidian CLI unavailable. Fallback file written: ${written}`);
        return;
      } catch (e) {
        console.error(`Failed to write fallback file: ${e.message || String(e)}`);
        process.exitCode = 1;
        return;
      }
    }
    console.error(
      'Error: Obsidian CLI not available. Install Obsidian 1.12.4+, enable Settings → General → Command line interface, register the CLI, ensure `obsidian` is on PATH, then retry. Or set ONCE_DEFAULT_OUT_DIR to auto-write markdown files.'
    );
    process.exitCode = 1;
    return;
  }

  const vault = opts.vault?.trim() || process.env.OBSIDIAN_VAULT?.trim() || null;

  try {
    runObsidianCreate({
      vault,
      notePath,
      markdown,
      append: opts.append,
    });
  } catch (e) {
    if (autoOutPath) {
      try {
        const written = writeMarkdownFile({
          outPath: autoOutPath,
          markdown,
          append: opts.append,
        });
        console.error(`Obsidian CLI failed. Fallback file written: ${written}`);
        return;
      } catch (fallbackErr) {
        console.error(`Obsidian failed: ${e.message || String(e)}`);
        console.error(`Fallback failed: ${fallbackErr.message || String(fallbackErr)}`);
        process.exitCode = 1;
        return;
      }
    }
    console.error(e.message || String(e));
    process.exitCode = 1;
    return;
  }

  console.error(`Wrote note via Obsidian CLI: ${notePath}`);
}

main();
