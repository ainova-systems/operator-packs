# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Fixed

- The forge script asks a read again, up to three times, when the call meets a network fault between the host and the forge (connection reset, TLS handshake timeout, a 502/503/504); a write is never repeated, so a dropped connection no longer fails a whole discovery run.

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
