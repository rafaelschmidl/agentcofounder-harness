# Collaboration workflow

`main` is the shared, trusted, mutually approved state of both AgentCofounder repositories. The normal path is:

work branch → Draft PR when useful → ready for review → teammate reviews the final state → deterministic checks pass → squash merge into `main` → delete the branch when appropriate.

## Working conventions

- Branches represent coherent workstreams, not a required feature taxonomy. Feature, milestone, experiment, refactor, architecture, and evaluation branches are all fine.
- Start from the latest `main`, commit freely while exploring, and open a Draft PR early when visibility helps. Mark it ready only when it is an integration candidate.
- Rafael and Jones should review one another's work. The author should not treat their own approval as the teammate's approval.
- Review depth should match risk. Architecture, interfaces, model execution, evaluation methodology, important abstractions, and project direction deserve deeper review than a tiny obvious fix.
- For a workstream that substantially changes architecture, an important interface, evaluation methodology, or overall direction, briefly communicate the intended direction asynchronously before substantial implementation. This is not a meeting or a formal design review.
- A workstream may span both repositories. The repositories remain independent; matching branch names are optional, and related PRs should link to one another.
- Experiments may remain experimental, become a PR, contribute selected work elsewhere, or be discarded.

## Shared-main gate

The repositories are private and use GitHub Free. The intended lightweight gate is a PR into `main`, one teammate approval of the final reviewable state, resolved blocking conversations, passing required deterministic checks, no force-push or deletion of `main`, and no direct push that skips review. On this plan these are team conventions rather than fully enforceable GitHub branch-protection rules; verify them in the PR before merging.

The configured repository merge setting is squash-only. Squash merges keep experimental branch history out of shared `main` while preserving one coherent integration commit per PR.

The deterministic PR checks are the repository's real, local, non-model commands. They do not require provider credentials, network-dependent model execution, or the independent evaluator's full methodology.
