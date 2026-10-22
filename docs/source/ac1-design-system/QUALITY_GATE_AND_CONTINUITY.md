# AC/1 — Design governance and agent-independent acceptance

## Acceptance roles

- **Owner (art direction)**: decides whether page looks and reads like a distinctive Corridra work instrument; signs off explicit compositions after real reference comparison. Cannot be replaced by an AI agent's self-score.
- **Implementation agent (Codex or Claude Code)**: implements one bounded work package and attaches evidence. May not expand scope or replace the brand language.
- **Technical reviewer / CI**: verifies controls, run-time states, auth, tests, accessibility, responsive behaviour, and deployment at exact SHA.
- **Task user**: performs realistic use under relevant language and skill conditions; observed difficulty feeds design iteration.

## Five layers of gates

| Gate | Binary release condition | Evidence |
|---|---|---|
| Identity | Only AC/1 colours and semantic states; one canonical action grammar; intentional type hierarchy | Token diff, CSS consumer audit, component screenshots |
| Interaction | Every new/changed control provides consistent affordance and succeeds/fails truthfully | Browser tests, keyboard walk, state matrix |
| Commercial truth | Original source, uncertainty, role scope, currency, stage and outcome never hidden by aesthetics | Source-to-UI fixtures, no invented verified states |
| Preservation | Existing authorised routes/actions, drafts, custom configurations, RLS, deep links and denial handling survive | Parity matrix, DB + E2E regression, rollback |
| Art direction | Human reviewer approves public, mission, sourcing, delegation, operator compositions | Annotated review with dated accepted screenshot at each width |

## Anti-template review: pass/fail questions (owner review)

1. Can this screen be mistaken for a generic dashboard template with a different logo? If yes: fail.
2. Do content order and spatial structure reflect the actual work? If no: fail.
3. Are type hierarchy, negative space, alignment and button states consistent at 1440/390/320? If no: fail.
4. Does the same evidence/source/verification label mean precisely the same thing across compositions? If no: fail.
5. Are there decorative cards, pastel icon blocks, unsupported metrics, stock photos, gradient fog, vanity maps or repeated pill clusters without a task explanation? If yes: fail.
6. Can a blind or keyboard-only user navigate to and complete the critical action? If no: fail.
7. Is information missing, unavailable, self-declared, reviewed, verified, or accepted clearly differentiated? If no: fail.
8. Are noncanonical extra button classes / raw palette values introduced? If yes: fail.
9. Does the phone interface preserve all functionality, original currency, scope and sources without microtype or page-wide overflow? If no: fail.
10. Are route permissions and trusted actions enforced by server, not by visibility? If no: fail.

**Art direction requires an affirmative human sign-off**, and cannot be made objectively 100% guaranteed by a specification. Use negative evidence: if a reviewer can point to an exact generic pattern, require a corrected composition, not a superficial reskin.

## Representative screen acceptance set

For each of the five compositions, test both **empty and populated** states with fully synthetic data. Minimum breakpoint references: 320, 390, 768, 1440; inspect 1024 and 1920 for complex grids. Relevant locales: English, Bangla, Simplified Chinese; high-contrast and reduced-motion; browser zoom. Include hover, keyboard, disabled, denied, expired, loading, stale version, slow network, offline, retry, and long labels.

- Atelier: public home, service choice, corridor, trust and how-it-works.
- Meridian: intake, saved draft, customer home, private mission, shared invitation and sign-in recovery.
- SourceLedger: supplier portfolio, company dossier, RFQ, technical comparison and evidence inspector.
- Encounter: participant overview, organiser agenda, conflicting meetings, venue/timezone, controlled reports.
- Signal: Today queue, case detail, full tool directory, audit, configuration and founder truth.

## Mandatory evidence per PR

`current SHA` · `diff summary` · `tokens touched` · `existing action preservation matrix` · `tests` · `browser screenshots` · `accessibility review` · `cross-role denial` · `source states` · `old/new CSS specificity notes` · `rollback` · `human review status` · `next action`.

Do not commit or deploy a "finished" global theme before its canonical shared primitive and context composition have been accepted. Do not collapse functional code to make the screenshot match. The front end can change while domain records remain byte-for-byte stable.

## Handover between AI coding tools

- Next agent begins by inspecting repo state and ledger. It **must not** trust the prior model's conversational summary.
- Do one bounded change set per branch/PR, update existing `docs/V3_LEDGER.md` and append existing work log.
- Preflight conflicts, active branches and protected environments. Follow existing branch budget and protected deploy workflow.
- Tests and screenshots belong to exact source SHA and environment; a preview screenshot is not a live-authenticated test.
- Existing independent V3 work continues separately; brand migration does not authorise closing other requirements as complete.
