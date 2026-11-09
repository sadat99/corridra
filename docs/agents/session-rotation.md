# Session rotation

Document status: CURRENT (owner, 9 November 2026)

Owner, 9 November 2026 (relayed by the previous conductor session): "I want to work in new sessions(s5, s6,...etc) only, leaving old s2, s3, s4, to avoid losing tokens unnecessarily. We must set a rules for starting new session with right and correct context before any existing session becomes big to load and cost tokens unnecessarily."

## When a session rotates

A session hands over to a new one, with the next free number (S5, S6, S7 and so on, never reused), when any of these holds:

1. Its context reaches 250,000 tokens (`get_session`, field `external_metadata.context_usage.used_tokens`).
2. It reaches 150,000 tokens and has just finished a unit of work (a PR merged, a review returned, a records PR merged). That is the cheapest moment to rotate.
3. Its lane changes to a different task area, or the owner asks.
4. Its last turn failed and it restarts with a summary of a summary.

The conductor checks every lane session's `used_tokens` after each merge and starts the rotation. A lane session that sees it is past a threshold says so to the conductor in its next message.

## How a session hands over

Nothing in a cloud container survives it, so the old session finishes these steps before it stops:

1. **Commit everything.** Push only to the branch of an open PR it owns, with no force push. Work that belongs to no open PR is not pushed to a new branch (the branch cap is below 9). Instead it goes to the successor as `git format-patch` text, split across several messages if it is over 60 KB.
2. **Send one handoff packet** to the successor (`send_message`), at most about 6 KB plus patches:
   - the lane and the role;
   - the branch, PR number, exact head SHA and CI state;
   - open findings, quoted with file:line;
   - owner decisions that apply, quoted verbatim with their dates;
   - what was verified and how;
   - the next three actions;
   - what must not be done.

   No transcript dumps and no full files.

3. **Stop.** No new branches, PRs or merges after the packet. The old session is archived only after the successor confirms it received the packet. Until then nobody sends it new work.

## What a new session reads, and nothing more

1. `CLAUDE.md`, `AGENTS.md`, then `node scripts/v3-context.mjs` and `node scripts/v3-context.mjs verify`.
2. `docs/V3_LEDGER.md` "Resume immediately" and the current lanes table in `docs/revamp/README.md`.
3. Its handoff packet.
4. Only the known issues, specs, ADRs and code that its task names, read with `node scripts/v3-context.mjs section|outline` where possible. The last work-log entry is found with `grep -n "^### " docs/agents/work-log.md | tail -3`.
5. Never the whole work log, documentation map, history archives or requirement register.

A new session gets a short starting prompt. That prompt points to the documents above and carries only what they do not hold yet.

## Naming and records

- Title: `Corridra V3 Revamp.S<n> <lane>`. Tag: `revamp-lane:S<n>`.
- The conductor updates the lanes table (session id, branch, task) and the ledger's lanes bullet in the next records PR, and writes the rotation in the work log.
- Every lane session sends its messages to the current conductor id in the lanes table.

## Lessons from 9 November

- A fresh Guardian stamp is computed on the exact head when a PR edits authority files (the ledger or work log), so it differs from main's stamp.
- Run the entire browser project (`pnpm test:e2e`) before pushing a UI change: a partial run cost two lanes a CI cycle.
- GitHub runners can abandon shards; rerun the failed jobs once and record the run id (KI-42).
