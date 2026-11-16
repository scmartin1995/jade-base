---
status: accepted
---
# Dashboards are fixed layouts that Jade's own code draws

## Context

The first idea was to let a model write a dashboard as an HTML page. That page would run script next to the PM's project data, and what it showed (numbers included) would be whatever the model wrote, with no way to check it. The dashboards are for project managers who will trust the figures on them.

## Decision

A dashboard is a **specification**: a title, an introduction and up to 12 sections, each naming one layout from a fixed list, one data source from a fixed list, and fields, filters and a sort from fixed lists (`server/core/dashboardspec.js`). The model returns only that JSON; it writes no HTML, no script and no numbers. Jade checks it strictly (unknown names rejected, strings capped, every lookup by a model-supplied name ignores inherited properties), saves it as `<project folder>/Jade/Dashboards/<name>.json`, and checks it again each time it is read. The page draws it with Jade's own renderers in `public/js/dashboard/`, from fresh data on every open, putting every value on the page as text, never markup. "Refresh" needs no model. To add a layout, add one entry to `LAYOUTS` and one renderer file (`docs/EXTENDING.md`).

## Consequences

- No model-written code runs anywhere: no frame, no injected data object, no page served from the dashboard folder.
- What remains: the model's own words (titles, introduction, notes, the text section) are shown as plain text and may be wrong; and the text of the fact files the PM ticks and sample values of their data go to the model. The README says so.
- A model cannot invent a new kind of chart. A PM who wants one needs a new layout written by a contributor.
- Dashboards made in the old HTML style are listed as "older dashboard" and are no longer served with project data.

## How to tell if this should be revisited

Revisit if PMs repeatedly need something the layouts cannot show. The answer is a new layout (more fixed code), not freeform output. Revisit the rule itself only if a way to run model-written pages with no access to project data and no network exists in the browser, and the figures can still be computed by Jade.
