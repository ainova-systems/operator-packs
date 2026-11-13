---
name: operator-review
description: "Post a finished runtime review of one pull request head as its review report, write ai:reviewed when it passes, then move the PR from `codeReview` to development, or to verification after a clean review of a finished head. Runs as the runtime's review-verdict operation."
argument-hint: "(runtime only; by hand run profile review_skill instead)"
---

# Operator review verdict

The runtime runs profile `review_skill` (default `git-review-pr`) every round, read-only and in another engine, so it
cannot post; this run records its verdict without judging again. It is the `review-verdict`
operation of `operator.yaml`. Load the `operator-contract` skill first.

| Contract | |
|---|---|
| Trigger | The runtime's `review` job finished; `input.output` is its findings file at `input.head`, `input.checkout` the PR's slot it judged |
| Work | post the report unchanged; `ai:reviewed` and the body note when no Critical stands |
| Evidence | the `## Code review - …` comment at `head:` |
| Next | a `CLEAN` review of a head handed over `final` → `verification`, or first the change review (`product-review`) when one is due; otherwise `development`, where `implement` runs as discovery asks it: on findings, owner input or decided CI, never while CI runs after a clean review |

## Steps

1. **Re-check the head.** The PR must be open, in the `codeReview` milestone (or `development`, for a
   head an earlier `operator-implement` handed over there), without
   `owner:onhold` or another run's `ai:processing` (a HELD report, `operator-contract`), and its head must equal `input.head` and the
   findings file's `head`. Anything else ends `noop`: a moved head has its own review coming.
2. **Claim the PR in its slot**, which stands on the PR branch at that head once reconciled
   (`operator-contract` > The slot stays with its pull request).
3. **Record.** The findings file holds `verdict`, `findings` and `report`, the complete
   `## Code review - …` comment the review stage posts (`operator-contract` > `references/pr-state.md`).
   Post `report` unchanged; then, as the review stage does, add `ai:reviewed` when the verdict is `CLEAN` or `PASS-WITH-WARNINGS`
   and no finding is `critical`. A report naming another head, or outside the envelope, ends
   `failed`. After a pass, post one note recording the body it judged - `Reviewed body: <digest>`,
   then `<!-- operator:reviewed <digest> -->` before the note marker, the digest of `input.body` from
   profile `operator_discover --body-digest <n> --body <input.body>` - so a body edited later, or
   during the review, leaves it stale (`operator-contract` > `references/pr-state.md`). Unless that
   call exits 0 with exactly one 12-hexadecimal-character digest on stdout, the digest is not
   available: no note and no failure, the result says so, and the review stays fresh by head alone.
4. **Hand the PR on** in one edit that drops `ai:processing`, and end `done` with the hand-off
   request (`operator-contract`):
   - to the verification milestone when the verdict is `CLEAN` with no finding, `input.final` is true,
     no review thread is unresolved (profile `forge_cli threads <n> --unresolved`) and no owner input
     follows the report (profile `operator_discover --owner-input <n>`): the head is finished, and
     `operator-verify` waits for CI and QA, returning it to development when either fails. When
     profile `product_review_skill` is set and no `## Product review (change)` report stands in this
     cycle, the finished head goes to the change review first instead: the edit only drops the claim,
     leaving the pull request in `codeReview`, and the run ends `done` asking for it
     (`operator-contract` > Product review), with `input.body` as its body;
   - otherwise to the development milestone. Discovery asks implementation for a head with
     findings, owner input or CI that has decided, and for nothing while CI still runs after a clean
     review. Only implementation knows whether every planned slice has shipped, so the move to
     verification here rests on its `final`.
5. **Remove the body file** (`input.body`) once the report is posted or the run ends `noop`, unless
   step 4 handed it to the change review; the slot stays on the PR branch (`operator-contract`).

## Run by hand

Nothing to post without a runtime review: run profile `review_skill` through profile `judge_runner`, then
`/operator-implement <n>`.

## Verify

- The `## Code review` comment names the head it judged, and `ai:reviewed` stands only when no
  Critical finding does; a pass carries the `operator:reviewed` note whenever discovery answers
  `--body-digest`.
- The pull request left `codeReview`: for verification only on a `CLEAN` review of a `final` head
  with no unresolved thread or owner input, for development otherwise - or it stays there, unclaimed,
  with the change review asked for that finished head.

## Scope / hand-off

- Fixes belong to `operator-implement`, and so does the move to verification of a head not handed
  over `final`; the review procedure itself
  is profile `review_skill`.

## Constraints

- One review comment per head and body: a report for this head already standing posts nothing again,
  unless its passing note names another body digest than `input.body`'s; a PR still in `codeReview`
  then goes straight to step 4, so a retry after a failed move finishes it.
- No judgement of its own and no fixes here; fixes are `operator-implement`'s.
