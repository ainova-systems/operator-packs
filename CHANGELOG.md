# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
