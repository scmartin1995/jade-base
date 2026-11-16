// Requests for web page files: a path that cannot be read, or that leads out of the public folder, gets a status and never throws
// (a throw in the request handler would end the whole server).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { staticTarget } from '../server/core/static.js';

const ROOT = path.resolve('/srv/app/public');

test('ordinary pages and scripts resolve inside the folder', () => {
  assert.equal(staticTarget('/js/app.js', ROOT).file, path.join(ROOT, 'js', 'app.js'));
  assert.equal(staticTarget('/', ROOT).file, path.join(ROOT, 'index.html'));
  assert.equal(staticTarget('/chat/abc', ROOT).file, path.join(ROOT, 'index.html'), 'a route with no extension is the page');
  assert.equal(staticTarget('/css/my%20file.css', ROOT).file, path.join(ROOT, 'css', 'my file.css'), 'a valid escape is decoded');
});

test('a broken percent escape is a 400, not a throw', () => {
  for (const bad of ['/%', '/%E0%A4%A', '/js/%zz.js', '/%C0%AF%']) assert.deepEqual(staticTarget(bad, ROOT), { status: 400 }, bad);
});

test('a NUL byte is a 400', () => {
  assert.deepEqual(staticTarget('/a%00b.js', ROOT), { status: 400 });
});

test('a path that leaves the folder is a 403, including into a sibling whose name starts the same way', () => {
  assert.deepEqual(staticTarget('/../secret.txt', ROOT), { status: 403 });
  assert.deepEqual(staticTarget('/..%2f..%2fetc%2fpasswd.txt', ROOT), { status: 403 });
  assert.deepEqual(staticTarget('/../public-x/secret.txt', ROOT), { status: 403 }, 'public-x sits beside public');
});

test('nothing in a long list of odd inputs throws', () => {
  for (const s of ['', '%', '%%', '/%2', '/\u0000', '/..', '/../', '/./.', '////', '/a/../../b.js', '/%2e%2e/%2e%2e/x.js', 'x', '/\ud800'])
    assert.doesNotThrow(() => staticTarget(s, ROOT), JSON.stringify(s));
});
