#!/usr/bin/env node
/**
 * Perplexity → Obsidian pipeline (on-demand CLI).
 * Requires: Node 18+, PERPLEXITY_API_KEY (unless --fixture). Optional: ONCE_DEFAULT_OUT_DIR for short writes.
 */

import { spawnSync } from 'node:child_process';
import { readFileSync, mkdirSync, writeFileSync, appendFileSync, existsSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';

const PERPLEXITY_URL = 'https://api.perplexity.ai/chat/completions';
const ANTHROPIC_URL = 'https://api.anthropic.com/v1/messages';
const DEFAULT_MODEL = 'sonar';
const DEFAULT_CLAUDE_MODEL = 'claude-haiku-4-5';
/** Very large bodies can exceed OS argv limits when passed as --content */
const CONTENT_ARG_SAFE_MAX = 200_000;

function printHelp() {
  console.log(`
once — Perplexity API → Obsidian vault

Typical usage:
  once -r "Your question"                 (after: cd repo && npm link)
  npm run once -- -r "Your question"
 (set ONCE_DEFAULT_OUT_DIR to your vault Import folder)

Script usage:
  node scripts/research-to-obsidian.mjs --query "Your question" [options]
  npm run once -- -r "Your question" [-obsidian]

Required:
  --query <text>           Research question (or prompt)
  -r <text>                Short alias for --query
  -research <text>         Alias for --query
  --summarize <pdfName>    Summarize a PDF from need folder
  -sum <pdfName>           Short alias for --summarize
  -summarize <pdfName>     Alias for --summarize

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
  --claude-model <id>      Claude model for -summarize (default: ${DEFAULT_CLAUDE_MODEL})
  -claude-model <id>       Alias for --claude-model
  -slide                   Summarize as slide deck mode (for -sum/-summarize)
  -study                   Summarize as academic paper mode (for -sum/-summarize)
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
  PERPLEXITY_API_KEY       Required for -research unless --fixture is used
  ANTHROPIC_API_KEY        Required for -summarize unless --fixture is used
  OBSIDIAN_VAULT           Optional default vault name
  ONCE_DEFAULT_OUT_DIR     Optional default directory for auto file output
  ONCE_NEED_DIR            Optional directory for source PDFs (default: sibling need folder)

Examples:
  npm run once -- -r "Summarize CRISPR off-target mitigation"
  npm run once -- -sum "paper.pdf" -study
  npm run once -- -sum "slides.pdf" -slide
  npm run once -- -r "..." -out "/absolute/path/Import/note.md"
  npm run once -- -r "..." -dry-run
  npm run once -- -r "..." -folder "Inbox" -title "CRISPR notes" -obsidian
  npm run once -- --help
`);
}

function parseArgs(argv) {
  const out = {
    query: null,
    summarize: null,
    context: null,
    title: null,
    folder: null,
    vault: null,
    model: DEFAULT_MODEL,
    claudeModel: DEFAULT_CLAUDE_MODEL,
    summarizeType: 'study',
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
    if (a === '--slide') {
      out.summarizeType = 'slide';
      continue;
    }
    if (a === '--study') {
      out.summarizeType = 'study';
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
    if (a === '-slide') {
      out.summarizeType = 'slide';
      continue;
    }
    if (a === '-study') {
      out.summarizeType = 'study';
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
        case 'summarize':
          out.summarize = val;
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
        case 'claude-model':
          out.claudeModel = val;
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
      if (
        key !== 'obsidian' &&
        key !== 'append' &&
        key !== 'dry-run' &&
        key !== 'slide' &&
        key !== 'study'
      ) {
        val = args[++i];
        if (val == null) throw new Error(`Missing value for -${key}`);
      }
      switch (key) {
        case 'r':
          out.query = val;
          break;
        case 'research':
          out.query = val;
          break;
        case 'sum':
          out.summarize = val;
          break;
        case 'summarize':
          out.summarize = val;
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
        case 'claude-model':
          out.claudeModel = val;
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
        case 'slide':
          out.summarizeType = 'slide';
          break;
        case 'study':
          out.summarizeType = 'study';
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
Use concise bullet points for the most important findings.

## Detailed Response
Provide a fuller explanation with context, trade-offs, and important nuances.

## Citations
List the sources used by Perplexity as markdown links: [label](url). If URL is unavailable, include plain-text source descriptors without fake links.

Do not add any heading before the first "## Key Findings". Do not wrap the answer in a code fence.`;

const PDF_SUMMARY_PROMPT_STUDY = `You are an academic-paper summarization assistant. Read the provided PDF document and produce markdown with exactly these top-level sections:

## Brief Abstract
Write a compact 3-5 sentence abstract-level summary of the paper.

## Methodology
Summarize study design, data, procedures, and analytic approach clearly.

## Key Findings
Use bullets for the principal findings and evidence.

## Evaluation
Assess strengths, limitations, validity concerns, and practical significance.

Do not wrap output in a code block.`;

const PDF_SUMMARY_PROMPT_SLIDE = `You are a slide-deck summarization assistant. Read the provided PDF document and produce markdown with exactly these top-level sections:

## Main Structure
List the major sections/themes of the slide deck in order.

## Section-by-Section Summary
For each major section, provide a concise but detailed summary of the key points and supporting details.

## Key Takeaway
Provide the single most important overall takeaway and 2-4 supporting bullets.

Do not wrap output in a code block.`;

async function callPerplexity({ apiKey, model, query, context, systemPrompt = SYSTEM_PROMPT }) {
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
        { role: 'system', content: systemPrompt },
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

async function callClaude({
  apiKey,
  model,
  query,
  context,
  systemPrompt = PDF_SUMMARY_PROMPT_STUDY,
  pdfBase64,
}) {
  const userParts = [`Task:\n${query.trim()}`];
  if (context?.trim()) {
    userParts.push(`Context:\n${context.trim()}`);
  }
  const user = userParts.join('\n\n');
  const requestContent = [{ type: 'text', text: user }];
  if (pdfBase64) {
    requestContent.unshift({
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: pdfBase64,
      },
    });
  }

  const res = await fetch(ANTHROPIC_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model,
      max_tokens: 1800,
      system: systemPrompt,
      messages: [{ role: 'user', content: requestContent }],
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
    throw new Error(`Claude API error ${res.status}: ${msg}`);
  }

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Claude returned non-JSON body');
  }

  const contentItems = data.content;
  if (!Array.isArray(contentItems) || contentItems.length === 0) {
    throw new Error('Unexpected Claude response (missing content array)');
  }
  const responseText = contentItems
    .filter((item) => item?.type === 'text' && typeof item.text === 'string')
    .map((item) => item.text)
    .join('\n')
    .trim();
  if (!responseText) {
    throw new Error('Unexpected Claude response (no text content)');
  }
  return responseText;
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

function resolveNeedDir() {
  const explicit = process.env.ONCE_NEED_DIR?.trim();
  if (explicit) return resolve(explicit);
  const outDir = process.env.ONCE_DEFAULT_OUT_DIR?.trim();
  if (outDir) return resolve(dirname(resolve(outDir)), 'Need');
  return resolve(process.cwd(), 'Need');
}

async function loadPdfBase64(pdfPath) {
  let data;
  try {
    data = readFileSync(pdfPath);
  } catch (e) {
    throw new Error(`Cannot read PDF: ${pdfPath} (${e.message})`);
  }
  if (!data || data.length === 0) throw new Error(`PDF is empty: ${pdfPath}`);
  return data.toString('base64');
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

  const hasResearch = Boolean(opts.query?.trim());
  const hasSummarize = Boolean(opts.summarize?.trim());
  if (!hasResearch && !hasSummarize) {
    console.error('Error: provide -r/-research/--query or -sum/-summarize.');
    printHelp();
    process.exitCode = 1;
    return;
  }
  if (hasResearch && hasSummarize) {
    console.error('Error: use either -research or -summarize, not both.');
    process.exitCode = 1;
    return;
  }

  const perplexityApiKey = process.env.PERPLEXITY_API_KEY;
  const anthropicApiKey = process.env.ANTHROPIC_API_KEY;
  let body;
  let effectiveQuery = opts.query;
  let effectiveContext = opts.context;
  let summarizeMode = false;
  let summarizePdfBase64 = null;
  if (hasSummarize) {
    summarizeMode = true;
    const summarizeInput = opts.summarize.trim();
    const resolvedPdfPath = summarizeInput.startsWith('/')
      ? resolve(summarizeInput)
      : resolve(resolveNeedDir(), summarizeInput);
    if (extname(resolvedPdfPath).toLowerCase() !== '.pdf') {
      console.error('Error: -summarize expects a .pdf filename or path.');
      process.exitCode = 1;
      return;
    }
    if (!existsSync(resolvedPdfPath)) {
      console.error(`Error: PDF not found: ${resolvedPdfPath}`);
      process.exitCode = 1;
      return;
    }
    const pdfBasename = basename(resolvedPdfPath);
    try {
      summarizePdfBase64 = await loadPdfBase64(resolvedPdfPath);
      effectiveQuery = `Summarize PDF: ${pdfBasename}`;
      effectiveContext = `PDF file: ${pdfBasename}`;
    } catch (e) {
      console.error(e.message || String(e));
      process.exitCode = 1;
      return;
    }
  }
  if (opts.fixture) {
    body = loadFixtureContent(opts.fixture);
  } else {
    try {
      if (summarizeMode) {
        if (!anthropicApiKey?.trim()) {
          console.error(
            'Error: ANTHROPIC_API_KEY is not set. Export it or use --fixture for offline tests.'
          );
          process.exitCode = 1;
          return;
        }
        body = await callClaude({
          apiKey: anthropicApiKey.trim(),
          model: opts.claudeModel,
          query: effectiveQuery,
          context: effectiveContext,
          systemPrompt:
            opts.summarizeType === 'slide'
              ? PDF_SUMMARY_PROMPT_SLIDE
              : PDF_SUMMARY_PROMPT_STUDY,
          pdfBase64: summarizePdfBase64,
        });
      } else {
        if (!perplexityApiKey?.trim()) {
          console.error(
            'Error: PERPLEXITY_API_KEY is not set. Export it or use --fixture for offline tests.'
          );
          process.exitCode = 1;
          return;
        }
        body = await callPerplexity({
          apiKey: perplexityApiKey.trim(),
          model: opts.model,
          query: effectiveQuery,
          context: effectiveContext,
          systemPrompt: SYSTEM_PROMPT,
        });
      }
    } catch (e) {
      console.error(e.message || String(e));
      process.exitCode = 1;
      return;
    }
  }

  const now = new Date();
  const title =
    opts.title?.trim() ||
    `${isoDateStamp(now)}-${slugify(effectiveQuery, 40)}`;
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
    query: effectiveQuery,
    context: effectiveContext,
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
