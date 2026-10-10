// Runs the built honesty-mcp server over stdio with a real MCP client and calls
// check_grounding on a short answer that cites a source the evidence does not
// contain. Prints the tool's own output unchanged. Used to produce the demo
// script in docs/launch-drafts/DEMO-SCRIPT.md.
//
//   npm run build && node scripts/demo-grounding.mjs

import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const bin = fileURLToPath(new URL('../dist/index.js', import.meta.url));
const env = { ...process.env };
delete env.HONESTY_MCP_ENABLE_CODE_EXEC; // the default: code execution off

const transport = new StdioClientTransport({
  command: process.execPath,
  args: [bin],
  env,
  cwd: mkdtempSync(join(tmpdir(), 'honesty-demo-')),
  stderr: 'pipe',
});
const client = new Client({ name: 'demo-client', version: '0.0.0' });
await client.connect(transport);

const { tools } = await client.listTools();
console.log(`Tools listed by default: ${tools.length}`);

const text = 'The bridge opened in 1932 [[cite:1]]. It cost ten million dollars [[cite:missing]].';
const evidence = { 1: 'The bridge opened to traffic in 1932.' };
console.log('\ntext:', text);
console.log('evidence:', JSON.stringify(evidence));

const result = await client.callTool({ name: 'check_grounding', arguments: { text, evidence } });
console.log('\n--- summary block ---');
console.log(result.content[0].text);
console.log('\n--- JSON block ---');
console.log(result.content[1].text);

await client.close();
