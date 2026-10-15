# Working with more than one agent

Corridra is built by two coding agents plus the owner: **Claude Code** (web and desktop) and **Codex** (web). Both read this repository and neither remembers the other's session. The repository is the only shared memory. This file is the protocol that keeps both agents aligned with one product vision.

## Rules for every agent, every task

1. **Read first.** `AGENTS.md`, `docs/START_HERE.md`, [UI direction](ui-direction.md) for any visible change, and the last ten entries of the [work log](work-log.md). Fetch `origin/main` and check open PRs before editing.
2. **One design authority.** All visible work follows [ui-direction.md](ui-direction.md). Do not invent a new colour, font, spacing value, component or tone. If the direction is missing something, add it there in the same PR, with the reason, instead of improvising locally.
3. **Document as you finish, in the same PR.** Append one entry to [work-log.md](work-log.md) using the template below. An entry that says what changed but not why, or that overstates what was verified, is a defect.
4. **Never rewrite the other agent's history.** The log is append-only. To correct an earlier entry, add a new entry that references it.
5. **Report evidence, not intent.** Name the exact commands run and their results. State what was not run. Keep "implemented", "tested", "deployed" and "externally approved" separate.
6. **When the two agents conflict,** do not pick silently. Record both positions in the log and leave the decision to the owner.
7. **The backbone is not UI scope.** Domain packages, API handlers, authentication, RLS, migrations, money, evidence and permission rules, and the production gates change only with an explicit owner request and an ADR where `AGENTS.md` requires one.

## Work log entry template

```
## YYYY-MM-DD, <agent>, <short title>
- Request: what the owner asked, in their words where possible.
- Why: the problem or decision behind it.
- What changed: files and behaviour, grouped by purpose.
- How it was verified: exact commands and results. Not run: ...
- Preserved: contracts, tests, routes, permissions that were deliberately left alone.
- Decisions and trade-offs: including options rejected and why.
- Open items and risks: what is still wrong or unverified.
- Next step: one concrete action for whoever picks this up.
- PR / commit: link and head SHA.
```

## Where things live

| Need                                  | File                                    |
| ------------------------------------- | --------------------------------------- |
| Current programme status              | `docs/implementation/current-plan.md`   |
| What the UI must look and behave like | `docs/agents/ui-direction.md`           |
| What each agent did and why           | `docs/agents/work-log.md`               |
| Full UX10X requirement set            | `docs/ux10x/master-handoff.md`          |
| Coverage evidence                     | `docs/ux10x/reconciliation-2026-10-15/` |
