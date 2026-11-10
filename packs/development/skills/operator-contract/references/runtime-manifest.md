# Running under the runtime

What a project's `operator.yaml` sets for each operation of the development pack, and why. A
complete manifest to start from is `operator.example.yaml` beside this page: replace its `<...>`
values, then `operator validate --describe` checks it against the repository. The runtime's own keys
are its README's (`@ainova-systems/operator`); what every operation must honour is
`operator-contract` > The manifest.

## Model and effort

What the runtime can set:

- A `claude` operation's `model` is passed as `claude --model <model>`; an alias (`opus`, `sonnet`,
  `haiku`) follows the account's current models.
- The runtime has no effort key. A `claude` operation sets it in `args` as `--effort <level>`
  (`low`, `medium`, `high`, `xhigh`, `max`): the session's effort, which a subagent without an effort
  of its own inherits and one with its own keeps.
- `fallback: codex` refuses every Claude argument it cannot translate, `--effort` included, and runs
  Codex without the operation's model, so an operation with a fallback runs at the default effort.
  `CLAUDE_CODE_EFFORT_LEVEL` in `env` would pass the fallback, but it overrides every skill's and
  agent's own effort, the judging agents' included, so it is not used here.
- A `codex` operation with `agent:` takes its model and reasoning effort from
  `.codex/agents/<agent>.toml`, which the Intelligence engine renders from that agent's tier and
  effort: set them on the agent, never in the manifest.
- The phase skills declare no `model` or `effort`: loaded inline, either would switch the session for
  the rest of the turn.

What each operation gets is a judgment, not a measurement - no cost or quality per operation has
been measured yet. Measure before tightening further; removing a `model` or an `--effort` returns
that operation to the account's default.

| Operation | Skill | Engine | Model | Effort | Why |
|---|---|---|---|---|---|
| `discover` | - | command | - | - | a script decides from state |
| `intake` | `operator-intake` | claude | sonnet | medium | it follows the queue's own order and the conflict gate and writes only a reservation and a draft; a wrong pick is visible, and the owner rejects it |
| `plan` | `operator-plan` | claude | opus | high | the criteria it captures are what verification later executes, so a mistake here passes every later gate |
| `implement` | `operator-implement` | claude | opus | high | it orchestrates profile `flow_implement` and fixes what the stages sent back; its subagents keep their own tier and effort |
| `review` | profile `review_skill` | another engine than `implement`'s | the reviewer agent's tier: standard, as core sets it on `dev-code-reviewer` | the reviewer agent's effort: high, as core sets it there | an independent judge: a judgment from the engine that wrote the change is weaker (`operator-contract` > Judging stages); the tier and effort are core's choice, made and changed on the agent, never here |
| `review-verdict` | `operator-review` | claude | sonnet | low | it posts a finished report unchanged and writes the label it earns, with no judgment of its own |
| `verify` | `operator-verify` | claude | sonnet | high | it triages owner input and tickets and routes fixes; the judging is profile `verify_skill`'s, through profile `judge_runner` |
| `merge` | `operator-merge` | claude | sonnet | high | its guards are mechanical, but profile `merge_gates` are rules read against the diff, and it is the last gate before the merge |
| `clarify` (clarification pack) | `operator-clarify` | claude | opus | high | it proposes resolutions and phrases questions the owner answers directly |

## Retries

A phase run that times out or meets an outage without `retries` leaves its request key failed, and
discovery's next request with that key is the same job, so the pull request waits until its state
changes. Every phase takes `retries: 2` with a 30-minute `retryDelay`; the review job, whose engine
is the one most often unavailable, takes `retries: 4`. A retried run re-reads the live state first
(`operator-contract` > The input), so a retry never repeats work that landed.

## Other settings

- Discovery is `exclusive: true`: two passes at once would ask for the same work twice.
- The review runs `access: read` in the pull request's own slot, at the head `implement` pushed.
- `kind: interactive` with `placement: herdr` lets the owner attend a session in a terminal tab;
  `kind: agent` runs headless. The example uses `agent` so it validates without herdr.
- With the clarification pack: a pool of the slots `operator_config` `clarifySlots` names, and a
  `clarify` operation in it (commented out in the example).
