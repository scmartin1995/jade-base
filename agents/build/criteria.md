---
workflow: build
risk: Calling unfinished work finished costs more than sending finished work back once more. When in doubt, it is not complete.
---
# Build criteria

Skeptic checks a build: a chat in which Jade created or changed files for {{name}}. The source is the request, the conversation
before it (where the plan was agreed) and what Jade was given; the output is every reply Jade gave on this build and the files
as they are now. The question is not "is this good" but "is it complete, as asked and as planned".

## C1 Every instruction is done
Rule: Each thing the request and the earlier conversation asked for is done in the files, or the reply says plainly that it was
not done and why. Nothing asked for is silently left out.
Test: For each instruction in the request or earlier_conversation, a file in files_changed shows it done, or a line of the reply
says it was not done.

## C2 The agreed plan was followed
Rule: Where the conversation settled a plan (steps, names, places, choices the user picked), the work follows it. Any departure
from the plan is named in the reply with the reason.
Test: Each step or choice agreed in earlier_conversation is matched by the files or the reply, or the reply names the departure.

## C3 Finished, not partial
Rule: The files contain no placeholders, stubs or "to do later" parts unless the plan said to leave them, and nothing is cut off
half way.
Test: No content_now contains TODO, FIXME, "placeholder", "left as an exercise", "…rest unchanged" or an unfinished section,
unless earlier_conversation agreed to leave that part.

## C4 Only what was done is claimed
Rule: Every file the replies say was created or changed is in files_changed, and nothing is called done, tested or working
that the output does not show.
Test: Every "I created", "I updated", "added", "tested", "works" in the replies matches an entry in files_changed or a check the
replies describe.

## C5 The work was checked
Rule: The replies say how the build was checked (run, tested, opened, re-read against the request) and what that showed, or say
plainly that it could not be checked.
Test: A line of the replies names the check and its result, or says it was not checked.

## C6 Nothing unasked was changed
Rule: The files changed are the ones the request and plan call for; nothing unrelated was edited.
Test: Each entry in files_changed is explained by the request or the plan in earlier_conversation.

## C7 Numbers come from code
Rule: Every sum, total, count, percentage or reconciliation stated in a file or a reply was computed by code that ran, never added up by hand. A total or "confirmed" count that no run produced does not count.
Test: For each computed figure in content_now or the replies, a reply names the run (command, script or query) that produced it, or the figure is plainly copied from a source in the request. Mark n/a when no figure was computed.

## C8 Code is covered by tests worth keeping
Rule: New or changed code behavior has tests written at a seam (the public interface), and the replies show they were seen to fail first or say why not. Tests are not tautological (the expected value does not come from recomputing it the way the code does) and do not reach into internals.
Test: Each changed code file has a test in files_changed or a reply says why none was needed; no test in content_now asserts a value computed by the same expression as the code under test. Mark n/a when no code behavior changed.

## C9 Code meets the repo's standards and the spec
Rule: Changed code follows the repo's documented standards (CODING_STANDARDS.md, CONTRIBUTING.md, nearby code) and does what the request asked, with no unasked behavior. Fowler code smells in the change (duplicated code, speculative generality, mysterious names, middle men) are judgement calls: name them, never fail on a smell alone. A documented repo standard overrides the smell list.
Test: Quote the line of the standard or request that a changed hunk breaks, from content_now or the source. Fail only on a quoted breach, not on taste. Mark n/a when no code changed.

## C10 Agent and skill files are written for the agent that reads them
Rule: A changed skill, agent, AGENTS.md or CLAUDE.md file opens each step with an action, ends each step on a clear done condition, keeps reference apart from steps, and its description names when to use it.
Test: For each changed file of that kind, quote a step with no clear completion condition or a description that does not say when to use it. Mark n/a when no such file changed.

## C11 Prose does not read as machine-written
Rule: Reports, READMEs and other prose the build produced have no filler openers, closers, stacked hedges or padding, and keep the writer's voice.
Test: Quote the sentence in content_now that is padding or filler. Mark n/a when the build produced no prose for a reader.
