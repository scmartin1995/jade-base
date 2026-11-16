// Claude Code's permission prompt tool, served to it as a tiny MCP server over stdio (no dependencies).
// Claude Code calls `approve` before running any tool it has not been pre-approved for; this forwards the call to Jade
// (POST /api/permissions/ask on the local server), which decides by policy and, only when needed, asks the user in the
// Jade window. The answer goes back as Claude Code expects: {"behavior":"allow"} or {"behavior":"deny","message":…}.
import { createInterface } from 'node:readline';
import fs from 'node:fs';
import path from 'node:path';

const PORT = process.env.JADE_PORT || 4778;
const JOB = process.env.JADE_JOB || '', THREAD = process.env.JADE_THREAD || '';
// The key is not in this program's settings: it is read from the state folder's key file when needed (JADE_TOKEN only as a fallback for a test).
const key = () => { try { return fs.readFileSync(path.join(process.env.JADE_STATE || '', 'token'), 'utf8').trim(); } catch { return process.env.JADE_TOKEN || ''; } };
const send = m => process.stdout.write(JSON.stringify(m) + '\n');

const TOOL = {
  name: 'approve',
  description: 'Jade decides whether a tool call may run (used by Claude Code as its permission prompt).',
  inputSchema: { type: 'object', properties: { tool_name: { type: 'string' }, input: { type: 'object' }, tool_use_id: { type: 'string' } }, required: ['tool_name', 'input'] },
};

async function decide(a) {
  try {
    const r = await fetch(`http://127.0.0.1:${PORT}/api/permissions/ask`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-jade': key() },
      body: JSON.stringify({ job: JOB, thread: THREAD, tool: a.tool_name, input: a.input || {}, id: a.tool_use_id || '' }),
    });
    const out = await r.json();
    if (out?.behavior === 'allow') return { behavior: 'allow', updatedInput: out.updatedInput || a.input || {} };
    return { behavior: 'deny', message: out?.message || 'Not allowed by Jade' };
  } catch (e) {
    return { behavior: 'deny', message: 'Jade could not be reached to approve this: ' + e.message };
  }
}

createInterface({ input: process.stdin }).on('line', async line => {
  let m; try { m = JSON.parse(line); } catch { return; }
  const { id, method, params } = m;
  if (method === 'initialize') return send({ jsonrpc: '2.0', id, result: { protocolVersion: params?.protocolVersion || '2024-11-05', capabilities: { tools: {} }, serverInfo: { name: 'jade', version: '0.1.0' } } });
  if (method === 'ping') return send({ jsonrpc: '2.0', id, result: {} });
  if (method === 'tools/list') return send({ jsonrpc: '2.0', id, result: { tools: [TOOL] } });
  if (method === 'tools/call') {
    const out = await decide(params?.arguments || {});
    return send({ jsonrpc: '2.0', id, result: { content: [{ type: 'text', text: JSON.stringify(out) }] } });
  }
  if (id !== undefined && !String(method || '').startsWith('notifications/')) send({ jsonrpc: '2.0', id, error: { code: -32601, message: 'Method not found' } });
});
process.stdin.on('end', () => process.exit(0));
