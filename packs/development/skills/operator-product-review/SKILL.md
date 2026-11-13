---
name: operator-product-review
description: "Post a finished runtime product review of one pull request head as its report, write ai:approved when it approves, then send the PR on to verification or back to development, planning or the owner. Runs as the runtime's product-review-verdict operation."
argument-hint: "(runtime only; by hand run profile product_review_skill instead)"
---

# Operator product review verdict

The runtime runs profile `product_review_skill` read-only in another engine, so it cannot post; this
run records its verdict without judging again. It is the `product-review-verdict` operation of
`operator.yaml`. Load the `operator-contract` skill first; the stage is its *Product review*.

| Contract | |
|---|---|
| Trigger | The runtime's `product-review` job finished; `input.output` is its findings file at `input.head` |
| Work | post the report unchanged; `ai:approved` (`labels.approved`) on `APPROVE`, cleared on `RETURN` |
| Evidence | the `## Product review (change) - …` comment at `head:` |
| Next | `APPROVE` → verification (from `codeReview`), or where it stands; `RETURN` → development, queue or an owner question, by its route |

## Steps

1. **Re-check the head.** The PR must be open, in `codeReview`, `verification`, `humanReview` or
   `mergeQueue`, without `owner:onhold` or another run's `ai:processing` (a HELD report,
   `operator-contract`), and its head must equal `input.head` and the findings file's `head`.
   Anything else ends `noop`: a moved head is judged when its own phase asks.
2. **Claim the PR in its slot**, which stands on the PR branch at that head once reconciled
   (`operator-contract` > The slot stays with its pull request).
3. **Record.** The findings file holds `verdict`, `route`, `owner_question` and `report`, the complete
   comment. A report whose first line is not `## Product review (change) - <verdict>` (`APPROVE` or
   `RETURN`), whose next line does not start `head: <input.head>`, or a `RETURN` without a route
   (`development`, `plan` or `owner`, the last with its question) ends `failed`. First read the owner
   input (profile `operator_discover --owner-input <n>`) and keep it in a file beside `input.output`:
   the report becomes its cutoff, so what it lists now - input given while the review ran - goes on
   with step 4, and an attempt after the report was posted reads that file instead. Then post
   `report` unchanged, unless the newest product report already is this one, from an earlier attempt
   of this run. Write the factor `operator_config` `labels.approved` names (default `ai:approved`;
   profile `forge_cli factor set|clear <n> --name <it>`) on every attempt: `APPROVE` sets it,
   `RETURN` clears it.
4. **Route** in one edit that drops `ai:processing`, and end `done` (`needs-input` for the owner):
   - `APPROVE` with no review thread unresolved (profile `forge_cli threads <n> --unresolved`) and no
     owner input from step 3: from `codeReview` to the verification milestone with the hand-off
     request (`operator-contract`); from a later milestone it stays where it is. Otherwise to
     development, where `operator-implement` handles them.
   - `RETURN` to `development`: to the development milestone, asking `implement`;
   - `RETURN` to `plan`: to the queue milestone, asking `plan`;
   - `RETURN` to `owner`: to the development milestone, asking `owner_question` as
     `operator-contract` > Asking the owner says, its wait resuming `implement`.

   A `RETURN` also removes `ai:completed` when it stands. Its request, and an `APPROVE` that step 3's
   owner input sends to development, is keyed `<operation>:<head>:product-<report id>` and carries
   `evidence`: the report's URL and each owner input's URL from step 3, which discovery would not
   pass on because they sit behind the report's cutoff.
5. **Remove the body file** (`input.body`, when the input names one) once the report is posted or
   the run ends `noop`; the slot stays on the PR branch (`operator-contract`).

## Run by hand

Nothing to post without a runtime review: run profile `product_review_skill` by hand on the change,
post its report, and set or clear `ai:approved` as step 3 does.

## Verify

- The `## Product review (change)` comment names the head it judged, once per review.
- `ai:approved` stands exactly when the newest product report is an `APPROVE` at the head.
- The pull request sits where step 4 sends it, with no claim left on it, and owner input given
  during the review went with it as evidence.

## Scope / hand-off

- Rework belongs to `operator-implement`, a revised plan to `operator-plan`; the judgment itself is
  profile `product_review_skill`.

## Constraints

- No judgment of its own and no fixes here. A factor is written only from this verdict.
