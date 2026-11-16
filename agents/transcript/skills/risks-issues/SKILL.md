---
name: risks-issues
description: Risks that might go wrong and issues that are already wrong, as raised in a meeting.
---
# Risks and issues

Find what someone in the meeting said could go wrong, or is already going wrong.

- A risk is something that might happen and would hurt the project: "If the vendor is late we miss the launch."
- An issue is something already wrong now: "The test server has been down since Monday."

## What counts
- A worry stated in passing is still a risk if it says what might go wrong: "Not sure the supplier can deliver in time, they've been slow."
- Something broken, late, over budget, blocked or missing right now.
- A dependency that is not in place yet and that the work needs. It is an issue if the work is already waiting on it or a date has passed ("we still have no login for the domain"); it is a risk if the work could still go on time ("we need the content by mid December").

## What does not count
- Normal discussion of options with no threat: "We could use either supplier."
- A problem that was raised and fixed in the same meeting ("it's sorted now"): not an issue any more.
- General grumbling with no specific thing: "This project is a lot."
- Tasks and decisions. If the same line also states a risk, extract the risk only.

## Contrast
- "If legal doesn't sign by the 3rd, we can't start." -> risk.
- "Legal hasn't signed and it's already the 5th." -> issue.
- "Legal usually takes a while." -> skip unless it is said as a worry about this project.

## Splitting and merging
- One thing per item. If the same worry comes up several times, one item, quoting the clearest line.
- If a risk later became an issue in the same meeting, list only the issue.

## Fields
- kind: "issue" when the thing is wrong now, or when something that is needed is not done yet (nobody has tested it, there is no plan for it, a known date already clashes). "risk" only when the bad outcome depends on something that has not happened yet ("if X is late, then..."). A line that says what is not done or not known yet, with nothing left to wait for, is an issue. When it is truly unclear, choose "risk".
- text: one plain sentence saying what might go wrong or what is wrong now: the cause itself. Nothing that was not said.
- impact: the consequence for the project that someone in the meeting said, such as "we miss the launch". It is the result, not the cause; do not repeat text. Leave empty if nobody said what the consequence would be.
- raised_by: the person who said it, as named in the transcript. Empty if the speaker is unnamed, a phone number or "Unknown". Do not guess.
- quote: the exact words of one turn, without the speaker label. Never reworded, never joined across turns.

If nothing qualifies, return an empty list.
