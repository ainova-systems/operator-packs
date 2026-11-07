# operator-packs

A library of scenario packs for the [Operator runtime](https://github.com/ainova-systems/operator-autopilot). The runtime is generic: it runs the operations a project's `operator.yaml` declares, on timers and triggers, and holds pools, jobs and waits. A scenario pack is what those operations run - the skills that own each phase of one kind of work, each also runnable by hand from an agent session. Each pack is one flow and is named after it: `packs/<flow>`, installed as `@ainova-systems/operator-<flow>`.

Built and maintained by [Ainova Systems](https://www.ainovasystems.com).

## Packs

| Pack | Scenario | Contents |
|---|---|---|
| **development** (`operator-`)<br>`@ainova-systems/operator-development` | Pull-request delivery: a work-queue item through intake, plan, implementation rounds, review, QA verification, the owner's accept and merge, | 7 skills: the run contract and the phase skills the runtime runs (intake, plan, implement, review, verify, merge); the forge contract, its contract test and its GitHub implementation (`forge-github.mjs`, a script, not a skill); its own profile-key schema (`templates/operator-project-profile.md`) |
| **clarification** (`operator-`)<br>`@ainova-systems/operator-clarification` | Clarification: a queue item waiting on an owner decision is settled one question at a time in a documentation pull request, then merged | 1 skill: `operator-clarify`; builds on the development pack's contract, forge script and profile keys |

Each pack's own guide is its `README.md`: [development](packs/development/README.md) (milestones, the flow and what the owner does) and [clarification](packs/clarification/README.md).

## Install

The packs ship as [Intelligence Packages](https://github.com/ainova-systems/intelligence), installed with the Intelligence CLI. Needs Node.js 18+, git, bash and awk.

The Operator runtime itself is the npm package `@ainova-systems/operator`, installed with npm, not with `intelligence package add`.

```bash
npm install -g @ainova-systems/intelligence

cd your-project
intelligence init --targets claude              # claude, cursor, copilot, codex, pi, opencode
intelligence registry add https://github.com/ainova-systems/operator-packs.git
intelligence package add @ainova-systems/operator-development
intelligence package add @ainova-systems/operator-clarification   # optional: the clarification flow, on top of development
```

`init` writes `intelligence.yaml` and `intelligence.lock` - both committed - and renders each enabled tool's native files. `registry add` is what makes this repository's package names resolvable: names resolve only through registries the project has explicitly trusted, so nothing installs from a guessed URL. `package add` records the name and pins the resolved tag and commit in the lock.

### Core packs: recommended, optional

Every step the development pack delegates - committing, opening the pull request, review, verification, review threads, the outcome, merging, returning a slot to the integration branch - defaults to a skill of the core pack from [intelligence-dev-packs](https://github.com/ainova-systems/intelligence-dev-packs). For a clean start install it beside this one:

```bash
intelligence registry add https://github.com/ainova-systems/intelligence-dev-packs.git
intelligence package add @ainova-systems/core
```

Then run `dev-init` so the project profile, the `ai:*` labels and the PR template are in place. A project that already has its own equivalents points the operator's profile keys at them instead and skips core.

## Set up

1. **Profile keys.** Add the keys you set to the project profile (with core installed, its `dev-project-profile.md` rule). Every key, its default and its meaning is in [`packs/development/templates/operator-project-profile.md`](packs/development/templates/operator-project-profile.md); a key left out takes its default.
2. **Operator configuration.** Write the JSON file profile `operator_config` names - milestone and label roles, owner author associations, slots, QA admission, CI workflows, markers. Schema: [`operator-config.md`](packs/development/skills/operator-contract/references/operator-config.md); example: [`operator-config.example.json`](packs/development/skills/operator-contract/references/operator-config.example.json).
3. **Forge.** Point profile `forge_cli` at the forge contract command; on GitHub that is the pack's `forge-github.mjs` ([contract](packs/development/skills/operator-contract/references/forge-contract.md)). The script and its tests need Node.js 18+ (built-in modules only, no npm dependencies) and the GitHub CLI `gh`, authenticated for the repository; CI runs them on Node.js 24.
4. **Discovery.** Provide the project's discovery command in profile `operator_discover` ([contract](packs/development/skills/operator-contract/references/discovery-contract.md)). With `--standalone` it names the next skill for each pull request, which is how the flow runs by hand without the runtime.
5. **Runtime.** Declare the operations in the project's `operator.yaml` and start the [Operator runtime](https://github.com/ainova-systems/operator-autopilot).

## Versioning

Semantic versioning, history in [CHANGELOG.md](CHANGELOG.md). Versions are this repository's git tags; a project's range resolves against them and its lock pins the resolved commit.

## License

MIT. Copyright 2026 Ainova Systems.

---

Created by **[Dmitrij Zykovic](https://www.linkedin.com/in/dmitrijz/)** - Fractional CTO at [Ainova Systems](https://www.ainovasystems.com).

Helping engineering teams adopt AI-First SDLC and build autonomous AI engineering pipelines.

[LinkedIn](https://www.linkedin.com/in/dmitrijz/) · [Advisory & Consulting](https://www.ainovasystems.com)
