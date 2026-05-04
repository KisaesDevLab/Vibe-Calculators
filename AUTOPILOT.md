# Vibe Calculators — Build Autopilot

You are Claude Code. This document is your operating procedure for building Vibe Calculators autonomously, phase-by-phase, until the application is code-complete.

You will work from the authoritative build plan in `CLAUDE.md`. You will not deviate from it without explicit human permission. You will not advance past acceptance gates without explicit verification. You will write tests before claiming items "done." You will stop and ask when blocked, instead of plowing forward with bad assumptions.

---

## 1. Mission

Build Vibe Calculators per `CLAUDE.md`, executing phases 1 through 25 in order. For each phase:

1. Implement every checklist item.
2. Write tests for every item that has a testable behavior.
3. Run the full test suite and confirm it passes.
4. Verify the phase's stated **Acceptance** criteria pass demonstrably.
5. Record results in `PHASE_LOG.md`.
6. Open a pull request for human review (if a remote is configured) **OR** stop for human sign-off when sign-off is required.
7. Only then advance to the next phase.

A "fully developed app" for this autopilot means **all 25 phases are code-complete with their acceptance criteria demonstrably passing in CI**. It does **not** mean "deployed to production hardware" — that is a separate operational step (Phase 25 produces the artifact; deploying it is the operator's job).

---

## 2. Required reading at session start

Every session — including resumed sessions after interruption — begins with these reads, in this order:

1. `CLAUDE.md` (the authoritative build plan)
2. `AUTOPILOT.md` (this document)
3. `PHASE_LOG.md` (build state — create with a template if it does not exist)
4. `git log --oneline -50` (recent activity)
5. `git status` (uncommitted state)
6. `git branch --show-current` (where am I working)

Only after these reads may you make any decision about what to do next.

---

## 3. Initial bootstrap (only if starting from empty repo)

If `git log` returns "fatal: your current branch does not have any commits yet" or the repository is otherwise empty:

1. Initialize git: `git init`
2. Create `.gitignore` covering: `node_modules/`, `dist/`, `build/`, `.env`, `*.log`, `.DS_Store`, `coverage/`, `pgdata/`, `redisdata/`, `pdf-output/`, `data/`
3. Create `PHASE_LOG.md` with the template from §10 of this document
4. Create the initial branch structure: `main` is protected; create `phase/01-scaffold` for the first phase's work
5. Make an initial empty commit on `main`: `git commit --allow-empty -m "chore: initial commit"`
6. Begin Phase 1

Otherwise, proceed to §4 (Resumption Protocol).

---

## 4. Resumption protocol

After completing the §2 reads, determine the resume point using this decision tree:

```
Is there an open phase branch (phase/NN-*)?
├── YES → Is the working tree clean?
│       ├── YES → Continue execution at the first incomplete item of that phase
│       └── NO  → STOP. Print: "Working tree dirty on phase branch — human must
│                  decide whether to commit, stash, or discard." Exit.
└── NO  → What is the highest-numbered phase marked "✅ COMPLETE" in PHASE_LOG.md?
         ├── That number is N → Begin phase N+1 by creating branch phase/(N+1)-*
         └── No phases complete → Begin Phase 1 (this is a bootstrap)
```

**Never** assume an item is done because the code looks present. Use `PHASE_LOG.md` as the single source of truth. If PHASE_LOG and the code disagree, STOP and ask.

---

## 5. Per-phase protocol

For each phase you execute:

### 5.1 Phase entry checklist

Before writing any code for the phase:

- [ ] Re-read the phase's full text from `CLAUDE.md`. Quote the **Goal** and the **Acceptance** criteria into the new `PHASE_LOG.md` entry verbatim.
- [ ] Confirm all prerequisite phases are marked ✅ COMPLETE in `PHASE_LOG.md`. If not, STOP — never run a phase out of dependency order.
- [ ] Create a feature branch `phase/NN-short-slug` (e.g., `phase/01-scaffold`, `phase/07-cashflow-engine`).
- [ ] Use the `TodoWrite` tool (or write `PHASE_LOG.md`'s pending-items list) to enumerate every checklist item from the phase as a separate todo. One item = one todo = one or more atomic commits.
- [ ] Write the phase entry's "Started" timestamp to `PHASE_LOG.md` and commit (`chore(phase-NN): begin phase NN`).

### 5.2 Item-by-item execution

Execute each phase item per the **Per-item protocol** in §6.

Work items in the order written in `CLAUDE.md`. Do not parallelize. Do not skip ahead. If you discover that an item depends on a later item, STOP and ask the human whether to reorder.

### 5.3 Phase exit checklist

After every item is checked off:

- [ ] Run the full test suite from the repo root. All tests must pass — including tests from prior phases (no regressions).
- [ ] Run `pnpm typecheck` across all workspaces. Zero errors.
- [ ] Run `pnpm lint` across all workspaces. Zero errors, zero warnings (warnings are errors for this project).
- [ ] Build all workspaces: `pnpm -r build`. All builds succeed.
- [ ] Verify each bullet of the phase's **Acceptance** criteria with a concrete demonstration (a test run, a script execution, a screenshot for UI phases). Quote the verification commands and their abbreviated outputs into `PHASE_LOG.md`.
- [ ] If the phase is in the "human-gated" list (§9), STOP. Print a clear summary and wait. Do not advance.
- [ ] If the phase is autonomous-OK: mark it ✅ COMPLETE in `PHASE_LOG.md`, write the "Finished" timestamp, list every commit hash that was part of the phase.
- [ ] Merge the phase branch into `main` with a merge commit `feat(phase-NN): complete phase NN — <phase title>`. Tag the merge commit `phase-NN-complete`.
- [ ] Begin the next phase per §5.1.

---

## 6. Per-item protocol

For each checklist item within a phase:

### 6.1 Plan

Write one paragraph (in your reasoning, not necessarily to disk) covering:
- What files will I touch?
- What tests will I add?
- What is the smallest implementation that satisfies the item as written?
- Are there dependencies on other items I have or have not yet completed?

If the answer to "smallest implementation" feels larger than ~200 lines of new code, STOP and consider whether the item should be split. If it should be split, propose the split to the human and wait.

### 6.2 Implement

Write production code first, tests second, **then** verify both compile and pass. Do **not** write a stub and commit it. Do **not** write tests against unimplemented code (red-then-green is fine, but never commit while red).

### 6.3 Test

Every item with observable behavior gets at least one test. Use the testing convention of the surrounding code (Vitest for TS packages, integration tests for API routes, Playwright for end-to-end frontend flows in later phases).

For math-heavy items in `packages/calc-engine` and `packages/tax-engine`, use **property-based testing** (`fast-check`) where applicable, plus fixture-based regression tests where the build plan calls for them.

### 6.4 Verify

Run, in this order, scoped to the item's workspace:

1. `pnpm typecheck` — zero errors
2. `pnpm lint` — zero errors, zero warnings
3. `pnpm test` — all tests pass
4. Re-run the **full** repo test suite when finishing the last item before phase exit (§5.3)

If any check fails, follow the **Failure escalation ladder** (§7).

### 6.5 Commit

One item = at least one atomic commit. Commit messages follow Conventional Commits:

- `feat(scope): brief description (phase-NN.item-NN.NN)`
- `test(scope): brief description (phase-NN.item-NN.NN)`
- `fix(scope): brief description (phase-NN.item-NN.NN)`

Example: `feat(calc-engine): implement 30/360 day-count helper (phase-05.5.3)`

### 6.6 Update progress

Mark the item ✅ in `PHASE_LOG.md`'s in-progress phase entry. Include the commit hash(es).

---

## 7. Failure escalation ladder

When something fails — a test, a typecheck, a lint, an acceptance criterion — do **not** thrash. Follow this ladder:

| Attempt | Action |
|---|---|
| 1 | Read the failure message carefully. Form a specific hypothesis. Apply a targeted fix. |
| 2 | If attempt 1 didn't work, the hypothesis was wrong. Read the failing code, the test, and any related files end-to-end. Form a new hypothesis. Try again. |
| 3 | If attempt 2 didn't work, you may be missing context. Use search tools to find related code patterns. Re-read the relevant section of `CLAUDE.md`. Try again. |
| 4 | Write a brief root-cause analysis to `PHASE_LOG.md` under a "Stuck" subsection: what you tried, what failed, what you currently believe the cause is. **STOP**. Print the analysis and wait for human input. |

**Never** disable a failing test to make CI pass. **Never** delete a test you wrote earlier in the same phase to "simplify." **Never** add `// @ts-ignore`, `eslint-disable`, or `expect.assertions` workarounds without writing a `// FIXME(phase-NN.item-NN):` comment explaining why and adding a tracking item to `PHASE_LOG.md`.

If the failure is in a prior phase's code (a regression), STOP immediately. Do not modify prior-phase code without sign-off — regressions in prior phases mean either your current item has an undocumented dependency or the prior phase had a latent bug. Either case requires human judgment.

---

## 8. Test discipline (non-negotiable rules)

These rules apply to every phase. Violations require rolling back the offending commits.

1. **No skipped tests.** `it.skip`, `describe.skip`, `xit`, `xdescribe`, `test.todo` are banned in committed code unless paired with a human-approved tracking entry in `PHASE_LOG.md`.
2. **No commented-out tests.** If a test is wrong, fix it or delete it with a commit message explaining why.
3. **No floating-point money.** Lint enforces this in `packages/calc-engine` and `packages/tax-engine`. Don't fight the lint rule.
4. **No real network calls in tests.** Use mocks/fixtures. The only exception is the explicitly-marked nightly drift-check job in Phase 23.
5. **No real secrets in code or fixtures.** API keys, passwords, customer data — never. Use `.env.example` patterns and fixtures with synthetic data.
6. **No silent test reductions.** If you find yourself reducing test coverage to make CI pass, STOP. Coverage drops are a signal, not an inconvenience.
7. **Regression fixtures are sacred.** Phase 7, 8, 9, 10, and the per-tax-calculator fixtures are correctness anchors. Never modify an expected value without writing a human-readable justification in `PHASE_LOG.md` AND obtaining sign-off. "The test was failing" is not a justification.
8. **Determinism.** Tests that depend on `Date.now()`, `Math.random()`, or external state must inject those dependencies. Flaky tests are bugs.

---

## 9. Phases requiring human sign-off before advancing

Some phases produce artifacts the autopilot cannot itself validate. For these, after the phase exit checklist passes, you must STOP and wait for the human to confirm before creating the next phase branch.

| Phase | Reason human sign-off is required |
|---|---|
| 1 | Initial Docker stand-up needs to be verified on the human's machine (port bindings, volume mounts, host OS specifics). |
| 10 | The TValue golden-file regression suite requires real `.tv6` reference files curated by a human. The autopilot cannot synthesize these. |
| 13 | PDF output rendering needs human visual review against the brand spec. |
| 14 | Tax-year rate tables must be cross-checked by a human CPA against the IRS source documents — autopilot cannot validate legal/tax accuracy. |
| 16, 17, 18, 19 | Each tax-calculator phase requires human spot-check of regression fixtures against IRS publications. Math correctness is testable; *interpretation* of IRS rules is not. |
| 22 | SMTP and AFR-fetch require live external services; human must provide credentials and verify delivery. |
| 23 | Anthropic API key required from human. Privacy/redaction settings must be confirmed by human before any cloud calls. |
| 25 | Final appliance smoke test on real target hardware (NucBox M6-class) must be performed by a human. |

When you reach a human-gated phase exit, write a structured summary to `PHASE_LOG.md` under that phase's entry containing:
- What was implemented (high-level)
- What tests pass
- What specifically needs human verification (a checklist the human can run through)
- The exact commands to run for verification

Then STOP. Do not begin the next phase.

For non-gated phases, you may automatically advance.

---

## 10. PHASE_LOG.md format

Maintain a single `PHASE_LOG.md` at the repo root. Append-only — never delete prior entries. Format:

```markdown
# Vibe Calculators — Phase Log

## Phase 01 — Repository scaffold, monorepo layout, Docker baseline
- **Status:** ✅ COMPLETE
- **Started:** 2026-05-04T13:22:11Z
- **Finished:** 2026-05-04T18:47:03Z
- **Branch:** phase/01-scaffold (merged to main as a1b2c3d)
- **Tag:** phase-01-complete
- **Goal (from CLAUDE.md):** "a `docker compose up` that boots an empty but healthy app shell..."
- **Acceptance (from CLAUDE.md):** "`just up` on a fresh laptop produces a working `/health` page; `/api/health` reports DB and Redis connected; CI pipeline green."
- **Items:**
  - [x] 1.1 Monorepo with pnpm workspaces — commits: `e1f2a3b`
  - [x] 1.2 Root package.json with engines — commits: `c4d5e6f`
  - ... (every item with its commit hash(es))
- **Acceptance verification:**
  - `just up` produced /health page: ✅ (verified by curl http://localhost/health → 200)
  - /api/health reports DB+Redis: ✅ (response: `{"status":"ok","dbConnected":true,"redisConnected":true}`)
  - CI pipeline green: ✅ (run #42, all checks pass)
- **Human sign-off:** received from kurt@kisaes.dev at 2026-05-04T19:30:00Z

## Phase 02 — Authentication, users, sessions, RBAC
- **Status:** 🚧 IN PROGRESS
- **Started:** 2026-05-04T19:35:00Z
- **Branch:** phase/02-auth
- **Items:**
  - [x] 2.1 Drizzle schema — commit: `g7h8i9j`
  - [ ] 2.2 Roles permission matrix
  - ...

## Phase 03 — ... (placeholder until started)
- **Status:** ⏳ NOT STARTED
```

Status values: `⏳ NOT STARTED`, `🚧 IN PROGRESS`, `🛑 BLOCKED (awaiting human)`, `✅ COMPLETE`.

---

## 11. Forbidden actions

You may **never**:

1. Modify `CLAUDE.md` (the build plan). If you believe the plan has an error, write a proposed amendment to `PROPOSED_AMENDMENTS.md` and STOP.
2. Modify `AUTOPILOT.md` (this document). Same procedure as above.
3. Skip a phase, even if it seems "easy" or "covered by another phase."
4. Combine phases into a single branch or commit.
5. Disable, skip, or delete tests to make CI pass.
6. Add `@ts-ignore`, `eslint-disable`, or `any` casts without a `FIXME(phase-NN.item-NN):` comment and a `PHASE_LOG.md` tracking entry.
7. Commit secrets, API keys, real customer data, or copyrighted reference materials (e.g., a `.tv6` file from a real engagement).
8. Force-push to `main` or any tagged phase branch.
9. Resolve merge conflicts by deleting tests or implementation code wholesale. Conflicts require careful manual resolution.
10. Run destructive operations (`rm -rf`, `DROP DATABASE`, `git reset --hard origin/main` on local work) without first asking the human.
11. Install dependencies not pinned to a specific version. Use exact versions in `package.json` (no `^` or `~`) for runtime dependencies; dev dependencies may use `^`.
12. Replicate any other product's UI, visual design, color palette, iconography, or labeling. Functional capability matching is fine; visual matching is not. (See `CLAUDE.md` §"UI / intellectual-property principle.")
13. Use AI-generated content as a regression fixture's expected value. Fixtures must come from authoritative sources (IRS publications, hand-computed examples, real `.tv6` files in the private fixture corpus).
14. Build Phase 23's regression fixtures from synthetic loan-agreement excerpts that you generated yourself. The fixtures must be human-curated.

---

## 12. Stop conditions

Stop and wait for human input — do not proceed — when any of the following occur:

1. The failure escalation ladder (§7) hits attempt 4.
2. You reach a human-gated phase exit (§9).
3. You discover a contradiction between `CLAUDE.md` and the code that already exists.
4. A regression test from a prior phase fails as a side effect of current work.
5. An item as written is ambiguous, and you cannot pick a single defensible interpretation.
6. You find an item that requires external resources (an API key, a credential, hardware access, a license file) that you do not have.
7. The user has interrupted the session with a new instruction.
8. You believe `CLAUDE.md` itself contains a defect (proposed amendments go to `PROPOSED_AMENDMENTS.md` per §11.1).
9. Disk space, memory, or another system resource is critically low.
10. The git working tree contains uncommitted changes you didn't make this session.

When stopping, print a structured "Autopilot stopped" message containing:
- Current phase and item
- Reason for stopping (referencing the specific rule above)
- What was completed in this session
- What the human needs to provide or decide
- Exact commands the human can run to verify your state

---

## 13. Reporting / output format

While running, your assistant-visible output should follow this rhythm:

- **At session start:** print a one-paragraph summary of where the resumption protocol landed you and what you intend to do next.
- **At each item start:** print "Beginning item X.Y: <title>" and your one-sentence plan.
- **At each item end:** print "Item X.Y complete. Commits: <hashes>. Tests: <count> added, <count> total passing."
- **At each phase end:** print the full phase summary including the acceptance verification table.
- **At each stop:** print the structured "Autopilot stopped" message from §12.

Be terse. Avoid celebratory language. The human is reviewing logs, not reading a story.

---

## 14. Long-running session handling

If the session approaches context limits or is otherwise about to terminate:

1. Commit any in-progress work with a `WIP` prefix in the commit message.
2. Update `PHASE_LOG.md` with current state.
3. Print a structured handoff message: current phase, current item, what's been done, what's next, any open hypotheses about an in-flight problem.
4. End the session cleanly.

The next session reads `PHASE_LOG.md` and `git log` and resumes per §4.

---

## 15. End-of-build protocol

When Phase 25 reaches ✅ COMPLETE:

1. Run the full test suite one final time from a clean checkout: `git clean -fdx && pnpm install && pnpm -r build && pnpm -r test`.
2. Run any defined end-to-end / integration tests against a `docker compose up` instance: stand it up, exercise it via the smoke-test script in Phase 25, tear it down.
3. Generate a release-notes document at `RELEASE_NOTES_v1.0.0.md` summarizing every phase, every major capability, and every known limitation.
4. Tag the final commit `v1.0.0`.
5. Append a final entry to `PHASE_LOG.md`: `# Build Complete — vX.Y.Z — <timestamp>` with the SHA of the v1.0.0 tag and a link to the release notes.
6. Print: "Vibe Calculators build complete. v1.0.0 tagged. Awaiting deployment instructions."
7. Stop. Do not begin operating, deploying, or modifying the application past this point.

---

## 16. How to invoke this autopilot

The human invokes this autopilot by running Claude Code in the project root and saying something equivalent to:

> "Read AUTOPILOT.md and continue the build."

Or, for a fresh start:

> "Read AUTOPILOT.md and begin the build from Phase 1."

Or, for a specific phase (advanced — generally reserved for re-running a phase after fixing an issue):

> "Read AUTOPILOT.md and re-run Phase NN. The prior attempt was rolled back to commit <sha>."

You — Claude Code — should treat any of these invocations as authorization to follow this document. You do **not** need to ask the human to confirm individual items, individual commits, or routine per-item decisions. You **do** ask when this document instructs you to ask, and when ambiguity rises to the level described in §12.

---

## 17. Ethical guardrails

You are building a tool that CPAs will use to make recommendations to their clients. Errors in this product cause real financial harm to real people. Therefore:

- When in doubt about correctness, choose the more conservative implementation and flag the choice for human review.
- When IRS guidance is ambiguous, surface the ambiguity in code comments and `PHASE_LOG.md` — do not pick silently.
- When you find an existing bug while implementing a new item, do not "fix it on the way through." Surface it as a separate item, get sign-off, fix it as its own commit. Hidden fixes are how regressions sneak in.
- When the AI extraction phase (23) prompt produces a result you suspect is wrong, default to surfacing low confidence to the user rather than "smoothing it over." A wrong calculation is worse than an obvious "I'm not sure."

---

## 18. Quick-reference summary

When in doubt:

1. Re-read `CLAUDE.md` for the phase you're on.
2. Re-read this document's §5 (per-phase) and §6 (per-item) protocols.
3. If still unclear, STOP and ask.

The build plan is the contract. This document is the procedure. Follow both. When they conflict, the build plan wins; report the conflict to the human and wait.

Begin.
