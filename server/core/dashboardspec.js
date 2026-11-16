// The dashboard specification: what a dashboard IS now. A model chooses what to show; Jade's own code draws it
// (public/js/dashboard/). A specification is plain JSON and is checked strictly here: every name must be one of the lists below,
// every string is length-capped, and anything unknown is rejected rather than passed through. Nothing in a specification is ever
// markup or script; the page shows every string as text.
//
// To add a layout: add one entry to LAYOUTS below, and one renderer file public/js/dashboard/layouts/<id>.js (see docs/EXTENDING.md).

export const LIMITS = { title: 80, intro: 400, sectionTitle: 80, note: 600, label: 40, value: 80, sections: 12, fields: 6, filters: 3, figures: 6, maxRows: 100 };

const F = (label, type, extra = {}) => ({ label, type, ...extra });

/**
 * What a dashboard can draw from. Field types: text, date (YYYY-MM-DD), number, flag (yes/no), choice (a fixed list).
 * `main` is the field that names a row.
 */
export const SOURCES = {
  actions: { label: 'Actions', one: 'action', main: 'text', fields: {
    text: F('Action', 'text'), owner: F('Owner', 'text'), due: F('Due', 'date'),
    status: F('Status', 'choice', { options: ['open', 'done'] }), overdue: F('Overdue', 'flag'), source: F('From', 'text') } },
  notes: { label: 'Notes', one: 'note', main: 'title', fields: {
    title: F('Note', 'text'), date: F('Updated', 'date'), excerpt: F('Start of the note', 'text') } },
  meetings: { label: 'Meetings', one: 'meeting', main: 'title', fields: {
    title: F('Meeting', 'text'), date: F('Date', 'date'), decisions: F('Decisions and key points', 'number'),
    risks: F('Risks', 'number'), actions: F('Actions', 'number') } },
  files: { label: 'Files', one: 'file', main: 'name', fields: {
    name: F('File', 'text'), folder: F('Folder', 'text'), kind: F('Kind', 'text'), modified: F('Changed', 'date') } },
  claudesetup: { label: 'Claude Code set-up', one: 'folder', main: 'folder', fields: {
    folder: F('Folder', 'text'), claudeMd: F('Has CLAUDE.md', 'flag'), agents: F('Agents', 'number'), skills: F('Skills', 'number'),
    commands: F('Commands', 'number'), tools: F('Connected tools', 'number'), settings: F('Has settings', 'flag'), git: F('Uses git', 'flag'),
    sessions: F('Claude Code sessions', 'number'), lastSession: F('Last session', 'date') } },
};

/** Operators, and the field types each one may be used with. */
export const OPS = {
  is: ['text', 'choice', 'flag', 'number', 'date'], is_not: ['text', 'choice', 'number', 'date'], contains: ['text'],
  before: ['date'], after: ['date'], above: ['number'], below: ['number'], empty: ['text', 'date', 'choice'], not_empty: ['text', 'date', 'choice'],
};
const NO_VALUE = new Set(['empty', 'not_empty']);

/**
 * The layouts. `uses` are the options a layout reads (others are dropped), `need` the ones it cannot do without, `sources` limits
 * where it can draw from (one entry fills `source` in by itself), `groupType` the kind of field `group` must name.
 */
export const LAYOUTS = {
  headline: { label: 'Headline numbers', help: 'Big counts with a label each, such as "Overdue actions".', uses: ['figures'], need: ['figures'] },
  table: { label: 'Table', help: 'Rows and columns of the fields you choose.', uses: ['source', 'filter', 'sort', 'limit', 'fields'], need: ['source', 'fields'] },
  grouped: { label: 'Grouped list', help: 'A list split under headings, such as actions by owner.', uses: ['source', 'filter', 'sort', 'limit', 'fields', 'group'], need: ['source', 'group'] },
  bars: { label: 'Bar chart', help: 'A bar for each value of a field, as long as how many there are.', uses: ['source', 'filter', 'limit', 'group'], need: ['source', 'group'] },
  timeline: { label: 'Timeline', help: 'Things in date order along a line.', uses: ['source', 'filter', 'limit', 'fields', 'group'], need: ['source', 'group'], groupType: 'date' },
  due: { label: 'Next two weeks', help: 'Open actions that fall due in the next 14 days, with any overdue ones first.', uses: ['source', 'filter', 'limit'], need: ['source'], sources: ['actions'] },
  text: { label: 'Text', help: 'A few plain sentences of your own.', uses: ['note'], need: ['note'] },
  meetings: { label: 'Recent meetings', help: 'For each recent meeting: decisions and key points, risks and actions.', uses: ['source', 'filter', 'limit'], need: ['source'], sources: ['meetings'] },
};

// How many rows a section shows when the specification gives no limit. It is kept here, one number per layout, because it is part of how
// each layout is drawn (not of its schema entry); a new layout adds its number here and a layout with none shows 20.
const DEFAULT_LIMIT = { table: 15, grouped: 30, bars: 8, timeline: 20, due: 30, meetings: 3 };
// Every lookup by a name a model supplied goes through `own`: a name such as "constructor" or "toString" is inherited by every
// object and must never count as a layout, source, field or operator.
const own = (table, name) => (typeof name === 'string' && Object.hasOwn(table, name) ? table[name] : undefined);
export const defaultLimit = layout => own(DEFAULT_LIMIT, layout) || 20;

const allFields = () => [...new Set(Object.values(SOURCES).flatMap(s => Object.keys(s.fields)))];

/** The JSON schema the model's answer must follow (given to the judge). Code still checks everything again, against the data. */
export function jsonSchema() {
  const str = max => ({ type: 'string', maxLength: max });
  const fieldEnum = { type: 'string', enum: allFields() };
  const filter = { type: 'object', additionalProperties: false, required: ['field', 'op'], properties: { field: fieldEnum, op: { type: 'string', enum: Object.keys(OPS) }, value: str(LIMITS.value) } };
  const source = { type: 'string', enum: Object.keys(SOURCES) };
  return {
    type: 'object', additionalProperties: false, required: ['title', 'sections'],
    properties: {
      title: str(LIMITS.title), intro: str(LIMITS.intro),
      sections: { type: 'array', minItems: 1, maxItems: LIMITS.sections, items: {
        type: 'object', additionalProperties: false, required: ['layout', 'title'],
        properties: {
          layout: { type: 'string', enum: Object.keys(LAYOUTS) }, title: str(LIMITS.sectionTitle), source,
          filter: { type: 'array', maxItems: LIMITS.filters, items: filter },
          group: fieldEnum,
          sort: { type: 'object', additionalProperties: false, required: ['field'], properties: { field: fieldEnum, direction: { type: 'string', enum: ['asc', 'desc'] } } },
          limit: { type: 'integer', minimum: 1, maximum: LIMITS.maxRows },
          fields: { type: 'array', maxItems: LIMITS.fields, items: fieldEnum },
          note: str(LIMITS.note),
          figures: { type: 'array', maxItems: LIMITS.figures, items: { type: 'object', additionalProperties: false, required: ['label', 'source'],
            properties: { label: str(LIMITS.label), source, filter: { type: 'array', maxItems: LIMITS.filters, items: filter } } } },
        } } },
    },
  };
}

/** What the page needs to know to draw: layout names and the fields of each source (never any data). */
export function publicSchema() {
  return {
    layouts: Object.fromEntries(Object.entries(LAYOUTS).map(([id, l]) => [id, { label: l.label, help: l.help }])),
    sources: Object.fromEntries(Object.entries(SOURCES).map(([id, s]) => [id, { label: s.label, one: s.one, main: s.main,
      fields: Object.fromEntries(Object.entries(s.fields).map(([fid, f]) => [fid, { id: fid, ...f }])) }])),
    limits: LIMITS,
  };
}

// ---------------------------------------------------------------- checking
const KEYS = {
  top: ['title', 'intro', 'sections'],
  section: ['layout', 'title', 'source', 'filter', 'group', 'sort', 'limit', 'fields', 'note', 'figures'],
  filter: ['field', 'op', 'value'], sort: ['field', 'direction'], figure: ['label', 'source', 'filter'],
};
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
// control characters other than a new line or tab are never text
const CONTROL = /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f\u2028\u2029]/;
const DATE_VALUE = /^(\d{4}-\d{2}-\d{2}|today([+-]\d{1,4})?)$/;

/**
 * Check a specification. Returns { spec, problems }: `spec` is the cleaned copy (only when there are no problems), `problems` plain
 * sentences. `ctx.sources` lists the sources that have anything to draw from for this project (default: all of them).
 */
export function validateSpec(raw, ctx = {}) {
  const bad = [];
  const sourcesOk = new Set(ctx.sources || Object.keys(SOURCES));
  const unknownKeys = (o, allowed, where) => { for (const k of Object.keys(o)) if (!allowed.includes(k)) bad.push(`${where} has "${k}", which is not something a dashboard can hold.`); };
  const text = (v, max, where, { required = false } = {}) => {
    if (v === undefined || v === null) { if (required) bad.push(`${where} is missing.`); return ''; }
    if (typeof v !== 'string') { bad.push(`${where} must be text.`); return ''; }
    const t = v.replace(/\r\n?/g, '\n').trim();
    if (CONTROL.test(t)) bad.push(`${where} has characters that are not text.`);
    if (t.length > max) bad.push(`${where} is too long (${t.length} characters; the limit is ${max}).`);
    if (required && !t) bad.push(`${where} is empty.`);
    return t;
  };
  if (!isObj(raw)) return { spec: null, problems: ['The dashboard is not an object.'] };
  unknownKeys(raw, KEYS.top, 'The dashboard');
  const spec = { title: text(raw.title, LIMITS.title, 'The title', { required: true }), intro: text(raw.intro, LIMITS.intro, 'The introduction'), sections: [] };
  if (!Array.isArray(raw.sections) || !raw.sections.length) bad.push('The dashboard needs at least one section.');
  else if (raw.sections.length > LIMITS.sections) bad.push(`There are ${raw.sections.length} sections; the limit is ${LIMITS.sections}.`);

  const field = (name, source, where, want) => {
    const def = own(own(SOURCES, source)?.fields || {}, name);
    if (typeof name !== 'string' || !def) { bad.push(`${where}: "${String(name).slice(0, 40)}" is not a field of ${own(SOURCES, source)?.label || 'that source'}.`); return null; }
    if (want && def.type !== want) { bad.push(`${where}: "${name}" is not a ${want} field.`); return null; }
    return def;
  };
  const filters = (list, source, where) => {
    if (list === undefined) return [];
    if (!Array.isArray(list)) { bad.push(`${where}: the filter must be a list.`); return []; }
    if (list.length > LIMITS.filters) bad.push(`${where}: too many filters (the limit is ${LIMITS.filters}).`);
    const out = [];
    list.slice(0, LIMITS.filters).forEach((f, i) => {
      const w = `${where}, filter ${i + 1}`;
      if (!isObj(f)) return bad.push(`${w} is not an object.`);
      unknownKeys(f, KEYS.filter, w);
      const def = field(f.field, source, w);
      const ops = own(OPS, f.op);
      if (!ops) return bad.push(`${w}: "${String(f.op).slice(0, 30)}" is not a test Jade knows.`);
      if (!def) return;
      if (!ops.includes(def.type)) return bad.push(`${w}: "${f.op}" cannot be used on ${def.label}.`);
      let value = '';
      if (!NO_VALUE.has(f.op)) {
        value = text(f.value, LIMITS.value, `${w} value`, { required: true });
        if (def.type === 'choice' && value && !def.options.includes(value)) bad.push(`${w}: ${def.label} can only be ${def.options.join(' or ')}.`);
        if (def.type === 'flag' && value && !['yes', 'no'].includes(value)) bad.push(`${w}: ${def.label} can only be yes or no.`);
        if (def.type === 'number' && value && !/^-?\d{1,9}(\.\d+)?$/.test(value)) bad.push(`${w}: ${def.label} needs a number.`);
        if (def.type === 'date' && value && !DATE_VALUE.test(value)) bad.push(`${w}: ${def.label} needs a date such as 2026-11-30, or "today", "today+14".`);
      }
      out.push(NO_VALUE.has(f.op) ? { field: f.field, op: f.op } : { field: f.field, op: f.op, value });
    });
    return out;
  };
  const sourceOf = (name, where, layout) => {
    if (!own(SOURCES, name)) { bad.push(`${where}: "${String(name).slice(0, 40)}" is not a source Jade has (${Object.keys(SOURCES).join(', ')}).`); return ''; }
    if (layout?.sources && !layout.sources.includes(name)) { bad.push(`${where}: this layout can only draw from ${layout.sources.join(' or ')}.`); return ''; }
    if (!sourcesOk.has(name)) { bad.push(`${where}: this project has nothing for ${own(SOURCES, name).label} to show (${name === 'claudesetup' ? 'no project folder is linked' : 'no data'}).`); return ''; }
    return name;
  };

  (Array.isArray(raw.sections) ? raw.sections.slice(0, LIMITS.sections) : []).forEach((s, i) => {
    const where = `Section ${i + 1}`;
    if (!isObj(s)) return bad.push(`${where} is not an object.`);
    unknownKeys(s, KEYS.section, where);
    const layout = own(LAYOUTS, s.layout);
    if (!layout) return bad.push(`${where}: "${String(s.layout).slice(0, 40)}" is not a layout Jade can draw (${Object.keys(LAYOUTS).join(', ')}).`);
    const out = { layout: s.layout, title: text(s.title, LIMITS.sectionTitle, `${where} title`, { required: true }) };
    const uses = o => layout.uses.includes(o);
    if (uses('source')) {
      const given = s.source === undefined && layout.sources?.length === 1 ? layout.sources[0] : s.source;
      const src = sourceOf(given, where, layout);
      if (src) out.source = src;
      if (src) {
        out.filter = filters(s.filter, src, where);
        if (uses('fields') && s.fields !== undefined) {
          if (!Array.isArray(s.fields) || s.fields.length > LIMITS.fields) bad.push(`${where}: fields must be a list of at most ${LIMITS.fields}.`);
          else {
            out.fields = [];
            for (const f of s.fields) if (field(f, src, where) && !out.fields.includes(f)) out.fields.push(f);
          }
        }
        if (layout.need.includes('fields') && !(out.fields || []).length) bad.push(`${where}: choose which fields to show.`);
        if (uses('group')) {
          if (s.group === undefined) { if (layout.need.includes('group')) bad.push(`${where}: choose a field to group by.`); }
          else if (field(s.group, src, where, layout.groupType)) out.group = s.group;
        }
        if (uses('sort') && s.sort !== undefined) {
          if (!isObj(s.sort)) bad.push(`${where}: sort must be an object.`);
          else {
            unknownKeys(s.sort, KEYS.sort, `${where} sort`);
            if (s.sort.direction !== undefined && !['asc', 'desc'].includes(s.sort.direction)) bad.push(`${where}: sort direction must be asc or desc.`);
            if (field(s.sort.field, src, `${where} sort`)) out.sort = { field: s.sort.field, direction: s.sort.direction === 'desc' ? 'desc' : 'asc' };
          }
        }
      }
    }
    if (uses('limit') && s.limit !== undefined) {
      if (!Number.isInteger(s.limit) || s.limit < 1 || s.limit > LIMITS.maxRows) bad.push(`${where}: the limit must be a whole number from 1 to ${LIMITS.maxRows}.`);
      else out.limit = s.limit;
    }
    if (uses('figures')) {
      if (!Array.isArray(s.figures) || !s.figures.length) bad.push(`${where}: add at least one headline number.`);
      else if (s.figures.length > LIMITS.figures) bad.push(`${where}: too many headline numbers (the limit is ${LIMITS.figures}).`);
      else {
        out.figures = [];
        s.figures.forEach((f, j) => {
          const w = `${where}, number ${j + 1}`;
          if (!isObj(f)) return bad.push(`${w} is not an object.`);
          unknownKeys(f, KEYS.figure, w);
          const src = sourceOf(f.source, w);
          const label = text(f.label, LIMITS.label, `${w} label`, { required: true });
          if (src) out.figures.push({ label, source: src, filter: filters(f.filter, src, w) });
        });
      }
    }
    // the model's own words: any layout may carry a short note; the text layout is made of it
    const note = text(s.note, LIMITS.note, `${where} note`, { required: layout.need.includes('note') });
    if (note) out.note = note;
    spec.sections.push(out);
  });
  return bad.length ? { spec: null, problems: bad } : { spec, problems: [] };
}
