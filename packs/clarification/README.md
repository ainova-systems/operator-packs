# Clarification pack

The clarification flow for the operator runtime (`@ainova-systems/operator`): one skill,
`operator-clarify`, that settles queue items waiting on an owner decision so they can be delivered.
It builds on the development pack (`@ainova-systems/operator-development`): the run contract,
`operator-contract`, the forge script, the state labels and every profile key it reads are that
pack's, so install both.

## Skills

| Skill | Milestone role (default title) | Leaves when |
|---|---|---|
| `operator-clarify` | a queue item waiting on an owner decision → `clarification` (Clarification) → `mergeQueue` → merged | the item is ready with every owner answer recorded |

## The flow

A queue item waiting on an owner decision is never picked by intake, so without help the most
important work waits longest. Discovery ranks those items (the owner's `clarifyFirst: true` first,
then `flow_queue` folder order, priority and how many items wait on each) and, whenever a
clarification slot is free, offers the top ones to `operator-clarify`. It picks one, plans the answer
from the repository first, then asks the owner one question at a time in a draft documentation pull
request, recording each answer in the documents. A settled item is ready; its `## Clarification - READY` report at the head is the authorization,
so the PR goes to Merge Queue and the same operation merges it once CI decides, without another
owner review, when every path it changes matches profile `direct_lane` (unset: the owner merges it). The PR body follows the skill's own short template (Task, Approach, Open questions). Clarification slots never take
delivery work, and delivery slots never clarify.

