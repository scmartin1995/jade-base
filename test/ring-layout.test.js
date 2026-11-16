// The part of the file ring that is plain data (no drawing): how a list of files becomes groups, areas and dots.
// The drawing itself is not tested here (it needs a browser).
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildGroups } from '../public/js/filering.js';

const DAY = 864e5, NOW = Date.UTC(2026, 10, 10);
const f = (group, area, days, extra = {}) => ({ file: `/v/${group}/${area}/${days}-${Math.random()}`, title: 't', group, area, project: 'p', mtime: NOW - days * DAY, ...extra });

test('files become groups with areas, biggest first, and age is worked out', () => {
  const { groups, files } = buildGroups([f('A', 'x', 1), f('A', 'y', 30), f('A', 'y', 40), f('B', 'z', 0)], NOW);
  assert.deepEqual(groups.map(g => g.name), ['A', 'B']);
  assert.deepEqual(groups[0].areas.map(a => a.name), ['y', 'x']);
  assert.equal(files.length, 4);
  assert.equal(files.find(x => x.age === 0).isNew, true);
  assert.equal(files.find(x => x.age === 40).isNew, false);
});

test('past six groups the small ones share "Other"', () => {
  const list = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].flatMap((g, i) => Array.from({ length: 10 - i }, () => f(g, 'x', 3)));
  const { groups } = buildGroups(list, NOW);
  assert.equal(groups.length, 6);
  assert.equal(groups[5].name, 'Other');
  assert.equal(groups[5].files.length, 5 + 4);
});

test('an empty list is fine, and the loose marker and bundle size ride along on the dot', () => {
  assert.deepEqual(buildGroups([], NOW), { groups: [], files: [] });
  const { files } = buildGroups([f('A', 'x', 2, { loose: true, bundle: true, bundleFiles: 4 })], NOW);
  assert.equal(files[0].loose, true);
  assert.equal(files[0].bundleFiles, 4);
});
