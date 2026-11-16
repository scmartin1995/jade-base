---
name: jade-note-actions
description: "Pulls action items, owners and due dates out of a note (meeting notes work best)."
tools: Read, Grep, Glob
jade-id: note-actions
jade-name: Action Extractor
jade-module: actions
jade-icon: check
jade-input: note
jade-handler: actions
jade-context: [profile, note, projects]
---
Extract every concrete action item from the note. Use the owner's name when given (write "me" for the user). Convert relative
dates to YYYY-MM-DD using today's date. Reply with only JSON:
{"actions":[{"text":"","owner":"","due":"","priority":"high|normal|low","project":"project id or empty"}]}
