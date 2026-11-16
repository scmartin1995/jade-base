# Performance

How Jade keeps itself quick on a large project (tens of thousands of files, thousands of notes and actions, many long chats), the rules that hold, the numbers measured, and how to measure again. Back to the [architecture map](ARCHITECTURE.md). The reasons behind the three biggest choices are in `docs/adr/0015-index-built-in-the-background-in-slices.md`, `docs/adr/0016-one-file-per-chat-with-safe-migration.md` and `docs/adr/0017-remembered-lists-are-checked-against-the-disk.md`.

## The rules

1. **Nothing blocks the server.** No request may hold the server up for more than about 100 ms on the generated data (see "How to measure again"). Work that takes longer (reading many files, walking folders, building the search index, searching chats, putting folder watches in place) is cut into slices of about 10 to 15 ms (`server/core/slices.js`, `watchTree` in `server/core/util.js`, the build in `server/core/memory.js`) and gives way to other requests between slices. A caller that cannot wait uses the plain `scan()`; request handlers use `list()` and the `...Async` forms.
2. **Do it once, or remember it with a rule for when to forget.** Every remembered result has a stated rule for when it is thrown away, and is checked against the disk rather than a clock where the disk can say (ADR 0017).
3. **Everything remembered is bounded in size**, and dropped with the folder, project or chat it belongs to.
4. **A faster answer is the same answer.** Each remembered result has a test that compares it with a fresh full read after a file is added, changed, renamed and deleted.
5. **Lists a page shows are paged or capped, and the page asks for more.** A route that has no limit given answers what it always answered, so the bridge and old callers keep working.
6. **A write cannot lose data.** Notes, actions and chats are written to a temporary file and renamed into place.

## What is remembered, how it is bounded, when it is thrown away

| What | Where | Bound | Thrown away or refreshed when |
|---|---|---|---|
| Memory index (search over notes and documents) | `server/core/memory.js` | at most 8,000 files; at most 600,000 bytes read per file | built in the background after every start, then checked every `memory.reindexMinutes` (15); a file is read again only if its size or modified time changed; a saved file updates only itself; a file that leaves a folder is dropped |
| File map (every file by name) | `server/core/files.js` | at most 20,000 files per folder, 8 levels deep; one tree per reachable folder | a watcher marks the folder that changed and only that folder is read again. The list is never allowed to be staler than the plain check (a look at the disk about once a minute): when watching cannot be trusted (a watch could not be put in place, the limit was reached, a watched folder was deleted and made again) the file map falls back to that check. Dropped when the folder is no longer reachable |
| Folder watches | `watchShared` in `server/core/util.js` | at most 2,000 folders per tree; shared by the file map and the memory index | closed when the last user of a folder stops; put in place in short turns, and a part that missed changes before they were ready looks once at the folder |
| File ring (finished deliverables) | `server/core/outputs.js` | one entry per file | each file is classified once; the whole list is rebuilt only when the files, a correction or the rules change |
| Notes | `server/core/store.js` | 20,000 notes remembered, previews of 220 characters, up to 16 MB of text (past that, read on demand) | each file's size, modified time and file number are checked on use; changed files are read again |
| Actions | `server/core/store.js` | the lists of the files in use | same check per file as notes; a write re-checks the file just before writing |
| Chats | `server/core/store.js` | the list of chats (title, dates, count, last words) always; the 64 most recent chats or 24 MB, whichever comes first; 200 turns per chat | a save replaces that chat; least recently used dropped |
| Text a chat search compares with | `chatSearchText` in `server/core/store.js` | 32 MB in total | a save or removal of the chat discards it; least recently used dropped |
| Chat search | `server/core/search.js` | looks through the newest 300 chats; shows at most 6 | per search |
| Job events | `server/core/jobs.js` | a running job's event carries the new length, not the text | the page fetches the earlier text once when it opens mid-run |

## What is paged, and the caps

Every list route has a cap: the most rows it will answer in one go, whatever `limit` asks for. The caps live in `server/api.js` (`whole()` and the route lines). A list that can be longer than its cap tells the page how many there are in total, so the page can say "showing N of M" and ask for more, up to the total. The exact fields are in the route's own code and its test; the figures below are the caps at the time of writing.

| Route | Default | Cap | What else it takes |
|---|---|---|---|
| `/api/memory/files` | newest 2,000 with no `limit` (a plain list) | none in practice (1,000,000) | `limit`, `offset`; with `limit` it answers `{ files, total, offset, more, indexing }` |
| `/api/notes` | 200 | 500; none with `paged=1` | `offset`, `project`, `q`; a preview, never the note text; `paged=1` answers `{ items, total }` |
| `/api/chats` | 200 | 500; none with `paged=1` | `offset`, `q`; `paged=1` answers `{ items, total }` |
| `/api/chats/<id>` with `limit=N` | the whole chat without `limit`; 40 turns if `limit` is empty | 200 turns | answers the last N turns and the total |
| `/api/actions` | with no filter, every action (the bridge reads this) | 1,000 once any of `status`, `project`, `owner`, `q`, `limit` or `offset` is given; none with `paged=1` | the Home and Projects pages ask for open actions (`?status=open`); `paged=1` answers `{ items, total }` |
| `/api/files` | 50 | 200 | `q`, `project`, `kind`, `made` |
| `/api/search` | 20 | 60 | `q`, `kinds` |
| `/api/outputs` | 200 | 5,000 | `limit`, `project` |
| `/api/outputs/ring` | 5,000 (fixed) | 5,000 | answers `{ outputs, total }`; the page says "showing N of M" when the total is larger |

`paged=1` is the answer a list page uses: `{ items, total }`, where `total` is everything that matches, and `limit` is not capped so the page can always ask for the rest (`pagedOf` in `server/api.js`, `showing`, `pageOf`, `hasMore` and `nextSize` in `public/js/paging.js`).

A page must never treat a cap as "no more": it uses the total the route gives. The page-side rules are in `docs/ARCHITECTURE.md` (front end).

## Measured

One script (`npm run bench`, see "How to measure again"), one set of generated data (20,000 files in one project, 2,000 notes, 3,000 actions, 200 meetings, 50 chats of 200 turns, a stand-in `claude`), run in the same sitting for both columns. The machine was shared, so compare the ratios, not the raw milliseconds.

- **before** is the code as it was before the performance work. Three runs; where a cell shows three numbers or a range, those are the runs.
- **after** is the code with the performance work. One run only.
- "First answer" is the time from starting the server to its first reply to a tiny request. "Stall" is a tiny request that waited more than 300 ms while other work was going on. "File list after the cache expired" is the first `/api/files` call after the remembered list was thrown away.

| Measure (generated data, stand-in claude) | before (3 runs) | after (1 run) |
|---|---|---|
| First answer after start | 427 / 395 / 416 ms | 426 ms |
| Worst answer to a tiny request in the first 6 s | 81 to 96 ms | 22 ms |
| Stalls over 300 ms in the whole run | none | none |
| First /api/files (first walk, wall time) | 3,948 ms | 2,965 ms |
| File list after the cache expired, first call | 454 / 358 / 272 ms | 155 ms |
| /api/search median / worst | 40 / 67 ms | 41 / 56 ms |
| /api/files?q= median | 12 ms | 14 ms |
| /api/meetings median | 23 ms | 19 ms |
| Idle CPU | 0 % | 0 % |

Smaller before and after figures from the earlier steps of the same work (one measurement each): server unresponsive at start 24 to 28 s before, 0.1 to 0.2 s after; the first walk blocked other requests for 8 to 13 s before, under 0.4 s after; the file ring 329 to 795 ms before, under 2 ms after; a chat message answered in 109 ms before, 3 to 5 ms after; chat search 1,000 ms before, 5 to 7 ms after; `/api/notes` 104 ms and 3.7 MB before, 19 ms and 84 KB after.

## Known limits

- The memory index is in memory only, so after each start every file is read again, in the background (the first pass on 8,000 files takes about 20 seconds on the generated data; searches meanwhile see what is read so far, and pages say "still reading your files"). Keeping it on disk was not done.
- An edit that keeps a file's size, modified time and file number the same cannot be seen until the next full read. Ordinary editors and sync tools change at least one of these.
- Two programs saving the same actions file within a few milliseconds: the last writer wins (Jade re-checks the file right before writing, so the window is small).
- Chats are private to Jade; an edit to `.state/chats/` made outside Jade is not noticed while Jade runs.
- Search looks through the newest 300 chats only; the memory index holds at most 8,000 files and the file map at most 20,000 per folder, so material past those limits is not found by search.
- A folder with more than about 2,000 sub-folders cannot be watched completely; the file map checks it against the disk instead (see the file map row above). When a folder watch cannot be trusted, Jade falls back to checking folders by their modified time about once a minute.
- The work panel in a chat sees the loaded last 40 turns for "files changed in the chat".

## How to measure again

```
npm run bench                        # one run: seeds a temp data folder, starts this checkout on a free port with a stand-in claude, measures, cleans up
npm run bench -- --idle 20           # a shorter idle phase (default 130 s)
npm run bench -- --repo <other checkout> --out results.json
```

`scripts/bench/` holds `bench.mjs` (the run), `seed.mjs` (the data), `micro.mjs` and `micro2.mjs` (single functions) and `standin/claude` (the stand-in). The bench uses a temp folder for everything, a free port, and stops only the server it started. Run it three times before and three times after a change, from the same sitting. Read `stallSummary` in the result: any answer to a tiny request that took over 300 ms while the run was going is listed with its phase. The aim is no stall over about 100 ms of Jade's own doing.
