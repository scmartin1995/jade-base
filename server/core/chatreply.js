// A chat reply, start to finish: what a message to Jade adds to the prompt (its turn text, the sources it calls for, attached files), how the
// reply is run (a warm process per conversation), what is written into the conversation when it ends or fails, tidying afterwards, and when
// Skeptic is asked to check a build. The job queue (jobs.js) and the prompt builder (agents.js) only ask here; neither needs to know what a
// chat is. This file imports neither of them, so they can import it.
import path from 'node:path';
import * as config from './config.js';
import * as store from './store.js';
import * as engines from './engines.js';
import * as warm from './warm.js';
import * as tidy from './tidy.js';
import * as subagents from './subagents.js';
import { extractText } from './extract.js';
import { truncate } from './util.js';

/** Once at start: pasted pictures and files older than 30 days are removed. */
export const startup = () => tidy.pruneAttachments(30);

/** Whether an agent's replies are a chat (it talks to the PM in a conversation). */
export const is = def => def?.handler === 'chat';

// ---------------------------------------------------------------- what goes into the prompt
const wantsWords = cid => {
  const src = config.get().connectors?.keywords?.[cid];
  if (!src) return null;
  try { return new RegExp(src, 'i'); } catch { return null; }   // a pattern that does not parse is ignored
};
// Jade's own sources for a chat, by what the message is about (see agents.prepare): the calendar.
export function chatSources(message) {
  const out = [];
  if (wantsWords('calendar')?.test(message) || /\b(today|tomorrow|this week)\b.*\b(call|sync|meeting)s?\b/i.test(message)) out.push('calendar');
  return out;
}

// Any other connector the user switched on (Dropbox, Notion, a company MCP server…) is attached when the message names it.
function wants(cid, message) {
  const re = wantsWords(cid);
  if (re) return re.test(message);
  const c = engines.connector(cid);
  const words = [c?.name, c?.id].filter(Boolean).map(s => s.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()).filter(Boolean);
  return words.some(w => new RegExp(`\\b${w.replace(/\s+/g, '\\s*')}\\b`, 'i').test(message));
}
/** For a chat, connectors are attached only when the message calls for them: each one costs seconds of start-up and thousands of tokens per run. */
export function connectors(def, input) {
  const message = String(input.message || '');
  const extra = engines.connectors().filter(c => c.enabled && !c.curated).map(c => c.id);
  return [...new Set([...def.connectors, ...extra])].filter(n => wants(n, message));
}

// Files attached to a chat message. Claude Code's Read tool opens text, code, CSV, PDFs and images itself, but not Word,
// PowerPoint or Excel files, so the text of those is extracted here and sent with the message (capped per file).
const READ_TOOL_OPENS = /\.(pdf|png|jpe?g|gif|webp|txt|md|markdown|csv|tsv|json|xml|ya?ml|html?|log|ini|toml|sql|py|ts|tsx|jsx|css|ipynb)$/i;
const OFFICE_EXT = new Set(['.docx', '.pptx', '.xlsx']);
function attachedBlock(list = []) {
  if (!list.length) return '';
  const lines = [`\nThey attached ${list.length === 1 ? 'a file' : `${list.length} files`} with this message. Read ${list.length === 1 ? 'it' : 'each one'} before answering:`];
  let budget = 120000;
  for (const f of list) {
    const ext = path.extname(f).toLowerCase();
    if (READ_TOOL_OPENS.test(f) || !OFFICE_EXT.has(ext)) { lines.push(`- ${f} (open it with the Read tool)`); continue; }
    const text = extractText(f);
    if (!text) { lines.push(`- ${f} (its text could not be read; say so if it matters)`); continue; }
    const take = text.slice(0, Math.min(40000, Math.max(0, budget)));
    budget -= take.length;
    lines.push(`- ${f}, its text${take.length < text.length ? ' (the start of it)' : ''}:\n\`\`\`\n${take}\n\`\`\``);
  }
  return lines.join('\n');
}

/** The recent conversation as text (the turns before this one). */
export const recent = input => (store.getThread(input.thread)?.turns || []).slice(-13, -1).map(t => `${t.role === 'user' ? 'User' : 'Jade'}: ${truncate(t.text, 800)}`).join('\n') || '(new conversation)';

/** The line in a chat's system prompt that says where the soul file is. */
export const soulNote = soulFile => `Your soul file, ${soulFile}, is what says how you speak and work. When the user asks you to change that (your tone, your habits, what you always do or never do), edit that file and say what you changed.`;

/** The "This turn" part of a chat prompt: what the user said, where they are, connectors and attachments. */
export function turn(input, usable) {
  return `# This turn\n${input.buildFix || input.wrapUp
    ? `${input.wrapUp ? 'The build check has finished (this came from Jade\'s verifier, not from the user)' : 'This was sent back by Skeptic, Jade\'s verifier, not by the user'}: "${String(input.message).replace(/"/g, '”')}"`
    : String(input.message || '').trim()
    ? `The user says (by ${input.via || 'text'}): "${String(input.message).replace(/"/g, '”')}"`
    : 'The user sent what is attached below with no message.'}\nThey are looking at the "${input.route || 'home'}" page.${usable.length ? `\nConnectors available for this turn: ${usable.join(', ')}. Use them to read only: never create, change, send, share or delete anything through them.` : ''}${(input.images || []).length ? `\nThey pasted ${input.images.length === 1 ? 'an image' : `${input.images.length} images`} with this message. Open ${input.images.length === 1 ? 'it' : 'each one'} with the Read tool before answering:\n${input.images.map(f => `- ${f}`).join('\n')}` : ''}${attachedBlock(input.files)}`;
}

// ---------------------------------------------------------------- running a reply
/** How hard it thinks: the conversation's own setting, then the chat setting in Settings, else the engine's default. */
export const effort = j => store.getThread(j.input.thread)?.effort || config.get().chat?.effort || undefined;

/**
 * Chats keep a warm Claude process per conversation. Runs this reply on it and returns its result, or null when this reply is not
 * warmable (another engine, no conversation) and the caller runs it in a fresh process. A warm chat already has the context it was
 * given earlier, so only what changed since then is sent again.
 */
export async function warmTurn(j, settings, prep, { onText, onTool, onAgent, signal }) {
  if (!(j.engine === 'claude' && j.input.thread)) return null;
  const history = warm.has(j.input.thread, settings) ? '' : prep.history;
  const ctxFor = prep.sections ? warm.contextFor(j.input.thread, settings, prep) : null;
  const prompt = [history, ctxFor ? ctxFor.prompt : prep.prompt].filter(Boolean).join('\n\n');
  return warm.turn(j.input.thread, settings, { prompt, onText, onTool, onAgent, signal, accepted: ctxFor?.remember });
}

// ---------------------------------------------------------------- what the conversation shows
/** Write the reply into the conversation, with what it did. */
export function record(input, job, reply, res) {
  store.appendTurn(input.thread, { role: 'jade', text: reply, applied: res.applied, job: job.id, engine: job.engine, model: job.model || '', tools: (job.tools || []).length, connectors: job.connectors || [], warm: !!job.warm, ...(input.buildFix ? { step: true, label: `Fixed after Skeptic's check ${input.round || 1}` } : {}) });
}

// A chat reply that ends without an answer still says so in the conversation; before, the chat just went quiet.
function note(j, why) {
  if (j.agent !== 'jade' || !j.input?.thread) return;
  // what the reply had done before it stopped (sub-agent cards, changed files) stays with the note, so the work panel still shows it
  const cards = subagents.slim(subagents.finish(structuredClone(j.agents || []), false));   // closed off and slim, so a restart cannot leave cards "Working" for ever
  const kept = { ...(cards.length ? { agents: cards } : {}), ...(j.touched?.length ? { touched: j.touched } : {}) };
  try { store.appendTurn(j.input.thread, { role: 'jade', text: `_${why}_ Send it again and I'll pick it up.`, job: j.id, failed: true, ...kept }); } catch {}
}
/** A reply that was still going when Jade restarted. */
export const interrupted = j => note(j, 'Jade restarted before this reply finished.');
/** A reply that was stopped by the user or ended in an error (j.status and j.error say which; e is what was thrown). */
export function ended(j, e) {
  if (j.status === 'cancelled' && (j.agents?.length || j.touched?.length)) note(j, 'You stopped this reply.');   // a stop that had done something leaves a note, or the panel would lose it
  if (j.status === 'error') note(j, e.stuck ? `This reply looked stuck: ${j.error}, so I stopped it. What it had done so far is above, and any files it changed are kept.` : `This reply stopped: ${j.error.slice(0, 200)}.`);
}

// Add the touched files to the reply the chat handler just wrote, and delete the pasted pictures that have been written up.
function tidyAfterReply(j) {
  try {
    const turns = store.getThread(j.input.thread)?.turns || [];
    const reply = [...turns].reverse().find(x => x.role === 'jade' && x.job === j.id);
    const gone = tidy.releaseImages({ thread: j.input.thread, touched: j.touched || [], message: j.input.message });
    if (reply && (j.touched?.length || gone.length || j.agents?.length)) store.markTurn(j.input.thread, reply.at, { ...(j.touched?.length ? { touched: j.touched } : {}), ...(gone.length ? { imagesDeleted: gone.length } : {}), ...(j.agents?.length ? { agents: subagents.slim(j.agents) } : {}) });
  } catch (e) { console.error('tidy after reply:', e.message); }
}

// ---------------------------------------------------------------- the build loop
// A reply that created or changed files is a build: Skeptic checks it against the request and the plan, and sends any problems back to
// be fixed (review.checkBuild). A fix round is always checked again, up to the configured number of rounds.
export const buildRounds = () => Math.max(1, Math.min(5, Number(config.get().build?.rounds) || 3));
/** Whether a finished chat run starts (or continues) the build loop: { round } or null. A fix round is checked even if it only changed its reply. */
export function buildDue(j) {
  if (config.get().build?.loop === false || !j?.input?.thread) return null;
  if (j.input.buildFix) { const round = (Number(j.input.round) || 1) + 1; return round <= buildRounds() ? { round } : null; }
  if (j.input.auto || !(j.touched || []).length) return null;
  return { round: 1 };
}

/**
 * What to do once a chat reply is done: tidy up (the reply shows what was written; pasted pictures are deleted once what they showed is in
 * a file), and return the Skeptic check to queue when the reply was a build ({ agent, input, trigger, title }), else null.
 */
export function afterReply(j) {
  if (j.input?.thread && (j.touched?.length || j.agents?.length || (j.input.images || []).length)) tidyAfterReply(j);
  const build = buildDue(j);
  return build ? { agent: 'skeptic', input: { thread: j.input.thread, build: true, job: j.id, round: build.round, requestAt: j.input.requestAt || '', objections: j.input.objections || [] }, trigger: 'build-loop', title: build.round > 1 ? `Skeptic: build check, round ${build.round}` : 'Skeptic: build check' } : null;
}
