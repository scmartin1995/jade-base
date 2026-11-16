---
status: accepted
---
# One file per chat, and a safe move from the old file

## Context

Every chat was kept in one file, `chats.json`. Sending a message read, parsed and rewrote all of them (5 MB for 50 chats of 200 turns), and a chat search read all of them. A crash in the middle of a write could damage every chat at once.

## Decision

Each chat is a file of its own, `.state/chats/<id>.json`. Saving a message writes that one file. Every write goes through one routine that writes a temporary file beside the real one, flushes it and renames it, so a crash leaves the old file or the new one, never half of one. The list of chats (title, dates, count, last words) is kept in memory; the most recent chats are kept too, bounded by number and size; the lower-case text a search compares with is kept per chat, bounded by size. The first start after the change moves each chat over: it writes the chat, reads it back and compares, and only when every chat matches does it rename the old file to `chats.json.migrated`. If anything fails the old file stays and the error is logged. An old file that cannot be read is left alone, never replaced by an empty list.

## Consequences

- A message, a rename or a search no longer costs time in proportion to all chats.
- The old file is kept as a backup and is never deleted by Jade.
- Chats are private to Jade: an edit made outside Jade to `.state/chats/` is not noticed while Jade runs.

## How to tell if this should be revisited

Revisit if chats need to be shared or edited by other programs (then they need change detection like notes), or if one chat grows past what a single file read can serve quickly (the 200-turn cap exists for this).
