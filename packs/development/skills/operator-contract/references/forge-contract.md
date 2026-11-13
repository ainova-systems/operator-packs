# The forge contract

Every code-host call a phase skill or a discovery script makes goes through one command, profile
`forge_cli`. On GitHub a project points it at `scripts/forge-github.mjs` in this skill, the default
implementation; another platform ships its own implementation of the same contract later. An implementation
implements every subcommand below and answers JSON in exactly these shapes; a subcommand the
platform cannot serve fails with a named capability gap, never an emulation.

## Subcommands

| Subcommand | Answer |
|---|---|
| `pr list` | `[pr]`, the open pull requests |
| `pr view <n>` | `pr` |
| `pr create --base <b> --head <h> --title <t> --body-file <f> [--draft]` | `pr` |
| `pr ready <n>` | `pr` |
| `pr draft <n>` | `pr`, back to draft |
| `pr edit <n> [--claim [--takeover]] [--milestone <m>] [--title <t>] [--body-file <f>] [--add-label <l>]... [--remove-label <l>]...` | `pr`; a phase hand-off, or a claim with a milestone move, is one edit, a new title or body included; with `--claim` the held check comes first and a held pull request is not edited at all |
| `pr body <n>` | the body as plain text |
| `pr files <n>` | `{ pr, files: [path] }` |
| `checks <sha>` | `{ sha, state: none\|pending\|success\|failure, runs: [{ name, state, url }] }`, judged on the deciding workflows only |
| `threads <n> [--unresolved]` | `[{ id, resolved, path, line, comments: [{ author, body, createdAt }] }]` |
| `threads --resolve <id> --body <text>` | `{ id, resolved: true, changed }`; replies once, then resolves |
| `claim take\|release <n> [--takeover]` | `{ pr, claimed, changed }`, or `{ pr, claimed: false, held: true }` when take finds the claim already standing |
| `factor set\|clear <n> --name <f>` | `{ pr, factor, set }`; the claim is never a factor |
| `comment <n> --body-file <f>` | `{ pr, url }` |
| `notes <n>` | `[{ id, kind: comment\|review, author, authorRole: owner\|member\|other, state?, body, inline?, createdAt, url }]`, oldest first |
| `merge <n> --method squash\|merge\|rebase` | `{ pr, state, mergeCommit }` |
| `events <n>` | `[{ id, event: labeled\|unlabeled, label, createdAt }]` |
| `issue list` | `[issue]`, the open issues carrying the queue label (`operator_config` `issues`), oldest first; `[]` when the project has no issue queue. The `closingPrs` of an issue that is trusted, or that an account able to triage labelled at some point, include the pull requests whose body closes it on any base; any other issue's only those the platform links |
| `issue view <n>` | `issue` with every comment, its `closingPrs` including pull requests whose body closes it on any base |
| `issue comment <n> --body-file <f>` | `{ issue, url }` |
| `issue close <n> --reason completed\|not_planned --body-file <f>` | `{ issue, state: closed, changed }`; the file is the closing comment, and an issue already closed is left as it is |

`pr` = `{ number, url, title, body, draft, state: open|merged|closed, head: { ref, sha }, base: { ref },
mergeable: clean|conflicting|unknown, labels, milestone, createdAt, author, closes }`; `closes` lists the issue
numbers the body closes with a closing keyword (`Closes #12`, `Closes owner/name#12` or the issue's URL for
this repository on its host, never another's) outside code and HTML comments, read from the body because a platform may
link them only on its default branch.

`issue` = `{ number, url, title, body, state: open|closed, stateReason, labels, author, authorRole, createdAt,
revisedAt, trusted, trust, closingPrs: [{ number, state: open|merged|closed, editedAfterMerge }], comments? }`;
`editedAfterMerge` says a merged pull request's body changed at or after its merge, so it is no evidence of
what the merge closed; `revisedAt` is the
latest of its creation, text edit, title rename, queue-label application, and an owner's or member's comment
(among the latest 100, added or edited) that is not the pipeline's own, so nobody else's comment changes it;
`comments` (`issue view` only) = `[{ id, author, authorRole, body, createdAt, url }]`.

**Trust.** An issue's text is a task an agent carries out with the right to push, and on a public repository
anyone may open one. `trusted` is true only when its author speaks for the project (`allowedAuthors`), or
when the queue label's latest application was made by an account that can triage the repository - a label an
issue template applies is applied for its author - and neither the text nor the title changed after it. An
edit in the same second as the label counts as after it.
`trust` says which, or why not; applying the label again trusts an edited text. A skill reads only the
comments whose `authorRole` is `owner` or `member`.

`--takeover` is the one way past a standing claim, and a skill uses it only where `operator-contract`
lets a run take over its own earlier claim or a stale one.

## Exit codes

| Code | Meaning |
|---|---|
| 0 | done; the answer is on stdout |
| 2 | usage: unknown subcommand, a flag the subcommand does not take, a missing or empty option value, no operator configuration |
| 3 | held: the claim already stands and this call did not take it |
| 1 | the platform failed; its message is on stderr |

## Configuration

The script reads the operator configuration from `OPERATOR_CONFIG` (the file profile
`operator_config` names): the processing label, `ciWorkflows` (the workflows whose runs decide a
commit) and `allowedAuthors` (the author associations that speak for the project). A project sets the
variable in its `forge_cli` value. The schema, its required keys and their defaults are
`operator-config.md`; a file missing a required key is refused with exit 2, naming the key.

## Contract test

`scripts/forge-contract.mjs` exports `assertShape(kind, value)` for every answer shape above. An
implementation's own tests run its subcommands against a stand-in for the platform and pass each
answer through it, so every implementation is held to the same shapes.
