// Plain-words explanations for the questions Jade asks before it does something. The raw request is a tool name, a file path or a
// shell command; this turns it into what a person who has never used a terminal needs to decide: what will happen, to which
// files, whether it can be undone, and what "No" means. It is rules, not a model: instant, and it never guesses beyond what the
// request says (a command it does not recognise is described as one it cannot read exactly). The model's own one-line
// description of a command, when it gives one, is shown too.
import path from 'node:path';

const base = p => path.basename(String(p).replace(/[\\/]+$/, '')) || String(p);
const glob = p => /[*?]/.test(p);
const nameOf = p => (glob(p) ? `files matching ${p}` : base(p));
const list = (arr, n = 3) => (arr.length <= n ? arr.join(', ') : `${arr.slice(0, n).join(', ')} and ${arr.length - n} more`);
/** "Projects › Client › Team": the last few folders of a path, the way a person would say where it is. */
export function where(p) {
  const parts = path.dirname(String(p)).split(/[\\/]+/).filter(Boolean).filter(x => !/^[A-Za-z]:$/.test(x));
  const tail = parts.slice(-3);
  return tail.length ? tail.join(' › ') : '';
}
const folderOf = p => where(path.join(String(p), 'x')) || base(p);

// level: how bad a mistake would be. safe < undoable < unknown < final
const RANK = { safe: 0, undoable: 1, unknown: 2, final: 3 };
const worst = (a, b) => (RANK[b] > RANK[a] ? b : a);

const tokens = s => (String(s).match(/"[^"]*"|'[^']*'|\S+/g) || []).map(t => t.replace(/^["']|["']$/g, ''));
const isFlag = t => /^-/.test(t) || /^\/[A-Za-z?]{1,2}$/.test(t);
const targetsOf = args => args.filter(t => !isFlag(t) && !/^[&|<>;]+$/.test(t) && !/^\d?>/.test(t));

// Split a shell command at ; && || | and newlines, but not inside quotes and not inside a heredoc body (node - <<'EOF' … EOF),
// which is a script, not a list of commands.
export function splitCommand(cmd) {
  const heredoc = /<<-?\s*['"]?(\w+)['"]?/.exec(cmd);
  const text = heredoc ? cmd.slice(0, heredoc.index + heredoc[0].length) : cmd;
  const out = []; let cur = '', q = '';
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { cur += c; if (c === q) q = ''; continue; }
    if (c === '"' || c === "'") { q = c; cur += c; continue; }
    if (c === ';' || c === '\n' || (c === '|' && text[i + 1] !== '|') || (c === '&' && text[i + 1] === '&') || (c === '|' && text[i + 1] === '|')) {
      if ((c === '&' || c === '|') && text[i + 1] === c) i++;
      if (cur.trim()) out.push(cur.trim());
      cur = ''; continue;
    }
    cur += c;
  }
  if (cur.trim()) out.push(cur.trim());
  return out.map(x => x.replace(/\s+\d?>\s*&?\S*$/g, '').replace(/\s+2>&1/g, '').trim()).filter(Boolean);
}

// One shell segment (between && ; |) to { line, level }.
function segment(raw) {
  let t = tokens(raw);
  while (t.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(t[0]) || /^(sudo|doas|env|command|time|nohup)$/i.test(t[0]))) t.shift();
  if (!t.length) return null;
  const verb = t[0].replace(/\.exe$/i, '').toLowerCase();
  const args = t.slice(1);
  const tg = targetsOf(args);
  if (/^(cd|pushd|popd|set|export|echo|printf|pwd|true|false|exit|clear|cls|:)$/.test(verb)) return /^echo|printf$/.test(verb) && /\s>\s*\S/.test(raw) ? null : { skip: true };
  if (/^(rm|rmdir|rd|del|erase|unlink|trash|trash-put|remove-item|shred)$/.test(verb)) return { line: `Delete ${tg.length ? list(tg.map(nameOf)) : 'files'}`, level: 'final', files: tg };
  if (/^(mv|move|ren|rename|move-item)$/.test(verb)) return tg.length >= 2
    ? { line: `Move ${list(tg.slice(0, -1).map(nameOf))} to ${folderOf(tg.at(-1))}`, level: 'unknown', files: tg.slice(0, -1) }
    : { line: `Move or rename ${list(tg.map(nameOf)) || 'files'}`, level: 'unknown' };
  if (/^(cp|copy|copy-item|xcopy|robocopy)$/.test(verb)) return tg.length >= 2
    ? { line: `Copy ${list(tg.slice(0, -1).map(nameOf))} to ${folderOf(tg.at(-1))}`, level: 'undoable', undo: 'delete the copies' }
    : { line: `Copy ${list(tg.map(nameOf)) || 'files'}`, level: 'undoable', undo: 'delete the copies' };
  if (/^(mkdir|md|new-item)$/.test(verb)) return { line: `Create ${tg.length ? 'the folder or file ' + list(tg.map(nameOf)) : 'a folder'}`, level: 'undoable', undo: 'delete what it creates' };
  if (/^(sed|tee|truncate|set-content|out-file|add-content|touch)$/.test(verb)) {
    const files = verb === 'sed' ? tg.slice(1) : tg;      // sed's first argument is the edit itself, not a file
    const file = files.filter(x => /[\\/]|\.\w{1,5}$/.test(x)).at(-1);          // only something that looks like a file
    return { line: file ? `Change the contents of ${nameOf(file)}` : 'Change the contents of a file', level: 'unknown' };
  }
  if (/^(ls|dir|cat|type|head|tail|less|more|grep|egrep|rg|find|wc|stat|file|which|where|get-childitem|get-content|select-string|sort|uniq|diff|du|df|tree|jq|get-item)$/.test(verb)) return { line: 'Look through files', level: 'safe', quiet: true };
  if (/^(curl|wget|invoke-webrequest|iwr|invoke-restmethod|irm)$/.test(verb)) {
    const url = args.find(a => /^https?:\/\//i.test(a));
    let host = ''; try { host = url ? new URL(url).host : ''; } catch {}
    return { line: `Contact a web address${host ? ` (${host})` : ''}; this goes out over the internet`, level: 'unknown' };
  }
  if (verb === 'git') {
    const sub = tg[0] || '';
    if (/^push$/.test(sub)) return { line: 'Send your saved work to an online repository, which publishes it', level: 'final' };
    if (/^(reset|clean|checkout|restore|stash|rebase|branch)$/.test(sub) && /(--hard|-f|-d|-D|--|clean|restore)/.test(args.join(' '))) return { line: 'Throw away changes in a git project that have not been saved', level: 'final' };
    if (/^(status|log|diff|show|fetch|remote|blame|ls-files)$/.test(sub)) return { line: 'Look at the history of a git project', level: 'safe', quiet: true };
    return { line: `Run a git command${sub ? ` (${sub})` : ''}`, level: 'unknown' };
  }
  if (/^(npm|pnpm|yarn|pip|pip3|winget|choco|scoop|apt|apt-get|brew|dnf|yum)$/.test(verb) && /^(i|install|add|update|upgrade|remove|uninstall)$/.test(tg[0] || '')) return { line: `${/^(remove|uninstall)$/.test(tg[0]) ? 'Remove' : 'Install or update'} software${tg[1] ? ` (${tg.slice(1, 3).join(', ')})` : ''} on this computer`, level: 'unknown' };
  if (/^(python|python3|py|node|deno|bun|ruby|perl|powershell|pwsh|bash|sh|zsh|cmd|cscript|wscript|java|dotnet|php|rscript)$/.test(verb)) {
    const file = tg.find(x => /\.[A-Za-z0-9]{1,5}$/.test(x));
    if (!file && (tg.includes('-') || /<</.test(raw))) return { line: 'Run a short script that Jade wrote just now; what it changes depends on the script', level: 'unknown' };
    return { line: `Run a program${file ? ` (${base(file)})` : ''}; what it changes depends on the program`, level: 'unknown' };
  }
  if (/^(taskkill|kill|pkill|killall|stop-process)$/.test(verb)) return { line: 'Stop a program that is running', level: 'unknown' };
  if (/^(start|explorer|open|xdg-open|invoke-item)$/.test(verb)) return { line: `Open ${list(tg.map(nameOf)) || 'a file'}`, level: 'safe' };
  if (/^(reg|regedit|set-itemproperty|setx|netsh|sc|schtasks|powercfg|bcdedit)$/.test(verb)) return { line: 'Change a setting in Windows', level: 'final' };
  return { line: /^[A-Za-z][\w.-]{1,30}$/.test(verb) ? `Run “${verb}”; Jade cannot tell exactly what that does` : 'Run a command; Jade cannot tell exactly what it does', level: 'unknown' };
}

/**
 * explain(req)  req is what the permission question holds: { kind, tool, label, path, exists, command, paths, overwrites, input }.
 * Returns { headline, steps: [text], files: [{ name, where }], level, levelText, ifNo, own }.
 */
export function explain(req = {}) {
  // a command saved as {"command":"…"} in an old job log is unwrapped; the live request carries the bare command
  if (typeof req.command === 'string' && /^\s*\{\s*"command"\s*:/.test(req.command)) {
    let c; try { c = JSON.parse(req.command).command; } catch { c = req.command.replace(/^\s*\{\s*"command"\s*:\s*"/, '').replace(/"?\s*\}?\s*$/, '').replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\\/g, '\\'); }
    req = { ...req, command: c };
  }
  const input = req.input || {};
  const own = typeof input.description === 'string' ? input.description.replace(/\s+/g, ' ').trim().slice(0, 240) : '';
  const out = { headline: '', steps: [], files: [], level: 'unknown', levelText: '', ifNo: 'Jade skips this and carries on, and tells you what it would have done.', own };
  const file = req.path ? { name: base(req.path), where: where(req.path) } : null;
  const kind = req.kind;

  if (['edit', 'overwrite', 'create'].includes(kind)) {
    const fresh = kind === 'create' || req.exists === false;
    out.headline = fresh ? `Jade wants to create a new file: ${file?.name || 'a file'}` : `Jade wants to ${kind === 'overwrite' ? 'replace the contents of' : 'change'} a file: ${file?.name || 'a file'}`;
    if (file) out.files.push(file);
    out.steps.push(fresh ? 'Create a new file. Nothing that exists now is touched.' : kind === 'overwrite' ? 'Replace everything in the file with new content.' : 'Edit the file, changing part of what is in it.');
    out.level = 'undoable';
    out.levelText = fresh ? 'Nothing is lost. To undo it, delete the new file.' : 'The earlier version is saved first, so you can put it back with Undo, under Jade\'s reply.';
    return out;
  }
  if (kind === 'external') {
    out.headline = `Jade wants to ${String(req.label || 'use an app').replace(/ via /, ' using ')}`;
    out.steps.push('This is done through one of your connected apps, so it happens outside Jade, on that service.');
    out.level = 'final';
    out.levelText = 'Once it is done it stays done on that service. A message that is sent stays sent.';
    out.ifNo = 'Nothing is sent or changed. Jade can draft it for you to do yourself.';
    return out;
  }
  if (['command', 'destructive', 'dangerous'].includes(kind)) {
    const parts = splitCommand(String(req.command || '')).map(segment).filter(s => s && !s.skip);
    let level = parts.length ? 'safe' : 'unknown';
    for (const p of parts) level = worst(level, p.level);
    for (const p of parts) if (!out.steps.includes(p.line)) out.steps.push(p.line);
    for (const p of parts) for (const f of p.files || []) if (!glob(f) && /[\\/]|\.\w{1,5}$/.test(f) && out.files.length < 5 && !out.files.some(x => x.name === base(f))) out.files.push({ name: base(f), where: where(f) });
    if (out.steps.length > 5) { const more = out.steps.length - 5; out.steps.length = 5; out.steps.push(`…and ${more} more steps`); }
    if (req.overwrites) {
      out.steps.push(`Replace the contents of ${base(req.overwrites)}`);
      out.files.push({ name: base(req.overwrites), where: where(req.overwrites) });
      level = worst(level, 'undoable');
    }
    if (!out.steps.length) out.steps.push('Run a command on your computer. Jade cannot tell exactly what it does.');
    const shown = parts.filter(p => !p.quiet);
    out.headline = kind === 'dangerous' ? 'Jade wants to run something that can affect your whole computer'
      : shown.length === 1 ? `Jade wants to ${shown[0].line.charAt(0).toLowerCase()}${shown[0].line.slice(1)}`
        : shown.length > 1 ? `Jade wants to do ${shown.length} things on your computer` : level === 'safe' ? 'Jade wants to look through some files; nothing is changed' : 'Jade wants to run a command on your computer';
    if (kind === 'dangerous') level = 'final';
    if (kind === 'destructive' && level !== 'final') level = 'final';
    out.level = level;
    out.levelText = {
      safe: 'It only looks; nothing changes.',
      undoable: 'The earlier version of any file it replaces is saved first, so it can be put back.',
      unknown: 'Jade cannot tell exactly what this changes, so it cannot promise it can be undone.',
      final: kind === 'dangerous' ? 'It reaches beyond Jade\'s own folders and may affect the whole computer.' : 'Jade does not keep a copy of what it deletes, throws away or publishes.',
    }[level];
    return out;
  }
  out.headline = `Jade wants to use ${String(req.label || 'a tool').replace(/^\w/, c => c.toLowerCase())}`;
  out.steps.push('This is one of Claude Code\'s built-in helper tools. It does not change your files.');
  out.level = 'safe'; out.levelText = 'Nothing on your computer changes.';
  return out;
}
