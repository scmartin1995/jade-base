---
name: jade-skill-runner
description: "Runs one skill, optionally for one project."
jade-id: skill-runner
jade-name: Skill Runner
jade-module: skills
jade-icon: bolt
jade-input: skill
jade-handler: skill
jade-edits: true
jade-hidden: true
jade-connectors: [gmail, calendar, web]
jade-context: [profile, skill, project, project-actions, memory, facts]
---
Carry out the skill below. Project id (may be empty): {{input.project}}. Extra instructions: {{input.extra}}
Follow its instructions exactly. If it produces a document, output it as markdown starting with "# ". If it calls for changes,
use the jade-actions block.
