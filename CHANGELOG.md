# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.20.0] - 2026-11-13

A labelled issue can be a queue item: the pipeline takes it, reports on it, and closes it when the work merges.

### Added

- `operator_config` `issues` (`{ "label", "source" }`, unset by default: nothing changes). Set, an open issue carrying the label is a queue item of that source, in the place profile `flow_queue` gives it and within its `quotas` limit. `operator-intake` takes it like any item, and the pull request it opens carries `Closes #<n>` and the issue's text as taken.
- Only a trusted issue becomes a task: opened by an account in `allowedAuthors`, or labelled by an account that can triage the repository, with neither the text nor the title edited since (an edit in the same second counts as after). An issue template applying the label for its author trusts nothing; applying the label again trusts an edited text. Intake reads the issue again before it takes it and copies exactly the text it validated. Only owner and member comments count as requirements.
- The issue gets one line at each step while the work and every question stay on the pull request: taken (naming the pull request), waiting for the owner's answer (pointing at it), rejected (the reason; the issue stays eligible and the next plan answers it), cancelled (closed as not planned). `operator-merge` closes it after the merge when the platform did not, which it does only on its default branch; discovery asks intake to close an open queue issue a merged pull request already closes (`issueCleanup`) instead of taking it again. With `issues` unset no skill writes to an issue.
- Forge subcommands `issue list`, `issue view <n>`, `issue comment <n> --body-file <f>` and `issue close <n> --reason completed|not_planned --body-file <f>`, the `issue` answer shape with its `trusted` verdict, `revisedAt` and `closingPrs` (pull requests whose body closes it on any base), and a `closes` field on every pull request: the issues its body closes outside code, read from the body because the platform links them only on its default branch. `issueCandidates` and `issueCleanup` (`scripts/discovery-contract.mjs`) are the rules discovery and intake share.

**Updating:**

- Nothing changes while `issues` is unset. To turn the issue queue on: create the label, set `issues` and, if wanted, a `quotas` entry for its source, place the source in the document profile `flow_queue` names, and make the project's discovery count `issueCandidates` and `issueCleanup` of `forge_cli issue list` as reasons to ask intake, keyed by each issue's number and `revisedAt` (`discovery-contract.md` > Queues). The forge token needs read and write access to issues. A project's own forge implementation adds the `issue` subcommands and the `closes` field. Branches started before the update keep the skills they started with.

## [0.19.0] - 2026-11-13

A finished change can be judged as product before verification, as a success factor.

### Added

- Profile key `product_review_skill` (default `none`: no stage, nothing changes). Set, together with `ai:approved` in `pr_success_factors`, the runtime's `product-review` operation runs that skill read-only in another engine on every finished, code-reviewed head before verification, and the new `operator-product-review` skill (the `product-review-verdict` operation) posts its `## Product review (change) - APPROVE|RETURN` report unchanged (`operator-contract` > Product review).
- `APPROVE` writes the success factor `ai:approved` and the head goes on to verification. `RETURN` clears it and sends the pull request back by the route the review names: to development for rework, to the queue when the plan itself is wrong, or to the owner as a question that `implement` resumes. Like a code review, the next finished head is reviewed again; owner input given while the review ran goes on with the route as evidence.
- `operator-review` and `operator-implement` ask for the product review where a finished head would otherwise move to verification, with the pull request waiting in `codeReview`; a stopped chain is asked again through discovery row 11a. Discovery row 8a asks for it for a pull request in Human Review or Merge Queue without a fresh `ai:approved`, so no head merges unjudged. `operator-verify` returns a head without a fresh `ai:approved` to development, and `operator-plan` re-plans a pull request the review sent back to the queue.
- The `approved` label role (`operator_config` `labels.approved`, default `ai:approved`) names the factor for discovery.

**Updating:**

- Nothing changes while `product_review_skill` is unset. To turn the stage on: set the key, add `ai:approved` to `pr_success_factors`, add the `product-review` (with `then: product-review-verdict`) and `product-review-verdict` operations to `operator.yaml` (`operator.example.yaml` shows both), create the `ai:approved` label, add discovery row 8a to the project's discovery, and add `operator-product-review` wherever the project lists the skills that claim a pull request. Branches started before the update carry neither the verdict skill nor the new factor: discovery row 8a still judges their heads before a merge, and the project's runtime manifest decides how their slots run the verdict.

## [0.18.0] - 2026-11-10

A pull request under review says so: the review runs in its own milestone.

### Added

- The `codeReview` milestone role. `operator-implement` hands a pushed head over by moving the pull request to it, and `operator-review` moves it on: to verification after a `CLEAN` review of a head handed over `final` (the plan complete, nothing left but review and CI), to development otherwise. A finished head therefore waits for CI in verification, where `operator-verify` already waits for it and returns a red head to development; before, it waited in development.
- Discovery row 11a: a pull request left in `codeReview` with no job covering it asks `implement` (`reason: review`), which moves it back to development and hands its head to review again.

**Updating:**

- Add `"codeReview": "<title>"` to `operator_config` `milestones` (it is required) and create that milestone; a project discovery routes it as row 11a says. A pull request already handed to review in development finishes its round there.

## [0.17.2] - 2026-11-10

### Fixed

- Adopting a handed-off pull request no longer closes it. The platform closes a pull request whose head branch is renamed, so `operator-intake` keeps the branch name and binds the pull request to its slot with an `<!-- operator:slot <slot> -->` comment; a pull request's slot is the one that comment names, else the one its branch names. The forge script's `branch rename` is removed.

## [0.17.1] - 2026-11-10

### Fixed

- Profile `sync_base_skill` defaults to core's `git-to-base`, the name core 0.17.0 gave `git-sync-base`; with the old default, intake, merge and clarification called a skill core no longer ships.

**Updating:**

- On core before 0.17.0, set profile `sync_base_skill: git-sync-base`.

## [0.17.0] - 2026-11-10

Implementation rounds have a budget, the digests match core's, and a reference manifest says what each operation runs on.

### Added

- `operator-implement` runs at most profile `max_pr_rounds` rounds (default 3, `unlimited` for none), counted from the pull request's review reports since its last passing verification, outcome or hand-off; a spent budget ends through profile `outcome_skill` with an `## Outcome` report, and a comment from the owner after it starts a new budget. Discovery skips such a pull request until then.
- A reference manifest (`operator-contract/references/operator.example.yaml`) and `references/runtime-manifest.md`: model, effort and retries per operation, with why; the values are judgment, not yet measured.
- `operator-contract` > The manifest: an operation names one skill and passes its input, never a procedure, and a pipeline branch runs the skills and rules it was created with.
- `scripts/discovery-contract.mjs`: contract cases a discovery's tests run - a claim whose job is queued or running is never stale, whatever subject the job runs under - and `digestExclusions`, which refuses an `operator_config` `digestExclude` that differs from profile `digest_exclude`.
- `ROADMAP.md`: work recorded and not built, and known defects.

### Changed

- The steps and body digests, still stated here in full so the pack runs without core, match core's `git-verify-pr` > Digests again: the steps digest includes the standing checks profile `qa_checks` matches, and the blocks removed are profile `digest_exclude`'s (both keys restated with core's defaults).
- A verification step sent back as defective may also be corrected where it asks for what verification cannot do, as core's `git-finalize-pr` > The round, step 5 allows; a step that ran and failed is a code defect, and changing its conditions or expected result stays the owner's decision.
- `references/pr-state.md` is the state page core's `git-workflow` lets a scenario pack keep for its own runs, and its `claims` record is the runtime claims record core recognises; it no longer calls the takeover an operator extension.
- Profile `draft_ready` is restated with core's default and meaning: in the operator flow a draft is marked ready only by `operator-verify`'s QA admission, so a project that sets `readyLimit` sets `draft_ready: owner`.

### Deprecated

- `operator_config` `digestExclude`: while set it must name the same blocks as profile `digest_exclude`, in the same order.

### Fixed

- The forge script's command-line tests run against a stand-in for `gh` on every platform and can no longer reach the installed `gh`; on Windows one of them ran it against the checkout's repository. CI runs the pack scripts' tests on Windows too.

**Updating:**

- Set profile `digest_exclude` to the blocks `digestExclude` lists, in the same order, in core's format (`` `<start>` .. `<end>` ``, blocks separated by `;`); keep `digestExclude` until the project's discovery reads the profile, then remove it.
- Where profile `qa_checks` matches a pull request's files, its steps digest now includes those checks, so a verification report recorded before the update reads as stale and that pull request is verified again.
- Have the discovery's tests run `assertStaleClaims` and `digestExclusions` from `scripts/discovery-contract.mjs`.
- To keep rounds unbounded, set `max_pr_rounds: unlimited`; a pull request already past three reviewed rounds otherwise ends `ai:manual` on its next round.
- A project whose `operator_config` sets `readyLimit` sets profile `draft_ready: owner`, so no core skill run on its pull requests marks a draft ready ahead of QA admission.

## [0.16.1] - 2026-11-10

### Fixed

- The forge script asks a read again, up to three times, when the call meets a network fault between the host and the forge (connection reset, TLS handshake timeout, a 502/503/504 gateway error); a write is never repeated, so a dropped connection no longer fails a whole discovery run.

## [0.16.0] - 2026-11-10

A judging stage can go on while its engine is unavailable.

### Added

- Profile key `judge_fallback` (development pack): `native` lets a fresh subagent of the session's own engine run a judging stage a skill runs through `judge_runner` (verification, and review by hand) while that engine is unavailable, instead of failing the run until it returns; the report names the engine that judged. The runtime's `review` job follows its manifest `fallback`.

## [0.15.0] - 2026-11-07

Clarification is its own flow and its own pack.

### Changed

- `operator-clarify` moved from the development pack to the new `@ainova-systems/operator-clarification` (`packs/clarification`). It builds on the development pack: the run contract, forge script, state labels and profile keys stay there, so install both. The skill itself is unchanged.
- The validator checks a pack without its own profile schema against the schema and label page of the pack holding `operator-contract`.

**Updating:** a project that runs clarification adds the pack, then syncs:

```bash
intelligence package add @ainova-systems/operator-development@^0.15.0
intelligence package add @ainova-systems/operator-clarification@^0.15.0
```

- In `intelligence.yaml` `sources.skills`, add `.intelligence/packages/@ainova-systems/operator-clarification/skills`.
- Run `intelligence sync`.

## [0.14.0] - 2026-11-07

Packs are named after the flow they run, so later flows sit beside this one.

### Changed

- The pull-request delivery pack is `@ainova-systems/operator-development` in `packs/development`; `@ainova-systems/operator` stays the name of the Operator runtime's npm package only. Skill names are unchanged.

**Updating:**

```bash
intelligence package remove @ainova-systems/operator
intelligence package add @ainova-systems/operator-development@^0.14.0
```

- In `intelligence.yaml` `sources.skills`, replace `.intelligence/packages/@ainova-systems/operator/skills` with `.intelligence/packages/@ainova-systems/operator-development/skills`.
- Point profile `forge_cli`, and any project script importing the forge script, at `.intelligence/packages/@ainova-systems/operator-development/skills/operator-contract/scripts/forge-github.mjs`.
- Run `intelligence sync`.

## [0.13.0] - 2026-11-06

The operator pack has its own repository, its profile keys live in the pack, and queue documents go through a pull request unless `direct_lane` names them.

The operator pack moved here from intelligence-dev-packs 0.12.1 with its history.

### Changed

- The operator profile keys moved from core's profile template into the operator pack (`packs/operator/templates/operator-project-profile.md`), together with `flow_plan` and `judge_runner`, which only the operator skills read; a project that already has them in its profile changes nothing.
- The pack validator checks the operator pack's `ai:*` labels against its own `pr-state` page and its profile keys against its own schema, so the pack validates without core.
- The new profile key `direct_lane` names the documents that need no reviewed pull request. Intake and clarify commit a queue record straight to the integration branch only when it matches, and clarify merges a clarification pull request on its own only when every changed path matches. The default `none` matches nothing: queue records go through a pull request, and clarify asks the owner to set the key instead of merging.

**Updating:** a project that took the operator pack from intelligence-dev-packs switches its source:

```bash
intelligence registry add https://github.com/ainova-systems/operator-packs.git
intelligence package remove @ainova-systems/operator   # only when it was installed by that name from intelligence-dev-packs
intelligence package add @ainova-systems/operator@^0.13.0
```

- In `intelligence.yaml` `sources.skills`, replace the old operator skills path with `.intelligence/packages/@ainova-systems/operator/skills`, then run `intelligence sync`.
- Point profile `forge_cli` at `.intelligence/packages/@ainova-systems/operator/skills/operator-contract/scripts/forge-github.mjs`.
- Set `direct_lane` to keep committing queue documents directly to the integration branch; left at `none`, they go through a pull request.
