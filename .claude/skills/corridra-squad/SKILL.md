---
name: corridra-squad
description: Conduct the Corridra agent squad for any Corridra build, fix, review or record task. Routes the task to the right agents in the right order, carries one stamped Authority Brief through every stage so no agent works from a superseded plan, enforces single ownership of every file, and drives the PR to merge under the standing owner rules. Use when asked to build, fix, review or ship anything in this repository, or when the user says "squad", "ultracode" or "use the agents".
---

# Corridra squad

The main session is the conductor. It never decides authority, product scope, architecture, design or proof itself; it routes, passes context and merges. Subagents cannot start other subagents, so all routing happens here or in the saved workflow `.claude/workflows/corridra-squad.js`.

## Why nobody works from an old plan

1. No agent file contains plan content: no requirement IDs, PR numbers, switch names, statuses or dates. A docs test (`tests/squad.test.mjs`) fails if one does. Agents hold procedure only, so they cannot go stale when a plan changes.
2. Every run starts with `corridra-authority`, which resolves what governs from the repository at that moment with `node scripts/authority.mjs`: the owner's rule that the latest decision always wins a conflict, which sources can decide at all (a WAITING OWNER proposal or a finished plan never wins by being newer), owner directions in force, and drift between each plan's own `Document status:` line and `docs/PLAN_STATUS.md`.
3. The brief carries a stamp: a hash of the authority files and every governed document's status word. Every later agent recomputes it with `node scripts/authority.mjs stamp` and refuses to work on a mismatch. Code commits do not change the stamp; any change to the ledger, register, contract, vision, standing rules, ADR index or a plan's status word does.
4. Drift is a failure, not a judgement: `node scripts/authority.mjs check` runs in the docs tests, so a plan whose own line and the register disagree, or a plan with no line, or a plan edited after the register gave it a word without a line of its own, fails CI until `corridra-scribe` fixes it from evidence or the owner decides.
5. `corridra-reviewer` only counts a rule as violated when its source is a FOLLOW document in the brief.

## The squad and what each one owns

| Agent                | Layer         | Owns                                                                | Writes                                                         |
| -------------------- | ------------- | ------------------------------------------------------------------- | -------------------------------------------------------------- |
| `corridra-authority` | Orchestration | Which documents govern; the stamped brief                           | Nothing                                                        |
| `corridra-product`   | Product       | Outcome, requirements, what must be preserved, acceptance checks    | Nothing (returns the task packet)                              |
| `corridra-architect` | Engineering   | Approach, files, reuse, blast radius, test plan                     | ADR files and the ADR index only                               |
| `corridra-designer`  | Design        | Screens, states, copy, accessibility, widths; audit of the result   | Nothing (returns spec and audit)                               |
| `corridra-builder`   | Engineering   | All application code, tests and migrations                          | Application code, tests, migrations                            |
| `corridra-verifier`  | Engineering   | Proof: preflight, mandatory gates, CI on the exact head, deployment | Logs and receipts under `work/` only                           |
| `corridra-reviewer`  | Engineering   | Adversarial defect hunt against the brief, packet and plan          | Nothing                                                        |
| `corridra-scribe`    | Orchestration | Shared record and plan status truth                                 | Ledger, work log, register, status lines, known issues entries |

One writer per file. If two stages would touch the same file, they run in sequence.

## Routes

| Task | Stages in order (`||` runs in parallel) |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Documentation or register repair | authority -> scribe -> verifier (docs tests) |
| Tooling or scripts | authority -> architect -> builder -> verifier \|\| reviewer -> scribe |
| Product behaviour, no visible change | authority -> product -> architect -> builder -> verifier \|\| reviewer -> scribe |
| Visible UI | authority -> product -> architect \|\| designer (spec) -> builder -> verifier \|\| reviewer \|\| designer (audit) -> scribe |
| Auth, RLS, roles, money, events, migrations | As product behaviour, with two independent reviewers and a refute pass; the architect's blast radius is shown to the owner before building when the brief's owner directions require it |
| CI failure on a PR | authority -> verifier (diagnose with known issues) -> builder -> verifier -> scribe |
| Review only | authority -> reviewer (two independent passes) -> reviewer (refute each finding) |

## Handoffs

- Pass the full Authority Brief text into every later stage, followed by the outputs of the stages it depends on. Do not summarise the brief.
- Any stage that returns `STALE BRIEF` sends you back to `corridra-authority`; rerun from the first stage whose inputs changed.
- `PLAN CONFLICT` from the builder goes back to the architect (and product, if acceptance is affected). `OWNER DECISION` items go to the owner, stated so they can answer without scrolling back.
- Findings: only `traced` blocking or should-fix findings that survive a refute pass go to the builder. Then rerun verifier and reviewer. Stop after three fix rounds and report what still fails.

## Finishing

1. The scribe's work-log and ledger updates go in the same PR as the change.
2. Push, open a draft PR, watch it. Merge and deploy only as the owner directions in the brief allow, and only when the verifier says READY on the exact head.
3. After the merge, the verifier confirms the deployment for the merged commit; the next run's scribe records it.
4. Clean up branches and preview databases only as the standing rules in `AGENTS.md` allow.

## Running it

- One task, step by step: follow the route above with the Agent tool, `subagent_type` set to the agent name.
- Whole run, deterministic: the Workflow tool with `name: "corridra-squad"` and `args: {"task": "...", "ui": true|false, "sensitive": true|false}`. Workflows need the user's opt-in ("ultracode" or "use a workflow").
- Use the existing checkout. No worktree isolation unless the owner asks for it.
