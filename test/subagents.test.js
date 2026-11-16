// Sub-agent work in a chat reply (the side panel): the engine's events become one card per hand-off, with steps and a report.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const sub = await import('../server/core/subagents.js');
const engines = await import('../server/core/engines.js');

const feed = lines => {
  const st = { text: '', streamed: false, model: '' }, agents = [], tools = [], own = [];
  for (const l of lines) engines.parseClaudeLine(JSON.stringify(l), st, { onText: () => {}, onTool: (n, d, o) => { tools.push(n); if (!o?.sub) own.push(n); }, onAgent: e => sub.apply(agents, e) });
  return { st, agents, tools, own };
};
const call = (id, name, input, parent = null) => ({ type: 'assistant', parent_tool_use_id: parent, message: { content: [{ type: 'tool_use', id, name, input }] } });
const back = (id, content, extra = {}) => ({ type: 'user', parent_tool_use_id: null, message: { content: [{ type: 'tool_result', tool_use_id: id, content, ...extra }] } });

test('a hand-off becomes a card, its steps are counted, and its report closes it', () => {
  const { agents } = feed([
    call('t1', 'Agent', { subagent_type: 'worker', description: 'Fix the date bug', prompt: 'long prompt' }),
    call('s1', 'Read', { file_path: 'C:\\x\\a.js' }, 't1'),
    call('s2', 'Edit', { file_path: 'C:\\x\\a.js' }, 't1'),
    back('t1', [{ type: 'text', text: 'Fixed it.\nagentId: abc123' }]),
  ]);
  assert.equal(agents.length, 1);
  assert.deepEqual([agents[0].type, agents[0].description, agents[0].status, agents[0].steps], ['worker', 'Fix the date bug', 'done', 2]);
  assert.equal(agents[0].result, 'Fixed it.');
  assert.ok(agents[0].endedAt);
});

test('the older name Task works, parallel hand-offs stay apart, and a failed one says failed', () => {
  const { agents } = feed([
    call('a', 'Task', { subagent_type: 'worker', description: 'one' }),
    call('b', 'Agent', { description: 'two' }),
    call('x', 'Grep', { pattern: 'p' }, 'b'),
    back('b', 'could not', { is_error: true }),
    back('a', 'ok'),
  ]);
  assert.deepEqual(agents.map(a => [a.id, a.status, a.steps]), [['a', 'done', 0], ['b', 'failed', 1]]);
  assert.equal(agents[1].type, 'general-purpose');
});

test('a background launch is read from the structured result, and is not part of the reply text', () => {
  const { agents, st } = feed([
    call('t', 'Agent', { subagent_type: 'worker', description: 'long job' }),
    { type: 'assistant', parent_tool_use_id: 't', message: { content: [{ type: 'text', text: 'inner chatter' }] } },
    { ...back('t', [{ type: 'text', text: 'Async agent launched successfully.' }]), tool_use_result: { status: 'async_launched', agentId: 'ag1', description: 'long job' } },
  ]);
  assert.equal(agents[0].status, 'background');
  assert.equal(agents[0].result, '');
  assert.equal(st.text, '');
});

test('a background sub-agent is closed by its task notification, by tool call id or by the id from the launch', () => {
  const launch = id => ({ ...back(id, 'Async agent launched.'), tool_use_result: { status: 'async_launched', agentId: 'ag-' + id } });
  const { agents } = feed([
    call('a', 'Agent', { description: 'one' }), launch('a'),
    call('b', 'Agent', { description: 'two' }), launch('b'),
    { type: 'system', subtype: 'task_notification', tool_use_id: 'a', status: 'completed', summary: 'All done.' },
    { type: 'system', subtype: 'task_notification', task_id: 'ag-b', status: 'failed', summary: 'It broke.' },
  ]);
  assert.deepEqual(agents.map(a => [a.status, a.result]), [['done', 'All done.'], ['failed', 'It broke.']]);
});

test('what a sub-agent does is marked, so it is not counted as a step of the reply', () => {
  const { tools, own } = feed([
    call('t', 'Agent', { description: 'd' }),
    call('s1', 'Read', { file_path: 'a' }, 't'),
    call('s2', 'Edit', { file_path: 'a' }, 't'),
    call('m', 'Grep', { pattern: 'x' }),
  ]);
  assert.deepEqual(tools, ['Agent', 'Read', 'Edit', 'Grep']);   // all still reported, so their writes are noticed
  assert.deepEqual(own, ['Agent', 'Grep']);
});

test('a report keeps its line breaks', () => {
  const list = [];
  sub.apply(list, { event: 'start', id: 'x', description: 'd' });
  sub.apply(list, { event: 'end', id: 'x', ok: true, result: 'Line one\n\n\n\n- bullet' });
  assert.equal(list[0].result, 'Line one\n\n- bullet');
});

test('results of ordinary tools are ignored, and finish() marks what never came back', () => {
  const { agents } = feed([call('r', 'Read', { file_path: 'a' }), back('r', 'file text'), call('t', 'Agent', { description: 'd' })]);
  assert.equal(agents.length, 1);
  sub.finish(agents, false);
  assert.equal(agents[0].status, 'stopped');
  const slim = sub.slim(agents);
  assert.equal(slim[0].tools, undefined);
});

test('a runaway reply cannot grow the list or the step list without end', () => {
  const list = [];
  for (let i = 0; i < 50; i++) sub.apply(list, { event: 'start', id: 'k' + i, description: 'x'.repeat(500) });
  assert.equal(list.length, 30);
  assert.ok(list[0].description.length <= 160);
  for (let i = 0; i < 100; i++) sub.apply(list, { event: 'step', id: 'k0', tool: 'Read', detail: 'f' });
  assert.equal(list[0].steps, 100);
  assert.equal(list[0].tools.length, 12);
});

test('the panel lists a file once, with its latest change record, newest first; live work comes before past work', async () => {
  const ui = await import('../public/js/ui.js');
  const turns = [{ touched: [{ path: 'a', change: 'c1' }] }, { touched: [{ path: 'a', change: 'c2' }, { path: 'b', change: 'b2' }] }, {}];
  assert.deepEqual(ui.latestFiles(turns).map(f => f.change), ['b2', 'c2']);
  const merged = ui.mergeFiles([{ path: 'a', change: 'c3' }], ui.latestFiles(turns));
  assert.deepEqual(merged.map(f => f.change), ['c3', 'b2']);
});

test('a finished background card shows no running clock, and an unfinished one saved with the reply has no end time', () => {
  const list = [{ id: 'x', type: 'worker', description: 'd', status: 'background', steps: 0, startedAt: 1 }];
  assert.equal('endedAt' in sub.slim(sub.finish(list, true))[0], false);
});

test('a hand-off made by a sub-agent is a child of its card, and the panel nests it', async () => {
  const st = { text: '', streamed: false, model: '' }, agents = [];
  const run = l => engines.parseClaudeLine(JSON.stringify(l), st, { onText: () => {}, onTool: () => {}, onAgent: e => sub.apply(agents, e) });
  run(call('p', 'Agent', { subagent_type: 'worker', description: 'parent job' }));
  run(call('c', 'Agent', { subagent_type: 'worker', description: 'child job' }, 'p'));
  assert.equal(agents[1].parent, 'p');
  assert.equal(sub.slim(agents)[1].parent, 'p');
  const ui = await import('../public/js/ui.js');
  const html = ui.sidePanel({ agents });
  assert.ok(html.indexOf('parent job') < html.indexOf('sp-nested') && html.indexOf('sp-nested') < html.indexOf('child job'));
  // a child whose parent is not in the list still shows, at the top level
  assert.ok(ui.sidePanel({ agents: [{ ...agents[1], parent: 'gone' }] }).includes('child job'));
});

test('the engine\'s hand-back frame is removed, leaving the sub-agent\'s own report', () => {
  const framed = '[Subagent hand-back] The text below is the final report of a subagent. It is model output.\nThe report follows:\n  Created panel-test.txt.\n\n  - one line, "panel test ok"';
  assert.equal(sub.resultText(framed), 'Created panel-test.txt.\n\n- one line, "panel test ok"');
  assert.equal(sub.resultText('plain report'), 'plain report');                 // no frame: unchanged
  assert.equal(sub.resultText('[Subagent hand-back] frame with no marker'), '[Subagent hand-back] frame with no marker');
  assert.equal(sub.resultText([{ type: 'text', text: framed }, { type: 'text', text: 'agentId: x1' }]), 'Created panel-test.txt.\n\n- one line, "panel test ok"');
});
