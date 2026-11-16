// Voice: wake word, push-to-talk and spoken replies — all free and in the browser.
//  • Web Speech API in browsers that ship a speech service (Google Chrome, Microsoft Edge, Safari).
//  • Vosk (offline, on-device) everywhere else: Chromium, Brave, Firefox, and as a fallback. The 40 MB model is
//    downloaded once by the Jade server. Vosk runs two recognizers on the same microphone: a tiny grammar-limited one
//    that only listens for the wake phrase (accurate, cheap), and a full one used for the request that follows.
import { toast, icon, esc } from './ui.js';

const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
const VOSK_JS = 'https://cdn.jsdelivr.net/npm/vosk-browser@0.0.8/dist/vosk.js';
const modelPath = () => '/api/voice/model.tar.gz?size=small';
// How sure the recogniser must be before a word counts toward the wake phrase (Settings → Voice → Sensitivity).
const wakeConf = () => ({ relaxed: .55, normal: .7, strict: .85 }[cfg.voice?.sensitivity] ?? .7);
const NAME_ALIKE = { jade: ['jade', 'jayde', 'jaid', 'jada', 'jayed'] };
// Microphone level 0..1 for the meter in Settings; also sent as a 'jade:level' event.
export let level = 0;
// localStorage['jade-voice-debug'] = '1' logs what each recogniser hears.
const debug = (...a) => { try { if (localStorage.getItem('jade-voice-debug')) console.debug('[voice]', ...a); } catch {} };
// What the recogniser heard recently (shown in Settings → Voice, so you can see why Jade did or didn't wake).
const heardLog = [];
export const lastHeard = () => heardLog.slice();

let cfg = { wakeWord: 'hey jade', voice: {} }, moduleOn = false, hooks = {};
let mode = 'off';          // off | wake | command | busy
let engine = null;         // 'webspeech' | 'vosk'
let rec = null, vosk = null, commandTimer = null, speaking = false, lastError = '', starting = false;
let provisional = false;   // woken by a partial result, waiting for the final one to confirm

export function status() {
  return { webspeech: !!SR && hasSpeechService(), vosk: typeof WebAssembly === 'object' && !!navigator.mediaDevices, engine, mode, error: lastError, wake: !!cfg.voice?.wake, micDenied, level };
}
let micDenied = false;
/** After the user allows the microphone (a click), try again. */
export function retry() { lastError = ''; micDenied = false; stopAll(); if (moduleOn && cfg.voice?.wake) startWake(); }
/** The microphones this computer has (names appear once the mic has been allowed). */
export async function microphones() {
  try { return (await navigator.mediaDevices.enumerateDevices()).filter(d => d.kind === 'audioinput').map(d => ({ id: d.deviceId, label: d.label || 'Microphone' })); } catch { return []; }
}

/** Chromium-based browsers expose SpeechRecognition but only Chrome and Edge have a server behind it. */
function hasSpeechService() {
  if (!SR) return false;
  const brands = navigator.userAgentData?.brands?.map(b => b.brand) || [];
  if (brands.length) return brands.some(b => /Google Chrome|Microsoft Edge/.test(b));
  return /Safari/.test(navigator.userAgent) && !/Chrome|Chromium/.test(navigator.userAgent);
}

export function configure(config, on, h) {
  const key = c => `${c.voice?.wake}|${c.voice?.engine}|${c.voice?.deviceId}|${c.wakeWord}`;
  const was = key(cfg) + moduleOn;
  cfg = config; moduleOn = on; hooks = h;
  if (!listenersOn) {
    listenersOn = true;
    // Listening for the wake word is Jade's resting state. The window you are using should be the one listening, so a
    // window that comes to the front takes over from any other Jade window.
    const claim = () => { if (document.visibilityState === 'visible' && moduleOn && cfg.voice?.wake && !rec && !vosk && !starting && !micDenied) startWake(); };
    window.addEventListener('focus', claim);
    document.addEventListener('visibilitychange', claim);
  }
  if (was === key(cfg) + moduleOn) return;
  stopAll();
  if (moduleOn && cfg.voice?.wake) startWake();
  paint();
}
let listenersOn = false;

// ------------------------------------------------------------ the wake phrase
const norm = s => String(s || '').toLowerCase().replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
const wakeWords = () => norm(cfg.wakeWord || 'hey jade').split(' ');
// For the early wake on a partial result: the whole phrase, exactly ("hey jade"), unlike the forgiving final-result match.
const partialWakeRe = () => new RegExp('\\b' + wakeWords().join('\\s+') + '\\b');
function wakeRe() {
  const name = wakeWords().at(-1);
  const alts = name === 'jade' ? '(?:jade|jayde|jaid|jada|j8|shade|jayed)' : name;
  return new RegExp(`(?:^|\\s)(?:hey|hi|ok|okay|a|hay|yo)?\\s*${alts}\\b[\\s,]*(.*)$`, 'i');
}
/** Index just past the wake phrase in a recognised word list (with confidences), or -1. */
function findWake(words) {
  const want = wakeWords();
  const name = want.at(-1);
  const conf = wakeConf(), relaxed = cfg.voice?.sensitivity === 'relaxed';
  const names = relaxed ? (NAME_ALIKE[name] || [name]) : [name];
  for (let i = 0; i < words.length; i++) {
    if (!names.includes(words[i].w) || words[i].c < conf) continue;
    if (want.length === 1) return i + 1;
    const prev = words[i - 1];
    if (prev && ['hey', 'hi', 'ok', 'okay', 'a', 'hay', want[0]].includes(prev.w) && prev.c >= conf - .15) return i + 1;
    // relaxed: the name alone, clearly heard at the start of what you said, is enough ("Jade, what's due?")
    if (relaxed && i === 0 && words[i].c >= .85) return i + 1;
  }
  return -1;
}
function afterWake(text) {
  const m = wakeRe().exec(norm(text));
  return m ? { rest: m[1].trim() } : null;
}

// ------------------------------------------------------------ overlay
// The app shows the wake-up HUD (Jade's core in the middle of the screen) from these events.
let heard = '';
function showOverlay(text, hint = 'Listening…') {
  heard = text || '';
  window.dispatchEvent(new CustomEvent('jade:hear', { detail: { text: heard || '…', hint } }));
}
function hideOverlay(delay = 0) { window.dispatchEvent(new CustomEvent('jade:hear-end', { detail: { delay } })); }

function paint() {
  const mic = document.getElementById('mic');
  if (mic) {
    mic.classList.toggle('armed', mode === 'wake');
    mic.classList.toggle('live', mode === 'command');
    mic.title = mode === 'wake' ? `Listening for “${cfg.wakeWord}” — click to talk now` : 'Talk to Jade';
    mic.style.display = moduleOn ? '' : 'none';
  }
  document.querySelectorAll('.orb').forEach(o => o.classList.toggle('listening', mode === 'command'));
  window.dispatchEvent(new Event('jade:voice'));
}
export const isSpeaking = () => speaking;

function enterCommand(initial = '') {
  mode = 'command';
  paint();
  showOverlay(initial, 'Go ahead…');
  clearTimeout(commandTimer);
  commandTimer = setTimeout(() => { if (mode === 'command') { hideOverlay(); backToWake(); } }, 9000);
}

function deliver(text) {
  clearTimeout(commandTimer);
  text = String(text || '').trim();
  if (!text) { hideOverlay(); return backToWake(); }
  showOverlay(text, 'On it');
  hideOverlay(1400);
  mode = 'busy'; paint();
  hooks.onCommand?.(text);
  setTimeout(() => { if (mode === 'busy') backToWake(); }, 1500);
}

function backToWake() {
  mode = cfg.voice?.wake && moduleOn && (rec || vosk) ? 'wake' : 'off';
  if (mode === 'off') stopAll();
  paint();
}

// Every final utterance from either engine lands here.
function onFinal(text, source = 'full') {
  if (speaking) return;
  if (mode === 'command') { if (source === 'full') deliver(text); return; }
  if (mode === 'wake') {
    const w = afterWake(text);
    if (!w) return;
    if (w.rest.split(' ').filter(Boolean).length >= 2) deliver(w.rest); else enterCommand();
  }
}
function onPartial(text) {
  if (mode === 'command') showOverlay(text, 'Listening…');
}

// ------------------------------------------------------------ engines
function useVosk() {
  const pref = cfg.voice?.engine;
  if (pref === 'vosk') return true;
  if (pref === 'webspeech') return false;
  return !hasSpeechService();
}

// Only one Jade window may listen at a time, or every open window would hear you and send the request.
// The Web Locks API hands the microphone to the next window when the listening one closes.
let releaseLock = null;
async function startWake() {
  lastError = '';
  if (navigator.locks && !releaseLock) {
    // Take the microphone from any other Jade window; when another window takes it from us, we stop.
    navigator.locks.request('jade-voice', { steal: true }, () => new Promise(r => { releaseLock = r; }))
      .catch(() => { releaseLock = null; if (rec || vosk) { stopAll(); lastError = 'Another Jade window is listening'; paint(); } });
  }
  if (useVosk()) return startVosk();
  startWebSpeech();
}

function startWebSpeech() {
  engine = 'webspeech';
  rec = new SR();
  rec.continuous = true; rec.interimResults = true; rec.lang = navigator.language || 'en-US';
  rec.onresult = e => {
    for (let i = e.resultIndex; i < e.results.length; i++) {
      const t = e.results[i][0].transcript;
      if (e.results[i].isFinal) onFinal(t); else if (mode === 'wake' && afterWake(t)?.rest === '') enterCommand(); else onPartial(t);
    }
  };
  rec.onerror = e => {
    if (e.error === 'no-speech' || e.error === 'aborted') return;
    lastError = `Speech recognition: ${e.error}`;
    if (['network', 'service-not-allowed', 'language-not-supported'].includes(e.error) && cfg.voice?.engine !== 'webspeech') {
      rec.onend = null; try { rec.abort(); } catch {} rec = null;
      toast('Browser speech service unavailable, switching to offline voice', 'info', 4500);
      return startVosk();
    }
    if (e.error === 'not-allowed') { toast('Microphone permission was denied', 'error'); rec.onend = null; rec = null; mode = 'off'; paint(); }
  };
  rec.onend = () => { if (rec && mode !== 'off') setTimeout(() => { try { rec?.start(); } catch {} }, 250); };
  try { rec.start(); mode = 'wake'; paint(); } catch (e) { lastError = e.message; }
}

function loadScript(src) {
  return new Promise((res, rej) => {
    if (window.Vosk) return res();
    const s = document.createElement('script'); s.src = src; s.onload = res; s.onerror = () => rej(new Error('Could not load the Vosk script'));
    document.head.appendChild(s);
  });
}

async function startVosk() {
  if (starting || vosk) return;
  starting = true;
  engine = 'vosk';
  try {
    const want = 'small';
    const st = await hooks.api('GET', '/api/voice/model-status');
    if (!st[want]?.ready) {
      toast(`Downloading the ${want} offline voice model (about ${st[want]?.mb || 40} MB, once)…`, 'info', 8000);
      await hooks.api('POST', '/api/voice/model', { size: want });
      toast('Offline voice ready', 'success', 2500);
    }
    await loadScript(VOSK_JS);
    // The model loads inside a Web Worker, which can't resolve relative URLs: pass an absolute one.
    const model = await window.Vosk.createModel(new URL(modelPath(), location.origin).href);
    const audio = { echoCancellation: true, noiseSuppression: true, autoGainControl: true, channelCount: 1 };
    if (cfg.voice?.deviceId) audio.deviceId = { exact: cfg.voice.deviceId };
    let stream;
    try { stream = await navigator.mediaDevices.getUserMedia({ audio }); }
    catch (e) { if (e.name === 'OverconstrainedError' || e.name === 'NotFoundError') { delete audio.deviceId; stream = await navigator.mediaDevices.getUserMedia({ audio }); } else throw e; }
    const ctx = new AudioContext();
    const rate = ctx.sampleRate;
    // One recogniser listens continuously; nothing is switched or cut mid-sentence, so nothing is lost.
    // The wake phrase only counts in a finished utterance, as consecutive words ("hey jade"), each heard with high
    // confidence. Background chatter rarely produces that exact pair confidently.
    const listen = new model.KaldiRecognizer(rate);
    listen.setWords(true);
    listen.on('result', m => {
      const res = m.result || {};
      const words = (res.result || []).map(w => ({ w: norm(w.word), c: w.conf ?? 0 }));
      debug('heard', JSON.stringify(res.text), words.map(x => `${x.w}:${x.c.toFixed(2)}`).join(' '), 'mode', mode);
      if (res.text) { heardLog.unshift({ at: Date.now(), text: res.text, words: words.map(x => `${x.w}:${x.c.toFixed(2)}`).join(' '), mode, woke: mode === 'wake' && findWake(words) >= 0 }); heardLog.length = Math.min(heardLog.length, 12); }
      if (!res.text || speaking) return;
      if (mode === 'command') {
        if (!provisional) return deliver(res.text);
        // Woken early by a partial result: the finished utterance now confirms (or not) the wake phrase.
        provisional = false;
        const at = findWake(words);
        if (at < 0) { hideOverlay(); return backToWake(); }
        const rest = words.slice(at).map(x => x.w).join(' ');
        return rest.split(' ').filter(Boolean).length >= 2 ? deliver(rest) : enterCommand();
      }
      if (mode !== 'wake') return;
      const at = findWake(words);
      if (at < 0) return;
      const rest = words.slice(at).map(x => x.w).join(' ');
      if (rest.split(' ').filter(Boolean).length >= 2) deliver(rest);   // "hey jade, what's due this week"
      else enterCommand();                                                // "hey jade" … then the request
    });
    listen.on('partialresult', m => {
      const t = m.result?.partial || '';
      if (mode === 'command' && t) onPartial(t);
      // Wake as soon as the phrase shows up in a partial result (about a second before the utterance is final);
      // the final result then confirms it with word confidences, or quietly goes back to sleep.
      else if (mode === 'wake' && partialWakeRe().test(norm(t))) { provisional = true; enterCommand(); }
    });
    const src = ctx.createMediaStreamSource(stream);
    const node = ctx.createScriptProcessor(4096, 1, 1);
    let lvlN = 0;
    node.onaudioprocess = e => {
      if (!vosk || mode === 'off') return;
      const d = e.inputBuffer.getChannelData(0);
      let sum = 0; for (let i = 0; i < d.length; i += 8) sum += d[i] * d[i];
      level = level * .6 + Math.min(1, Math.sqrt(sum / (d.length / 8)) * 6) * .4;
      if (++lvlN % 2 === 0) window.dispatchEvent(new CustomEvent('jade:level', { detail: level }));
      try { listen.acceptWaveform(e.inputBuffer); } catch {}
    };
    src.connect(node); node.connect(ctx.destination);
    // Browsers start audio suspended until the page is interacted with.
    const resume = () => { if (ctx.state === 'suspended') ctx.resume(); };
    resume();
    for (const ev of ['pointerdown', 'keydown']) document.addEventListener(ev, resume, { once: true });
    vosk = { model, stream, ctx, node, listen };
    mode = 'wake'; paint();
  } catch (e) {
    lastError = e.message;
    mode = 'off'; paint();
    if (e.name === 'NotAllowedError' || /permission/i.test(e.message)) {
      micDenied = true; lastError = 'Microphone blocked';
      toast('The microphone is blocked. Allow it for this site, then click the mic in the menu bar.', 'error', 8000);
    } else toast('Offline voice failed: ' + e.message, 'error', 6000);
    paint();
  } finally { starting = false; }
}

function stopAll() {
  clearTimeout(commandTimer);
  if (rec) { rec.onend = null; try { rec.abort(); } catch {} rec = null; }
  if (vosk) {
    try { vosk.node.disconnect(); vosk.stream.getTracks().forEach(t => t.stop()); vosk.ctx.close(); vosk.listen.remove(); vosk.model.terminate(); } catch {}
    vosk = null;
  }
  engine = null; mode = 'off'; hideOverlay(); paint();
  if (releaseLock) { releaseLock(); releaseLock = null; }
}

/** Click the mic: talk now, wake word or not. */
export async function pushToTalk() {
  if (mode === 'command') { deliver(heard); return; }
  if (rec || vosk) { vosk?.ctx.resume(); return enterCommand(); }
  if (useVosk()) {
    await startVosk();
    if (vosk) enterCommand();
    return;
  }
  const one = new SR();
  one.lang = navigator.language || 'en-US'; one.interimResults = true; one.continuous = false;
  mode = 'command'; paint(); showOverlay('', 'Go ahead…');
  let finalText = '';
  one.onresult = e => {
    let t = '';
    for (let i = 0; i < e.results.length; i++) { t += e.results[i][0].transcript; if (e.results[i].isFinal) finalText = t; }
    showOverlay(t, 'Listening…');
  };
  one.onerror = e => {
    hideOverlay(); mode = 'off'; paint();
    if (e.error === 'network') { toast('Browser speech service unavailable, using offline voice', 'info'); cfg = { ...cfg, voice: { ...cfg.voice, engine: 'vosk' } }; pushToTalk(); }
    else if (e.error !== 'no-speech' && e.error !== 'aborted') toast('Speech: ' + e.error, 'error');
  };
  one.onend = () => { if (mode === 'command') { mode = 'off'; deliver(finalText); paint(); } };
  one.start();
}

/** Esc: stop whatever voice is doing right now. Returns 'speaking' | 'listening' | '' (nothing was going on). */
export function cancel() {
  if (speaking && window.speechSynthesis) { speechSynthesis.cancel(); speaking = false; window.dispatchEvent(new Event('jade:voice')); return 'speaking'; }
  if (mode === 'command' || mode === 'busy') { clearTimeout(commandTimer); provisional = false; hideOverlay(); backToWake(); return 'listening'; }
  return '';
}

export function setBusy(b) {
  if (b) return;
  if (mode === 'busy') backToWake();
}

export function speak(text) {
  if (!cfg.voice?.speak || !window.speechSynthesis) return;
  speechSynthesis.cancel();
  const u = new SpeechSynthesisUtterance(String(text).slice(0, 700));
  u.lang = navigator.language || 'en-US'; u.rate = 1.03;
  const pref = speechSynthesis.getVoices().find(v => /natural|neural|samantha|google uk english female|aria|jenny/i.test(v.name) && v.lang.startsWith((navigator.language || 'en').slice(0, 2)));
  if (pref) u.voice = pref;
  speaking = true;
  window.dispatchEvent(new Event('jade:voice'));
  u.onend = u.onerror = () => { speaking = false; window.dispatchEvent(new Event('jade:voice')); };
  speechSynthesis.speak(u);
}

/** Test hook: feed recognised text as if it had been heard (used by the voice self-test). */
