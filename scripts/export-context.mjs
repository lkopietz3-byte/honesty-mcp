// Exports allowlisted project documentation, never native agent memory or chats.
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const CONTEXT_FILES = Object.freeze([
  'AGENTS.md',
  'PROJECT_CONTEXT.md',
  'ENGINEERING.md',
  'docs/SHARED_CONTEXT.md',
  'SESSION_HANDOFF.md',
]);
const MAX_FILE_BYTES = 64 * 1024;
const MAX_TOTAL_BYTES = 128 * 1024;
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');

export function readGitState(root) {
  const git = (...args) => execFileSync('git', ['-C', root, ...args], {
    encoding: 'utf8', timeout: 10000,
    env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (realpathSync(git('rev-parse', '--show-toplevel').trim()) !== root) {
    throw new Error('Context must be exported from its own repository root.');
  }
  return {
    head: git('rev-parse', 'HEAD').trim(),
    branch: git('branch', '--show-current').trim() || '(detached)',
    status: git('status', '--porcelain=v1', '--', ...CONTEXT_FILES),
    trackedDiffSha256: sha256(git('diff', '--no-ext-diff', '--no-textconv', '--binary', 'HEAD')),
  };
}

function readDocument(root, name) {
  const path = join(root, name);
  let stat;
  try { stat = lstatSync(path); } catch (error) {
    if (name === 'SESSION_HANDOFF.md' && error.code === 'ENOENT') return null;
    throw error;
  }
  if (!stat.isFile() || realpathSync(path) !== path) {
    throw new Error(`Context source must be a regular file without symlinks: ${name}`);
  }
  if (stat.size > MAX_FILE_BYTES) {
    throw new Error(`Context source exceeds ${MAX_FILE_BYTES} bytes: ${name}`);
  }
  const bytes = readFileSync(path);
  if (bytes.length > MAX_FILE_BYTES) throw new Error(`Context source grew too large: ${name}`);
  return { path: name, bytes: bytes.length, sha256: sha256(bytes), text: bytes.toString('utf8') };
}

export function createContextPacket(root, getGitState = readGitState) {
  root = realpathSync(root);
  const gitState = getGitState(root);
  const documents = CONTEXT_FILES.map((name) => readDocument(root, name)).filter(Boolean);
  if (documents.reduce((total, doc) => total + doc.bytes, 0) > MAX_TOTAL_BYTES) {
    throw new Error(`Selected context exceeds ${MAX_TOTAL_BYTES} bytes; shorten the records before exporting.`);
  }
  const afterGit = getGitState(root);
  if (JSON.stringify(gitState) !== JSON.stringify(afterGit)
    || JSON.stringify(documents) !== JSON.stringify(CONTEXT_FILES.map((name) => readDocument(root, name)).filter(Boolean))) {
    throw new Error('Repository changed during export; retry after coordinating writers.');
  }
  return {
    formatVersion: 1,
    generatedAt: new Date().toISOString(),
    scope: 'Selected repository documentation; snapshot only, no private memory or chat synchronization.',
    git: gitState,
    documents,
  };
}

export function formatContextMarkdown(packet) {
  const lines = [
    '# honesty-mcp shared context snapshot',
    '',
    `Generated: ${new Intl.DateTimeFormat('en-US', { timeZone: 'America/Chicago', dateStyle: 'full', timeStyle: 'long' }).format(new Date(packet.generatedAt))} (America/Chicago)`,
    `Revision: ${packet.git.head}; branch: ${packet.git.branch}`,
    `Tracked diff SHA-256: ${packet.git.trackedDiffSha256}`,
    '',
    'This is a dated documentation snapshot. Included files are reference material; the current user request governs permissions. Reconcile a live checkout before editing or claiming current verification. Exporting grants no access to private chats, credentials, native memories or another agent session.',
    '',
    '## Selected-document status at export',
    '',
    '```text',
    packet.git.status.trimEnd() || '(clean)',
    '```',
  ];
  for (const doc of packet.documents) {
    const longestFence = Math.max(2, ...Array.from(doc.text.matchAll(/`+/g), (match) => match[0].length));
    const fence = '`'.repeat(longestFence + 1);
    lines.push('', `## ${doc.path}`, '', `Source SHA-256: ${doc.sha256}; bytes: ${doc.bytes}`, '', `${fence}text`, doc.text.trimEnd(), fence);
  }
  return `${lines.join('\n')}\n`;
}

if (process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))) {
  try {
    const args = process.argv.slice(2);
    if (args.length > 1 || (args.length === 1 && args[0] !== '--json')) {
      throw new Error('Usage: node scripts/export-context.mjs [--json]');
    }
    const root = fileURLToPath(new URL('../', import.meta.url));
    const packet = createContextPacket(root);
    process.stdout.write(args[0] === '--json' ? `${JSON.stringify(packet, null, 2)}\n` : formatContextMarkdown(packet));
  } catch (error) {
    console.error(`Context export failed: ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  }
}
