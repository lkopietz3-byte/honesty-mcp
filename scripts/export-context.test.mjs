import { createHash } from 'node:crypto';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { CONTEXT_FILES, createContextPacket, formatContextMarkdown } from './export-context.mjs';

const fixtures = [];
const gitState = () => ({ head: 'fixture-head', branch: 'fixture', status: '', trackedDiffSha256: 'fixture-diff' });
function fixture() {
  const root = mkdtempSync(join(tmpdir(), 'honesty-context-'));
  fixtures.push(root);
  for (const name of CONTEXT_FILES) {
    mkdirSync(dirname(join(root, name)), { recursive: true });
    writeFileSync(join(root, name), `Fixture for ${name}\n`);
  }
  return root;
}
afterEach(() => { for (const root of fixtures.splice(0)) rmSync(root, { recursive: true, force: true }); });

describe('shared context export', () => {
  it('includes only selected docs with exact content and provenance, excluding private files', () => {
    const root = fixture();
    writeFileSync(join(root, '.env'), 'PRIVATE_ENV_SENTINEL');
    mkdirSync(join(root, '.claude'), { recursive: true });
    writeFileSync(join(root, '.claude', 'MEMORY.md'), 'PRIVATE_MEMORY_SENTINEL');
    const packet = createContextPacket(root, gitState);
    expect(packet.documents.map((doc) => doc.path)).toEqual(CONTEXT_FILES);
    expect(packet.documents[0].text).toBe('Fixture for AGENTS.md\n');
    expect(packet.documents[0].sha256).toBe(createHash('sha256').update('Fixture for AGENTS.md\n').digest('hex'));
    expect(JSON.stringify(packet)).not.toMatch(/PRIVATE_ENV_SENTINEL|PRIVATE_MEMORY_SENTINEL/);
    expect(packet.git).toEqual(gitState());
  });

  it('exports a clean clone without a local handoff, while keeping shared records required', () => {
    const root = fixture();
    rmSync(join(root, 'SESSION_HANDOFF.md'));
    expect(createContextPacket(root, gitState).documents.map(doc => doc.path))
      .toEqual(CONTEXT_FILES.filter(name => name !== 'SESSION_HANDOFF.md'));
    rmSync(join(root, 'ENGINEERING.md'));
    expect(() => createContextPacket(root, gitState)).toThrow(/ENOENT/);
  });

  it('refuses a handoff created during export', () => {
    const root = fixture();
    rmSync(join(root, 'SESSION_HANDOFF.md'));
    let calls = 0;
    expect(() => createContextPacket(root, () => {
      if (++calls === 2) writeFileSync(join(root, 'SESSION_HANDOFF.md'), 'New local handoff\n');
      return gitState();
    })).toThrow(/changed during export/);
  });

  it('runs both CLI formats against real Git from another cwd without exposing unrelated paths', () => {
    const root = fixture();
    const outside = fixture();
    rmSync(join(root, 'SESSION_HANDOFF.md'));
    const required = CONTEXT_FILES.filter(name => name !== 'SESSION_HANDOFF.md');
    const git = (...args) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' });
    git('init', '--quiet');
    git('add', '--', ...required);
    git('-c', 'user.name=Lucas Kopietz', '-c', 'user.email=lkopietz3@gmail.com',
      '-c', 'commit.gpgsign=false', '-c', 'core.hooksPath=/dev/null', 'commit', '-m', 'Context fixture');
    writeFileSync(join(root, 'AGENTS.md'), 'Selected changed instructions\n');
    writeFileSync(join(root, 'PRIVATE_CONTRACT_SENTINEL.md'), 'PRIVATE_CONTENT_SENTINEL');
    mkdirSync(join(root, 'scripts'));
    const script = join(root, 'scripts', 'export-context.mjs');
    writeFileSync(script, readFileSync(new URL('./export-context.mjs', import.meta.url)));
    const json = spawnSync(process.execPath, [script, '--json'], { cwd: outside, encoding: 'utf8' });
    expect(json.status, json.stderr).toBe(0);
    const packet = JSON.parse(json.stdout);
    expect(packet.git.head).toMatch(/^[a-f0-9]{40,64}$/);
    expect(packet.git.status).toBe(' M AGENTS.md\n');
    expect(packet.documents.map(doc => doc.path)).toEqual(required);
    expect(json.stdout).not.toMatch(/PRIVATE_CONTRACT_SENTINEL|PRIVATE_CONTENT_SENTINEL|scripts\/export-context/);
    const markdown = spawnSync(process.execPath, [script], { cwd: outside, encoding: 'utf8' });
    expect(markdown.status, markdown.stderr).toBe(0);
    expect(markdown.stdout).toContain('Selected-document status at export');
    expect(markdown.stdout).not.toMatch(/PRIVATE_CONTRACT_SENTINEL|PRIVATE_CONTENT_SENTINEL/);
  });

  it('refuses a selected file symlink to private data', () => {
    const root = fixture();
    const outside = fixture();
    writeFileSync(join(outside, 'secret'), 'SYMLINK_SECRET_SENTINEL');
    rmSync(join(root, 'AGENTS.md'));
    symlinkSync(join(outside, 'secret'), join(root, 'AGENTS.md'));
    expect(() => createContextPacket(root, gitState)).toThrow(/regular file without symlinks/);
  });

  it('refuses a symlinked parent directory, even when a selected file looks regular', () => {
    const root = fixture();
    const outside = fixture();
    rmSync(join(root, 'docs'), { recursive: true });
    symlinkSync(join(outside, 'docs'), join(root, 'docs'));
    expect(() => createContextPacket(root, gitState)).toThrow(/regular file without symlinks/);
  });

  it('fails rather than silently truncating oversized context', () => {
    const root = fixture();
    writeFileSync(join(root, 'AGENTS.md'), 'x'.repeat(65537));
    expect(() => createContextPacket(root, gitState)).toThrow(/exceeds/);
  });

  it('bounds aggregate context even when each individual document fits', () => {
    const root = fixture();
    for (const name of CONTEXT_FILES) writeFileSync(join(root, name), 'x'.repeat(30000));
    expect(() => createContextPacket(root, gitState)).toThrow(/Selected context exceeds/);
  });

  it('refuses unsupported CLI options before exporting any content', () => {
    const result = spawnSync(process.execPath, [fileURLToPath(new URL('./export-context.mjs', import.meta.url)), '--include-private-memory'], { encoding: 'utf8' });
    expect(result.status).toBe(1);
    expect(result.stdout).toBe('');
    expect(result.stderr).toContain('Usage: node scripts/export-context.mjs [--json]');
  });

  it('refuses an export when a document changes during the git snapshot', () => {
    const root = fixture();
    let calls = 0;
    expect(() => createContextPacket(root, () => {
      if (++calls === 2) writeFileSync(join(root, 'AGENTS.md'), 'Changed while exporting\n');
      return gitState();
    })).toThrow(/changed during export/);
  });

  it('refuses mismatched git revisions during export', () => {
    const root = fixture();
    let calls = 0;
    expect(() => createContextPacket(root, () => ({ ...gitState(), head: `head-${++calls}` }))).toThrow(/changed during export/);
  });

  it('keeps embedded markdown fenced and distinguishes the snapshot from permissions', () => {
    const root = fixture();
    writeFileSync(join(root, 'SESSION_HANDOFF.md'), 'Before\n````\nAfter\n');
    const markdown = formatContextMarkdown(createContextPacket(root, gitState));
    expect(markdown).toContain('`````text\nBefore\n````\nAfter\n`````');
    expect(markdown).toContain('the current user request governs permissions');
    expect(markdown).toContain('fixture-head');
  });
});
