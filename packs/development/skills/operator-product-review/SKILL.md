---
name: operator-product-review
description: "Post a finished runtime product review of one pull request's plan or change as its report, keep ai:approved with the change verdict, then route the PR: a plan on to implementation or back to planning, a change on to verification or back to development. Runs as the runtime's product-review-verdict operation."
argument-hint: "(runtime only; by hand run profile product_review_skill instead)"
---

# Operator product review verdict

The runtime runs profile `product_review_skill` read-only in another engine, so it cannot post; this
run records its verdict without judging again. It is the `product-review-verdict` operation of
`operator.yaml`. Load the `operator-contract` skill first; the stage is its *Product review*.

| Contract | |
|---|---|
| Trigger | The runtime's `product-review` job finished; `input.output` is its findings file at `input.head`, `input.mode` is `plan` or `change`, `input.checkout` the PR's slot it judged |
| Work | post the report unchanged; a change verdict sets or clears the `approved` label |
| Evidence | the `## Product review (<mode>) - …` comment at `head:` |
| Next | plan `PROCEED` → development, `implement`; plan `RETURN` → queue, `plan`; change `APPROVE` → verification, or development when a thread or owner input stands; change `RETURN` → development, `implement` |

## Steps

1. **Re-check the head.** The PR must be open, in the development milestone for a plan or the
   `codeReview` milestone for a change, without `owner:onhold` or another run's `ai:processing` (a
   HELD report, `operator-contract`), and its head must equal `input.head` and the findings file's
   `head`. Anything else ends `noop`: a moved head is judged when its own phase asks.
2. **Claim the PR in its slot**, which stands on the PR branch at that head once reconciled
   (`operator-contract` > The slot stays with its pull request).
3. **Record.** The findings file holds `mode`, `verdict` and `report`, the complete comment. Post
   `report` unchanged. A report whose first line is not `## Product review (<input.mode>) - <verdict>`,
   whose next line does not start `head: <input.head>`, or whose verdict the mode does not allow
   (`PROCEED` or `RETURN` for a plan, `APPROVE` or `RETURN` for a change) ends `failed`. A change
   verdict sets the `approved` label (`operator_config` `labels.approved`, default `ai:approved`):
   `APPROVE` adds it when another `ai:*` label stays once the claim is dropped, `RETURN` removes it
   when it stands. A plan verdict writes no label, and no verdict writes a success factor.
4. **Hand the PR on** in one edit that drops `ai:processing`, and end `done` with the hand-off
   request (`operator-contract`):
   - plan `PROCEED`: it stays in development, where `operator-implement` starts;
   - plan `RETURN`: to the queue milestone, where `operator-plan` answers the report;
   - change `APPROVE`: to the verification milestone when no review thread is unresolved (profile
     `forge_cli threads <n> --unresolved`) and no owner input follows the report (profile
     `operator_discover --owner-input <n>`): the head is finished and `operator-verify` waits for CI
     and QA; otherwise to development, where `operator-implement` handles them and moves the head on
     without a second change review;
   - change `RETURN`: to development, where `operator-implement` fixes or declines each finding once.
5. **Remove the body file** (`input.body`) once the report is posted or the run ends `noop`; the slot
   stays on the PR branch (`operator-contract`).

## Run by hand

Nothing to post without a runtime review: run profile `product_review_skill` by hand on the plan or
the change, post its report, and act on a `RETURN` once as `operator-contract` > Product review says.

## Verify

- The `## Product review` comment names the head and the mode it judged.
- The `approved` label stands exactly when the newest change report is `APPROVE`, beside another
  `ai:*` label.
- The pull request sits where step 4 sends it, with no claim left on it.

## Scope / hand-off

- Answering a `RETURN` belongs to `operator-plan` (a plan) and `operator-implement` (a change); the
  judgment itself is profile `product_review_skill`.

## Constraints

- One report per head and mode: a report for this head and mode already standing posts nothing
  again, and a pull request still in step 1's milestone goes straight to step 4, so a retry after a
  failed move finishes it.
- No judgment of its own and no fixes here.
