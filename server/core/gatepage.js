// The page anyone gets who asks for Jade's address without the key: plain words, no project data, no settings and no key.
// The box sends what was pasted to /?key=..., where the server checks it (server/index.js).
export const GATE_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="referrer" content="no-referrer">
<title>Jade</title>
<link rel="icon" href="/icon.svg" type="image/svg+xml">
<style>
  :root { color-scheme: dark; }
  html, body { margin: 0; height: 100%; }
  body { background: #090f0d; color: #C1C497; font: 16px/1.55 "Geist", ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, sans-serif; display: grid; place-items: center; padding: 24px; }
  main { max-width: 34rem; background: #0c1512; border: 1px solid rgba(193, 196, 151, .17); border-radius: 14px; padding: 28px 30px; }
  h1 { margin: 0 0 8px; font: 400 28px "Fraunces", "Iowan Old Style", Georgia, serif; color: #F7E8B2; }
  p { margin: 10px 0; }
  .dim { color: #81B8A8; }
  form { display: flex; gap: 8px; margin-top: 18px; flex-wrap: wrap; }
  input { flex: 1 1 14rem; background: #111c18; color: #F7E8B2; border: 1px solid rgba(193, 196, 151, .25); border-radius: 8px; padding: 9px 11px; font: 14px ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; }
  button { background: #509475; color: #090f0d; border: 0; border-radius: 8px; padding: 9px 18px; font-family: inherit; font-weight: 600; font-size: 15px; cursor: pointer; }
  input:focus-visible, button:focus-visible { outline: 2px solid #2DD5B7; outline-offset: 2px; }
</style>
</head>
<body>
<main>
  <h1>Jade is running</h1>
  <p>To open it, use the link Jade showed when it started. If you cannot find it, start Jade again from its shortcut: that opens it for you.</p>
  <p class="dim">The link ends in <code>?key=</code> followed by a long run of letters and numbers. You can also paste that key (or the whole link) here.</p>
  <form method="get" action="/" autocomplete="off">
    <input name="key" type="password" aria-label="Key from the Jade link" placeholder="Paste the key or the link here" required>
    <button type="submit">Open Jade</button>
  </form>
</main>
</body>
</html>
`;
