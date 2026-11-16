#!/usr/bin/env node
// Jade MCP server: the bridge commands as tools a Claude session can call. Zero dependencies; JSON-RPC 2.0, one message per
// line on stdin/stdout. Tools are named jade_<command> (dashes become underscores). There is deliberately no tool that
// changes anything outside Jade, deletes anything or edits a user's file. Every tool call goes through the same code as jade-bridge.mjs.
import { COMMANDS, execute } from './jade-bridge.mjs';

const PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const toolName = c => 'jade_' + c.replace(/-/g, '_');
const byTool = new Map(Object.keys(COMMANDS).map(c => [toolName(c), c]));

export function toolList() {
  return Object.entries(COMMANDS).map(([c, s]) => ({
    name: toolName(c),
    description: s.about,
    inputSchema: {
      type: 'object',
      properties: Object.fromEntries(Object.entries(s.args).map(([k, a]) => [k, a.kind === 'b' ? { type: 'boolean', description: a.about }
        : a.kind === 'n' ? { type: 'integer', minimum: a.min, maximum: a.max, description: a.about }
        : a.kind === 'e' ? { type: 'string', enum: a.values, description: a.about }
        : { type: 'string', description: a.about }])),
      required: Object.entries(s.args).filter(([, a]) => a.required).map(([k]) => k),
      additionalProperties: false,
    },
  }));
}

const result = (id, r) => ({ jsonrpc: '2.0', id, result: r });
const error = (id, code, message) => ({ jsonrpc: '2.0', id, error: { code, message } });

/** Handle one parsed message; returns the reply object, or null for a notification. */
export async function handle(msg) {
  if (!msg || typeof msg !== 'object' || Array.isArray(msg)) return error(null, -32600, 'Invalid request');
  const { id, method, params } = msg;
  const isNote = id === undefined || id === null;
  if (typeof method !== 'string') return isNote ? null : error(id, -32600, 'Invalid request');
  if (method === 'initialize') {
    const asked = params?.protocolVersion;
    return result(id, { protocolVersion: PROTOCOLS.includes(asked) ? asked : PROTOCOLS[0], capabilities: { tools: {} }, serverInfo: { name: 'jade', version: '0.1.0' } });
  }
  if (isNote) return null;                                  // notifications/initialized, cancelled, and the like get no reply
  if (method === 'ping') return result(id, {});
  if (method === 'tools/list') return result(id, { tools: toolList() });
  if (method === 'tools/call') {
    const command = byTool.get(params?.name);
    if (!command) return error(id, -32602, `Unknown tool: ${params?.name}`);
    const out = await execute(command, params.arguments ?? {});
    return result(id, { content: [{ type: 'text', text: JSON.stringify(out) }], isError: out.ok === false });
  }
  return error(id, -32601, `Method not found: ${method}`);
}

async function serve() {
  process.stdin.setEncoding('utf8');
  let buf = '';
  let chain = Promise.resolve();
  const send = o => process.stdout.write(JSON.stringify(o) + '\n');
  const line = text => {
    if (!text.trim()) return;
    let msg;
    try { msg = JSON.parse(text); } catch { return send(error(null, -32700, 'Parse error')); }
    // replies keep the order calls came in, and one bad call never stops the server
    chain = chain.then(async () => { try { const r = await handle(msg); if (r) send(r); } catch (e) { if (msg?.id !== undefined && msg?.id !== null) send(error(msg.id, -32603, String(e?.message || e))); } });
  };
  process.stdin.on('data', d => {
    buf += d;
    let i;
    while ((i = buf.indexOf('\n')) >= 0) { line(buf.slice(0, i)); buf = buf.slice(i + 1); }
  });
  process.stdin.on('end', () => { if (buf.trim()) line(buf); chain.then(() => process.exit(0)); });
}

import fs from 'node:fs';
const isMain = (() => { try { return !!process.argv[1] && fs.realpathSync(process.argv[1]) === fs.realpathSync(new URL(import.meta.url)); } catch { return false; } })();
if (isMain) serve();
