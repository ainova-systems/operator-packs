# Roadmap

Planned improvements and known defects. Each entry states the problem it exists to fix, so a future
session or contributor can pick it up without re-deriving the reasoning. Shipped entries move to the
CHANGELOG.

## Recorded, not built

### Discovery as pack code

**Problem.** The development pack defines discovery only as a contract
(`packs/development/skills/operator-contract/references/discovery-contract.md`), so every project
writes its own. The one implementation in use runs to about a thousand lines, most of them generic:
request keys and their length limit, both digests, the owner-input filter, the routing table,
clarification routing, hand-off adoption, send-back order, stale claims, resuming answered questions.
A defect in the generic part is fixed once per project or never: a running clarification select
run's claim was read as stale because its job ran under the subject `clarify-queue`.

**Shape.** Ship the generic part as a script in `operator-contract/scripts/` with a fixture-driven
test of the routing table, and leave the project a small module for what only it knows: its queue
reader, QA state and tickets. The contract cases in `scripts/discovery-contract.mjs` are its first
piece. A prerequisite: discovery reads the forge only through contract shapes - today a discovery
imports GitHub-shaped readers from `forge-github.mjs` - so a second forge does not need a second
discovery.

### The runtime's compare-and-set claim

**Problem.** A claim is the processing label plus a best-effort `claims` state record; discovery
infers a stale claim from job status and label times, and a skill passes one with `--takeover`. The
runtime offers an atomic lease with a run id and an expiry (`operator claim take|renew|release`),
which the pack does not use.

**Shape.** Take the lease before writing the label and release it in the edit that removes the label,
so the label is the lease's projection and stale-claim recovery reads the lease. A run by hand keeps
the label-only path. Core's `git-workflow` already recognises a claims record a runtime keeps; what
is missing is a decision on how hand runs and runtime runs share one pull request.

### `operator-init` and an adoption guide

**Problem.** Nothing creates the milestones, the owner labels or the question and hand-off labels
(core's `dev-init` creates only the `ai:*` set), and nothing writes the configuration, the profile
keys or the CI path filters that cover the installed pack. A second project repeats the first one's
setup by hand from the runtime's setup prompt.

**Shape.** An idempotent `operator-init` that asks one question at a time, creates the milestones and
labels on the forge or names the capability gap, writes `operator_config` and the profile keys, copies
the reference manifest, runs `operator validate --describe` and a dry run, and reports what it could
not resolve; with it, a guide to running the runtime as a service. Built on the second adopter, so it
is proven on a real run rather than on paper.

### A forge without pull-request labels

**Problem.** The forge contract has one implementation, GitHub. A project on a forge whose pull
requests carry no labels a script can set (Bitbucket, to confirm when built) has nowhere to hold the
state label or the factors.

**Shape.** A `forge-<platform>.mjs` implementing the contract, reading factors from the stage reports
(already the freshness source) and naming the state label as a capability gap, never emulating it.
Waits for a second project on such a forge.

### A readiness check

**Problem.** Autonomous delivery depends on prerequisites nobody checks before it starts: CI runs on
pull-request heads, a QA deployment serves each head, the forge answers every contract subcommand,
the labels and milestones exist, each declared factor has a writer. A missing one surfaces as pull
requests stuck after the start.

**Shape.** A read-only check - an `operator-contract` script or an `operator-init` step - that reports
each prerequisite with its evidence and changes nothing. Most useful once a second forge
implementation exists.

### Two meanings of `direct_lane`

**Problem.** Core's `direct_lane` names the paths its push guard lets through to a protected branch.
The development pack's names the queue records committed straight to the integration branch and the
paths a clarification pull request may merge with no owner review. One name and one default, two
permissions: a project that pushes directly in more lanes than it wants clarification to self-merge
must break a lane or widen the self-merge.

**Shape.** Core keeps `direct_lane` for pushes; the operator packs read it only for queue records and
add their own key, default `none`, for clarification's self-merge. Breaking for a project that
clarifies: expand-contract over two releases.

### A findings schema for the review job

**Problem.** The reference manifest's `review` operation needs the JSON Schema of the findings file
`operator-contract` > Judging stages defines, and the pack ships none: the example carries a
placeholder, and each project writes its own schema from that table, which can drift from it.

**Shape.** A `references/review.schema.json` matching the table, a test that every field the table
names is in the schema and nothing else is, and the example pointing at it.

### The reference manifest parsed in CI

**Problem.** `operator.example.yaml` is checked against the runtime's manifest parser only by hand.
A runtime release that changes a key leaves the example invalid with nothing failing here.

**Shape.** A CI step that installs the runtime package at a pinned version without saving it and
parses the example with its own manifest parser, failing on any error. A CI-only dependency; the
pinned version moves when the pack adopts a runtime release.

### A body digest under an extended exclusion list

**Problem.** Adding a block to profile `digest_exclude` changes the body digest of every open pull
request, so every review recorded against the old list reads as stale and every pull request is
reviewed again with nothing in it changed. One adopter accepts a recorded body digest computed under
any earlier prefix of its list; the contract says nothing either way.

**Shape.** One clause in `discovery-contract.md` > The body digest, agreed with core's
`git-verify-pr` > Digests first, since the digest is core's: either a recorded digest stays fresh
under every earlier prefix of the list, or extending the list is stated as re-reviewing every open
pull request. A contract case in `scripts/discovery-contract.mjs` for whichever is chosen.

## Known defects

### `operator-implement` reads a draft's checks as evidence

**Problem.** Core's `git-finalize-pr` > CI green says nothing a draft reports is evidence. With
`operator_config` `readyLimit` set, a pull request stays a draft through development, and
`operator-implement` steps 3 and 6 still read its checks: red CI is pending work and green CI is a
condition of the move to verification.

**Shape.** On a draft, the move to verification needs the review only, and `operator-verify` judges
CI after its admission marks the draft ready (its step 7 already does); discovery's row 11 stops
waiting on a draft's CI in the same change. Held back from this release because
`operator-implement` is at its word budget and the change touches three places, not one.

### A restated core default is never checked here

**Problem.** CONTRIBUTING requires a key shared with core to be restated with core's default, and
`validate-pack.sh` compares the two only when core's schema sits in `packs/core` - which in this
repository it never does, so the check never runs. The digest algorithm the discovery contract
states in full is the same kind of restatement, and nothing compares it with core's either: the two
had already drifted once.

**Shape.** Compare against core's schema at a pinned core version (fetched in CI), failing on a
different default; for the digests, one shared test vector - a body, a checks file and the digest
both must print.
