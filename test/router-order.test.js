// A file that is registered again (api.js after a hot reload) keeps its place in the route order: the first route that matches still wins.
import { test } from 'node:test';
import assert from 'node:assert/strict';

const router = await import('../server/core/router.js');

test('registering an owner again puts its routes where they were, not at the end', () => {
  const a = router.scope('t:first'), b = router.scope('t:second');
  a('GET', '/t/:name', () => 'first');
  b('GET', '/t/special', () => 'second');
  assert.equal(router.match('GET', '/t/special', false).fn(), 'first', 'the earlier owner wins, as registered');
  // the first owner is registered again (a reload): it must still come first
  const again = router.scope('t:first');
  again('GET', '/t/:name', () => 'first again');
  assert.equal(router.match('GET', '/t/special', false).fn(), 'first again');
  // two routes of one owner stay in their order
  const c = router.scope('t:third');
  c('GET', '/u/one', () => 1); c('GET', '/u/:x', () => 2);
  const c2 = router.scope('t:third');
  c2('GET', '/u/one', () => 11); c2('GET', '/u/:x', () => 22);
  assert.equal(router.match('GET', '/u/one', false).fn(), 11);
  assert.equal(router.match('GET', '/u/two', false).fn(), 22);
});
