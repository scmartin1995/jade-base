---
name: action-items
description: Things a named person or group agreed, or was asked, to do, with the owner and due date only when they were said.
---
# Action items

Find each thing a person or group agreed to do, or was asked to do and accepted. The project manager will put these on a
to-do list, so each must be something someone could go and do.

## What counts
- A clear request that was accepted: "Dana, can you send the draft to legal?" "Sure, Thursday."
- A volunteer who stuck with it: "I'll update the risk log." (and nobody later changed that)
- A group commitment: "Finance will confirm the numbers." Owner: Finance.

## What does not count
- Vague wishes: "We should really look at the contract sometime."
- Things somebody did in the past: "I already sent it."
- A volunteer who backed out: "I can do it... actually no, I'm away that week, someone else should."
- A question or a hope: "Could someone maybe check?" with nobody taking it up.
- A task handed to someone who never answered: "Marcus, you'll set up the call." with no reply from Marcus. The transcript does not show he accepted, so leave it out.
- A promise that is hedged and has no date: "We'll send the photos at some point." "Maybe I'll look into it." "I might get to it." These are intentions, not commitments. Leave them out, even when a name is attached. It counts if the same person later commits to it plainly.
- Decisions and facts with no task in them. Those are key points.

## Contrast
- "Priya: I'll book the room for Tuesday." -> item (owner Priya).
- "Priya: I could book the room, if nobody else wants to." then "Marcus: I've got it." -> item for Marcus only, from his line.
- "Somebody needs to chase the vendor." -> item with the owner left empty ONLY if the group clearly accepted it needed doing; if it was just a remark, skip it.

## Splitting and merging
- One task, one owner, one item. If two people each take a different task, that is two items.
- If one task is mentioned again later (reminder, confirmation), keep one item and quote the clearest line. If the owner or date was refined later, use the final version.
- If a request has two parts for the same person ("send the report and book the follow-up"), make two items.

## Fields
- text: the task as a short instruction starting with a verb, for example "Send the draft to legal". No names inside it.
- owner: who will do it, as the transcript names them ("Priya", "Finance", "the vendor"). If it was not said, leave it empty. Never guess from who spoke last or from job titles. "I" means the speaker, so use the speaker's name, but if the speaker is a phone number or "Unknown", leave owner empty.
- due: the deadline in the words used, for example "by Friday" or "end of next week". It must be a deadline for this task that its owner took on, said in the turn you quote or in the answer to it. A deadline said for something else, or a condition ("once the budget is confirmed", "after the review"), is not a due: leave due empty and, if the condition matters, put it in text ("Send the figures once the budget is confirmed"). If nothing was said, leave it empty. Words only; never put a date in this field.
- due_date: a calendar date in the form YYYY-MM-DD. Fill it only when it follows directly from the words in due and the "Meeting date" line before the transcript ("tomorrow", "by Friday", "end of the month"). Work from the weekday given there. If the words are vague ("soon", "after the launch", "next quarter"), or the words name no day, or there is no meeting date, leave it empty. An empty due_date is correct and common; never guess a date.
- quote: the exact words of one turn, without the speaker label: the turn where the owner took it on, or, if that turn has fewer than three words, the turn where it was asked. Never reworded, never joined across turns.

If the meeting has no action items, return an empty list. That is a normal result.
