# Contributing

Contributions are welcome: new scenario packs, skill refinements, fixes to the forge implementation, better wording.

## Repository layout

Content lives in packs under `packs/<flow>/` (`skills/`, optional `rules/`, `agents/`, `templates/`). A **pack** is one Operator flow and its adoption unit, named after the flow and installed as `@ainova-systems/operator-<flow>` (`development` is pull-request delivery); a **domain prefix** (`operator-`) is a namespace on each artifact. Root holds the OSS furniture: README, LICENSE, CHANGELOG, `index.yaml`, `scripts/`, `.github/`.

The core and spec packs the scenario packs build on live in [intelligence-dev-packs](https://github.com/ainova-systems/intelligence-dev-packs); this repository holds only what the Operator runtime runs.

## The bar for pack content

Every artifact must pass one test: **would this apply unchanged to any repository that runs this scenario?**

- No project names, stacks, file paths, or business logic. Project-specific knowledge belongs in the host project's own intelligence sources.
- Project variability goes through the project profile - each pack's own keys in its `templates/<prefix>-project-profile.md` - and, for the runtime's structured settings, the pack's configuration file, never into artifact text. If a new skill needs a project-specific value, add a profile field with a default.
- A pack runs without core: a key it shares with core's profile schema is restated in its own schema with core's default and meaning, and a step core would do is a delegated-step key whose default names the core skill.
- Prefer one strong default over a menu of options. The pack encodes an opinionated practice, with the profile as the escape hatch.

## Conventions

- Every rule, agent, and skill name starts with a known domain prefix (`operator-`). The validator checks each artifact against that set; introduce a new domain by adding its prefix to `KNOWN_PREFIXES` in `scripts/validate-pack.sh`.
- Skills: a folder in `skills/` whose name matches the `name:` frontmatter of its `SKILL.md`. Self-contained steps, a `Verify` section, a `Scope / hand-off` section, and a `Constraints` section for true invariants.
- The `ai:*` label vocabulary is defined once per pack (the development pack's `skills/operator-contract/references/pr-state.md`) and only cited elsewhere; the validator fails a label the definition page does not name.
- References are written in backticks, and the validator depends on it - it has no other way to tell a reference from prose. A profile key appears as `` `qa_status` `` or `` `qa_status: none` ``, and as ``profile `qa_status` `` when naming the lookup. An artifact is named the same way (`` `operator-verify` ``), and every such name in a domain this repository holds must resolve to a real rule, agent, skill or template. Names of core skills are defaults a pack does not need, so they are not checked here.
- Scripts are plain Node.js with no dependencies, and each ships a `*.test.mjs` beside it that runs under `node --test`.
- Frontmatter follows the [Intelligence engine conventions](https://github.com/ainova-systems/intelligence) so the pack renders cleanly to every supported tool.

## Adding a pack

Create `packs/<name>/` with its skills (and `templates/<prefix>-project-profile.md` for its profile keys); add a row to the root README; declare it in `index.yaml` so it is installable by name. `bash scripts/validate-pack.sh` must pass - it validates every pack, and fails a pack the registry index does not declare.

Split by adoption boundary, not by concern: a new pack is justified only when it is a scenario someone would run without the others.

## Workflow

1. Branch from `main`.
2. Make the change; run `bash scripts/validate-pack.sh` and `node --test packs/*/skills/*/scripts/*.test.mjs`.
3. Update `CHANGELOG.md` under `[Unreleased]` in the same change.
4. Open a PR. Commit messages: one line, capital first letter, past tense, no `Co-Authored-By` or other generated trailers.

## Releases

Cut by the maintainer, from `main`, tagged `vX.Y.Z`. Every PR fills `[Unreleased]`, so a release mostly promotes it - but the section is first reconciled against `git log <last-tag>..HEAD`, so nothing that shipped is missing from it.

1. Promote `## [Unreleased]` to `## [X.Y.Z] - YYYY-MM-DD`, keeping the one-line headline under the heading. SemVer; pre-1.0, breaking changes bump the minor.
2. Commit the promotion to `main`.
3. Tag it annotated (`vX.Y.Z`, message `X.Y.Z - <headline>`) and push the tag.
4. `gh release create vX.Y.Z --verify-tag --notes-file <the new section>`.

## Code of conduct

Be professional and constructive. Disagreements are about content, never people.
