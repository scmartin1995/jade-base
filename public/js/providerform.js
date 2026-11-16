// The "How Claude Code reaches Claude" form, shared by Settings -> Engine and first-run set-up. It sends to the server exactly
// what Settings always has: POST /api/engine/provider with { style, models: {...}, ...one key per field }.
import { esc, icon, modal, copy, toast } from './ui.js';

export const STYLE_BOXES = (prov, e) => `
          <div class="grid g2" style="gap:10px">
            <label class="mod-row choice ${prov.style === 'plan' ? '' : 'off'}" data-style="plan"><input type="radio" name="prov-style" value="plan" ${prov.style === 'plan' ? 'checked' : ''}><div class="grow"><div class="title" style="font-weight:500;color:var(--fg-bright)">My Claude plan</div><div class="tiny muted">${e.claude.installed ? (e.claude.loggedIn === false ? 'Not signed in: run <code>claude auth login</code> in a terminal.' : 'Signed in through Claude Code. Nothing to enter.') : 'Install Claude Code first.'}</div></div></label>
            <label class="mod-row choice ${prov.style === 'gateway' ? '' : 'off'}" data-style="gateway"><input type="radio" name="prov-style" value="gateway" ${prov.style === 'gateway' ? 'checked' : ''}><div class="grow"><div class="title" style="font-weight:500;color:var(--fg-bright)">Company gateway or Amazon Bedrock</div><div class="tiny muted">${prov.style === 'gateway' ? esc(prov.label) + (prov.baseUrl ? ' · ' + esc(prov.baseUrl) : '') + (prov.hasKey ? ' · key ' + esc(prov.keyHint) : '') : 'For work: an address and a key from your gateway team.'}</div></div></label>
          </div>
`;

export const PROVIDER_FIELDS = (prov) => `
          <div class="form" data-prov-fields ${prov.style === 'plan' ? 'hidden' : ''} style="margin-top:14px">
            <div class="row wrap" style="gap:8px;margin-bottom:4px"><button type="button" class="btn sm" data-import-claude>${icon('download', 13)}Use my Claude Code settings</button><span class="tiny muted">takes over what <code>~/.claude/settings.json</code> or the Claude desktop app's gateway set-up already has (read only, shown first)</span></div>
            <label class="field">Address <small>blank with an Amazon Bedrock API key = Bedrock itself</small><input data-prov="baseUrl" value="${esc(prov.baseUrl || '')}" placeholder="https://llm-gateway.example.com" autocomplete="off"></label>
            <div class="two"><label class="field">Key <small>${prov.hasKey ? 'saved · leave blank to keep it' : 'kept in engine.env, never in config.json'}</small><input type="password" data-prov="key" placeholder="${prov.hasKey ? '•••••••• ' + esc(prov.keyHint) : ''}" autocomplete="new-password"></label>
            <label class="field">The key you were given is<select data-prov="keyKind">${[['token', 'A token for the gateway (bearer)'], ['x-api-key', 'An API key (x-api-key header)'], ['bedrock-key', 'An Amazon Bedrock API key']].map(([v, l]) => `<option value="${v}" ${prov.keyKind === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label></div>
            <div class="two"><label class="field">The gateway speaks<select data-prov="format"><option value="anthropic" ${prov.format !== 'bedrock' ? 'selected' : ''}>Anthropic format (most gateways)</option><option value="bedrock" ${prov.format === 'bedrock' ? 'selected' : ''}>Amazon Bedrock format</option></select></label>
            <label class="field">AWS region <small>only if you were given one</small><input data-prov="region" value="${esc(prov.region || '')}" placeholder="us-east-1"></label></div>
            <details ${prov.models?.standard || prov.models?.light || prov.models?.strong ? 'open' : ''}><summary class="tiny muted" style="cursor:pointer">Model names (optional: Jade reads them from the endpoint; type them only if it lists none)</summary>
            <div class="three" style="margin-top:8px"><label class="field">Everyday model<input data-prov="models.standard" value="${esc(prov.models?.standard || '')}" placeholder="from the endpoint"></label><label class="field">Quick model<input data-prov="models.light" value="${esc(prov.models?.light || '')}" placeholder="from the endpoint"></label><label class="field">Strong model<input data-prov="models.strong" value="${esc(prov.models?.strong || '')}" placeholder="from the endpoint"></label></div>
            <div class="tiny muted" style="margin:-4px 0 6px">After Check, Jade asks the endpoint what it serves (inference profiles or its model list) and maps the chat's quick, everyday and strong choices to the newest of each it finds; a tier it doesn't find uses the everyday model. These boxes override that, for a gateway that lists nothing (on Bedrock names are long, with the provider in front, or an inference-profile ARN).</div></details>
            <details ${prov.headers || prov.disableBetas || prov.certFile ? 'open' : ''}><summary class="tiny muted" style="cursor:pointer">Advanced: extra headers, certificate, rejected requests</summary>
              <div class="two" style="margin-top:8px"><label class="field">Extra headers <small>Name: Value, one per line, only if asked for</small><textarea data-prov="headers" rows="1">${esc(prov.headers || '')}</textarea></label>
              <label class="field">Certificate file <small>for company networks (NODE_EXTRA_CA_CERTS)</small><input data-prov="certFile" value="${esc(prov.certFile || '')}" placeholder="/path/to/company-root.pem"></label></div>
              <label class="row small" style="gap:8px;cursor:pointer"><input type="checkbox" data-prov="disableBetas" ${prov.disableBetas ? 'checked' : ''}> My gateway rejects some requests (“Extra inputs are not permitted”)</label>
            </details>
          </div>
`;

/** Wire the style cards and read the fields. Returns { style(), data() }; onStyle(style) runs when the choice changes. */
export function wireProviderForm(root, prov, onStyle = () => {}) {
  let style = prov.style || 'plan';
  root.querySelectorAll('input[name="prov-style"]').forEach(r => r.onchange = () => {
    style = r.value;
    root.querySelectorAll('.choice[data-style]').forEach(x => x.classList.toggle('off', x.dataset.style !== style));
    const f = root.querySelector('[data-prov-fields]'); if (f) f.hidden = style === 'plan';
    onStyle(style);
  });
  return {
    style: () => style,
    data() {
      const data = { style, models: {} };
      root.querySelectorAll('[data-prov]').forEach(el => { const k = el.dataset.prov; const v = el.type === 'checkbox' ? el.checked : el.value; if (k.startsWith('models.')) data.models[k.slice(7)] = v; else data[k] = v; });
      return data;
    },
  };
}

/** "Use my Claude Code settings": shows what was found, then takes it over. Resolves true when it was imported. */
export async function importClaudeSettings(api) {
  let r; try { r = await api('GET', '/api/engine/provider/import'); } catch (err) { toast(err.message, 'error', 7000); return false; }
  if (!r.ok) { toast(r.error, 'error', 9000); return false; }
  const f = r.found;
  const ok = await modal({ title: 'Found in your Claude Code settings', body: `<ul class="small" style="margin:0 0 8px 18px;color:var(--fg-soft)">
      <li>Address: <span class="mono">${esc(f.baseUrl || '(none: Anthropic directly)')}</span> · ${f.format === 'bedrock' ? 'Amazon Bedrock format' : 'Anthropic format'}</li>
      <li>Key: ${f.hasKey ? `found, sent as ${f.keyKind === 'x-api-key' ? 'an x-api-key header' : f.keyKind === 'bedrock-key' ? 'a Bedrock API key' : 'a bearer token'} (${esc(f.keyHint)})` : 'none found'}</li>
      ${f.region ? `<li>AWS region: ${esc(f.region)}</li>` : ''}${f.headers ? `<li>Extra headers: ${esc(f.headers.split('\n').map(h => h.split(':')[0]).join(', '))}</li>` : ''}
      ${f.models.light || f.models.standard || f.models.strong ? `<li>Models: ${esc([f.models.light && 'quick ' + f.models.light, f.models.standard && 'everyday ' + f.models.standard, f.models.strong && 'strong ' + f.models.strong].filter(Boolean).join(' · '))}</li>` : ''}
      ${f.disableBetas || f.certFile ? `<li>Switches: ${esc([f.disableBetas && 'rejects some requests', f.certFile && 'certificate ' + f.certFile].filter(Boolean).join(', '))}</li>` : ''}</ul>
      ${r.notes.map(n => `<div class="tiny" style="color:var(--warn);margin-top:4px">${esc(n)}</div>`).join('')}`,
    actions: [{ label: 'Cancel', kind: 'ghost', value: false }, { label: 'Use these and check', kind: 'primary', icon: 'check', value: true }] });
  if (!ok) return false;
  try { await api('POST', '/api/engine/provider/import'); return true; } catch (err) { toast(err.message, 'error', 8000); return false; }
}

/** The Diagnose report in a box with a Copy button. */
export async function showDiagnose(api) {
  const r = await api('POST', '/api/engine/diagnose');
  await modal({ title: 'Engine diagnosis', wide: true, body: `<p class="small dim" style="margin-top:0">What the engine reports, with keys masked. Copy and paste this into a chat with whoever is helping you.</p><pre class="output" style="white-space:pre-wrap;max-height:60vh;overflow:auto;font-size:12px">${esc(r.report)}</pre>`,
    actions: [{ label: 'Copy', kind: 'primary', icon: 'copy', onClick: () => { copy(r.report); toast('Copied', 'success', 1200); return false; } }, { label: 'Close', kind: 'ghost', value: null }] });
}
