// Packs this package, installs the tarball into an empty temporary project
// (the way `npx honesty-mcp` would get it), and runs scripts/stdio-probe.mjs
// against the INSTALLED bin, launched from an unrelated empty folder.
//
//   node scripts/verify-installed.mjs     (run `npm run build` first)
//
// Needs network access: installing the tarball fetches the wrapped kits
// from the npm registry, exactly as a real consumer install does.

import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const work = mkdtempSync(join(tmpdir(), 'honesty-mcp-installed-'));
const consumer = join(work, 'consumer');
mkdirSync(consumer);

function run(command, args, cwd) {
  execFileSync(command, args, { cwd, stdio: ['ignore', 'ignore', 'inherit'] });
}

run('npm', ['pack', '--ignore-scripts', '--pack-destination', work], root);
const tarball = readdirSync(work).find((name) => name.endsWith('.tgz'));
if (!tarball) throw new Error('npm pack produced no tarball');

writeFileSync(join(consumer, 'package.json'), JSON.stringify({ private: true }));
run('npm', ['install', '--no-audit', '--no-fund', join(work, tarball)], consumer);

const installedBin = join(consumer, 'node_modules', 'honesty-mcp', 'dist', 'index.js');
execFileSync(process.execPath, [join(root, 'scripts', 'stdio-probe.mjs'), installedBin], { stdio: 'inherit' });
console.log(JSON.stringify({ status: 'passed', tarball, installedBin }));
