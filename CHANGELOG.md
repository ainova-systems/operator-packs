# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

The operator pack moved here from intelligence-dev-packs, unchanged; its history came with it.

### Changed

- The operator profile keys moved from core's profile template into the operator pack (`packs/operator/templates/operator-project-profile.md`), together with `flow_plan` and `judge_runner`, which only the operator skills read; a project that already has them in its profile changes nothing.
- The pack validator checks the operator pack's `ai:*` labels against its own `pr-state` page and its profile keys against its own schema, so the pack validates without core.
- Operator: the new profile key `direct_lane` names the documents that need no reviewed pull request. Intake and clarify commit a queue record straight to the integration branch only when it matches, and clarify merges a clarification pull request on its own only when every changed path matches. The default `none` matches nothing: queue records go through a pull request, and clarify asks the owner to set the key instead of merging.

**Updating:** a project that installed `@ainova-systems/operator` from intelligence-dev-packs adds this repository as a registry (`intelligence registry add https://github.com/ainova-systems/operator-packs.git`), then removes and adds the package again (`intelligence package remove` / `package add @ainova-systems/operator`), so its lock points here.
