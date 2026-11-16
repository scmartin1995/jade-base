// User settings live in <JADE_HOME>/config.json. Edits from the UI, or by hand in an editor, apply live.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { expand, readJSON, writeJSON, ensureDir } from './util.js';
import { emit } from './bus.js';

export const JADE_HOME = expand(process.env.JADE_HOME || '~/JadeBase');
export const APP_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
// The one place Claude Code's own folders are found (skills, its .claude.json). JADE_CLAUDE_HOME stands in for ~/.claude so tests
// and trial runs never touch the real one; the .claude.json beside it follows the same switch.
export const claudeHome = () => expand(process.env.JADE_CLAUDE_HOME || '~/.claude');
export const claudeJson = () => (process.env.JADE_CLAUDE_HOME ? path.join(claudeHome(), '.claude.json') : expand('~/.claude.json'));
export const STATE = path.join(JADE_HOME, '.state');
/** The port Jade listens on when JADE_PORT is not set. The one place the server and launcher read it from; files that cannot import this
 * (the bridge, the approval tool, the shell and Windows launchers) keep a copy on purpose, and test/server-edges.test.js checks they agree. */
export const DEFAULT_PORT = 4778;
export const port = () => Number(process.env.JADE_PORT) || DEFAULT_PORT;
const CONFIG_FILE = path.join(JADE_HOME, 'config.json');

export const DEFAULTS = {
  name: '',
  window: 'app',             // how the launcher opens Jade: 'app' = its own window with no address bar (Chrome, Edge, Chromium, Brave); 'tab' = a tab in your normal browser. JADE_WINDOW and --tab override it
  assistantName: 'Jade',
  role: 'project manager',   // what the assistant is told the user does (the soul file and the profile line say it)
  wakeWord: 'hey jade',
  models: { claude: '' },    // '' = the everyday model found by model discovery (models.everyday()), resolved at run time
  chat: { effort: '', releaseImages: true },   // effort: how hard the model thinks in chat; '' = the model's own default, as in Claude Code. releaseImages: a pasted picture is deleted once what it shows is written into a file
  build: { loop: true, rounds: 3 },   // loop: Skeptic checks every chat reply that creates or changes files, and Jade fixes what it finds. rounds: checks in all before the user decides
  agents: { model: '', checkerModel: '', effort: '', checkerEffort: '' },   // automated work (the Transcript agent, the checking agent, dashboards, routines). model/effort '' = the model's own default; checkerEffort '' = the same as effort
  concurrency: 2,            // agents running at once; chats do not wait behind them
  voice: { wake: false, speak: false, engine: 'auto' },    // engine: auto | webspeech | vosk
  limits: { jsonBody: 2 * 1024 * 1024 },  // bytes: the largest JSON request body the server reads (413 beyond it)
  modules: {},               // id -> boolean; missing means the module's default
  memory: { reindexMinutes: 15, folders: [], extensions: ['.md', '.markdown', '.txt', '.org', '.docx', '.pptx', '.xlsx', '.pdf'] },   // reindexMinutes: how often the memory folders are re-read (5 at the least)
  // enabled: id -> boolean (Gmail/Calendar/Drive/web default on, anything else default off). keywords: id -> a regular expression (text); a chat
  // gets a connector only when its message matches, because each one costs seconds of start-up. Change them in config.json.
  connectors: { enabled: {}, keywords: {
    gmail: '\\b(e-?mails?|mail|inbox|messages? (from|to)|replied|reply to|thread|unread|sent me|newsletter)\\b',
    calendar: '\\b(calendar|meetings?|schedule|invite|agenda|appointment|1:1|stand-?up|when (am|is|are) |free (slot|time)|busy|this afternoon|tomorrow morning)\\b',
    drive: '\\b(drive|google ?docs?|sheets?|slides?|spreadsheet|deck|shared (doc|file|folder))\\b',
    web: '\\b(search|look ?up|google|latest|news|online|web|internet|what(\'s| is) (the )?(current|latest)|who is|price|weather|release)\\b',
  } },
  permissions: { mode: 'irreversible', roots: [] },  // mode: read | ask | irreversible | auto; roots: folders outside home Jade may edit
  output: { folder: '', rules: {} },    // folder: where Jade saves the files it makes for you (your notes folder, say); empty = <data folder>/deliverables. rules: folder and file names the file ring knows (see outputs.js DEFAULT_RULES)
  storage: { folderName: 'Jade' },   // the sub-folder of a project's first folder where Jade keeps that project's notes, actions, meetings and dashboards
  bridge: { enabled: false },   // the Claude bridge routes (bridge/README.md): off until switched on in Settings
  privacy: { webFonts: true },  // false = never load Google Fonts (system fonts instead)
  schedules: {},             // agentId -> schedule string override, or "off"
  skills: {},                // skillName -> { enabled, automation }
};

let current = null;

function merge(base, over) {
  if (over === undefined) return base;
  if (!over || typeof over !== 'object' || Array.isArray(over)) return over;
  const out = { ...(base && typeof base === 'object' && !Array.isArray(base) ? base : {}) };
  for (const [k, v] of Object.entries(over)) out[k] = merge(out[k], v);
  return out;
}

/** Config defaults a module brings. What is already in DEFAULTS wins, so a module cannot change a core setting. */
export function addDefaults(extra) {
  Object.assign(DEFAULTS, merge(extra, DEFAULTS));
  if (current) load();
}

export function load() {
  ensureDir(JADE_HOME);
  // the key lives in here: owner-only from the first moment, and an older folder is tightened too (the mode is ignored on Windows)
  fs.mkdirSync(STATE, { recursive: true, mode: 0o700 });
  try { fs.chmodSync(STATE, 0o700); } catch { /* not supported here */ }
  let raw = readJSON(CONFIG_FILE, null);
  if (!raw) { raw = { name: '' }; writeJSON(CONFIG_FILE, raw); }
  current = merge(DEFAULTS, raw);
  if (!Array.isArray(current.memory.folders)) current.memory.folders = [];
  return current;
}

export function get() { return current || load(); }

// Arrays replace rather than merge, so the UI can remove list entries.
export function save(patch) {
  const raw = readJSON(CONFIG_FILE, {});
  writeJSON(CONFIG_FILE, merge(raw, patch));
  load();
  emit('config', {});
  return current;
}

export function configFile() { return CONFIG_FILE; }

/**
 * The folder Jade saves new files in when a project has no folder of its own. The one chosen under Settings > Files, else
 * JadeBase/deliverables. A chosen folder that is not there right now (a drive that is offline) falls back to the default rather
 * than being created as a stray path.
 */
export function outputDir() {
  const chosen = get().output?.folder ? expand(get().output.folder) : '';
  return chosen && fs.existsSync(chosen) ? chosen : path.join(JADE_HOME, 'deliverables');
}
export const outputIsCustom = () => outputDir() !== path.join(JADE_HOME, 'deliverables');

export function memoryFolders() {
  return [...new Set(get().memory.folders.map(expand))].filter(p => fs.existsSync(p));
}
