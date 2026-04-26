---
name: live-pair
description: Use when you want to iterate on a feature interactively with the user watching a running instance — pair-programming rhythm for UI-heavy work, redesigns, copy tightening, layout exploration, or any "let me just show you what I want" session. Not for systematic audit (/live-exercise) or perf-tuning (/live-perf).
---

# /live-pair — Interactive pair-programming with a live instance

Launch the extension. Show the user what's there. Listen for feedback. Edit, rebuild, refresh, show the result. Repeat until the user says done. The user drives; the agent implements. No sweep, no dispatch, no findings doc — just a tight feedback loop.

**This is pair programming with a live UI. One message in → one change (or batch) out → one screenshot back.**

## When to use vs other skills

| Skill            | Driver                            | Change pattern                 | Output               | Exit                        |
| ---------------- | --------------------------------- | ------------------------------ | -------------------- | --------------------------- |
| `/review`        | Static                            | —                              | Review findings      | Diff reviewed               |
| `/deep-review`   | Static                            | —                              | Correctness findings | Diff reviewed               |
| `/ux-review`     | Static                            | —                              | UX findings vs goals | Diff reviewed               |
| `/live-inspect`  | Tool primitive                    | —                              | Ad-hoc observations  | —                           |
| `/live-exercise` | **Agent** (sweeps + classifies)   | Parallel dispatch, batch       | findings / decisions | Three-way convergence       |
| `/live-perf`     | **Agent** (measures + classifies) | Parallel dispatch, batch       | baseline / findings  | Measured + conventions done |
| `/live-pair`     | **User** (conversational)         | **One batch per user message** | **Ephemeral (chat)** | **User says "done"**        |

Pick `/live-pair` for:

- Redesigning a panel in real time
- Tightening copy / labels across a surface
- Exploring layout or interaction alternatives
- Hands-on UX work: "move this here, shrink that, try a different color"
- Small creative sessions where the user wants to see every change immediately

Pick something else for:

- Systematic audit of a feature → `/live-exercise`
- Performance measurement + tuning → `/live-perf`
- Code-only review (no running extension) → `/review` / `/deep-review` / `/ux-review`

## Prerequisites

- `vscode-inspector` MCP connected (auto-discovered via `.mcp.json`)
- Build currently passes (`pnpm run build:quick`) — a broken build kills the rhythm
- User is present and responsive — this skill is interactive, not queueable

## Interaction model

- **Scope**: any interactive code change — UI tweaks, extension host, RPC, models. Not artificially constrained to CSS/copy.
- **Granularity**: one batch per user message. If the user says "move the button AND change the color," do both before rebuild+refresh. Separate messages → separate iterations.
- **Structural bugs**: flag before patching (see protocol below). Never silently pivot from "pair" to "debug."
- **Record-keeping**: ephemeral. Conversation is the log; `git diff` is the source of truth. No findings.md, no iteration-log.md.
- **Dispatch**: never. This skill uses the Edit tool directly. Parallel fix agents don't fit an interactive rhythm.

## Rebuild-scope auto-detection

Infer rebuild strategy from which files got edited. Bias toward webview-only when possible — it's ~3–5× faster than extension-host rebuilds.

| Files edited                                                 | Rebuild command                                                    | Refresh strategy                                                          |
| ------------------------------------------------------------ | ------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| Only `src/webviews/apps/**`                                  | `pnpm run build:webviews`                                          | `execute_command gitlens.views.<name>.refresh` (no extension reload)      |
| Extension host (most files outside `src/webviews/apps/`)     | `rebuild_and_reload { build_command: "pnpm run build:extension" }` | Extension host restart                                                    |
| Both                                                         | `rebuild_and_reload { build_command: "pnpm run build:quick" }`     | Extension host restart + refresh view                                     |
| `contributions.json` / commands / keybindings / package.json | `rebuild_and_reload { build_command: "pnpm run build:quick" }`     | Full reload. **Warn user**: command registrations may need fresh session. |

## The loop

### 1. Invocation / target selection

- If invoked with a target (`/live-pair the home view`, `/live-pair the compose panel`), use it.
- If no target given, ask once:

  > "What are we iterating on? Name the feature/view or describe what we're working on."

- Read `goals.md` if present for context — not as a spec (this skill is user-driven, not goal-compliant).

### 2. Launch & present current state

1. `launch` VS Code (skip if already running in this session).
2. `execute_command` to open the target view.
3. `list_webviews` + `wait_for_webview` to confirm Lit hydration.
4. `screenshot { target: "webview", webview_title: "<name>" }`.
5. Present to the user: one sentence on what's on screen + attached screenshot. Invite feedback:

   > "What would you like to change?"

### 3. Iteration round (repeat)

1. **Receive user feedback** (chat message).
2. **Classify the feedback**:
   - **Single tweak** → plan one change.
   - **Multiple related tweaks in one message** → plan one batch.
   - **Structural bug / non-trivial correctness issue** → **flag before editing** (see protocol).
   - **Vague ("make it cleaner")** → interpret best-guess, make the change, show it. Don't ask clarifying questions — iteration IS the answer. Refine next round.
3. **Edit** — Edit tool, directly. No dispatch.
4. **Rebuild** — infer scope per the matrix above. Run the minimal build.
5. **Refresh**:
   - Webview-only: `execute_command gitlens.views.<name>.refresh`
   - Extension host: handled by `rebuild_and_reload`
6. **Screenshot** new state.
7. **Summarize** — one sentence on what changed (not what's visible). Attach screenshot. Invite next feedback.

Example round summary:

> Moved Share to the top-right and tightened the empty-state copy. Screenshot attached. What's next?

### 4. Structural-bug flag protocol

If the user's feedback implies a structural or correctness issue (not a visual/copy/layout tweak), **flag before patching**:

> "This looks like a structural issue rather than a tweak. The fix involves [brief reason — data flow, state, RPC contract, etc.], which is better handled under `/live-exercise`'s sweep discipline. Want me to:
>
> 1. Delegate to `/live-exercise` for a proper audit (exits this pair session), or
> 2. Patch it inline and keep iterating here (lighter ceremony, less rigor)?"

Wait for the user to choose. Don't default.

Signals that feedback is structural:

- "This should fetch X" (data model / RPC)
- "Why isn't it updating when Y changes" (subscription / state)
- "It hangs on Z" (async / concurrency)
- "It crashes when…" (error handling / correctness)
- "The API for this should be different" (architecture)

Signals that feedback is a tweak (stay in `/live-pair`):

- "Move this," "change this color," "tighten this copy," "swap these two," "make this bigger," "hide this when empty"

### 5. Build failure handling

If rebuild fails, **stop iterating**. A broken build kills the rhythm.

1. Read the build error (command output).
2. Show it to the user with a short diagnosis (one line: "TypeScript error in X — missing import").
3. Propose a fix direction (one sentence).
4. **Wait for user guidance**. Don't charge ahead with another edit. Don't try to "work around" a broken build.
5. Once fixed and build passes, summarize + screenshot + resume the rhythm.

### 6. Exit

User signals done via "done," "that's it," "ship it," "looks good," "stop," or similar.

On exit:

1. `git diff --stat` — show the summary (files changed, line counts).
2. Offer to commit:

   > "Ready to commit these changes? Suggested message: [derived from conversation]. Or do you want to review the diff first, or continue iterating?"

3. If the user accepts, use `/commit`. If not, leave the working tree as-is.
4. `teardown` VS Code session (or leave running if the user prefers).

## Pitfalls

| Pitfall                                      | Mitigation                                                                                                          |
| -------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Scope creep                                  | User drives. Don't proactively add "and I also noticed…" tweaks. Stay on the message.                               |
| Stale webview state                          | Always refresh via `.refresh` command or `rebuild_and_reload`. Never trust a tweak landed without a new screenshot. |
| Build failure ignored                        | Stop. Fix build first. Everything else blocks.                                                                      |
| Over-summarizing                             | User can see the screenshot. Describe what _changed_, not what's visible.                                           |
| Under-summarizing subtle change              | 4px padding tweak? Call it out in text — the eye may miss it.                                                       |
| Hidden-state changes                         | Commands / package.json / keybindings need full reload. Flag before touching.                                       |
| Structural bug treated as tweak              | Flag early per protocol. Don't silently pivot.                                                                      |
| Extension-host rebuild when webview would do | Check what files you edited. Webview-only edit → webview-only rebuild.                                              |
| Parallel dispatch impulse                    | Never. One change at a time (batched within a message). Dispatch doesn't fit interactive rhythm.                    |
| No verification between rounds               | Every round ends with a new screenshot. Never "I made the change, moving on."                                       |
| Session drift without checkpoint             | If >30 rounds without a commit, pause and suggest a checkpoint commit.                                              |

## Red flags — pause the loop

- About to make a structural change without flagging it to the user
- About to rebuild extension host when a webview refresh would cover it
- Build is failing and you're queuing the next edit instead of fixing the build
- About to summarize a round without a new screenshot
- Proactively "also fixing" things the user didn't ask about
- Interpreting a non-trivial bug as a tweak because it's easier to stay in the rhythm
- Session >30 rounds with zero commits — suggest checkpoint

## Tripwires for "dropping the interactive rhythm"

Any of these in your reasoning = stop, don't break the pair dynamic.

- "I already know this will work, skip the screenshot"
- "I'll batch across messages for efficiency"
- "I'll interpret vague feedback and also add improvements they'd probably want"
- "The user won't mind if I fix this adjacent bug too"
- "The build's broken but the change is still good — moving on"
- "This looks structural but I'll just fix it inline quickly"

These all break the contract. The contract: user drives, one message = one change (or batch), every change ends with evidence (screenshot + diff).

## Rationalizations to resist

| Excuse                                             | Reality                                                                                        |
| -------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| "User asked for X but Y is obviously better"       | They didn't ask for Y. Do X, show it, let them decide on Y next round.                         |
| "I know the change worked, skip screenshot"        | User can't see what you can't show. Always refresh + screenshot.                               |
| "I'll batch across messages for speed"             | Breaks the feedback rhythm. One message in → one change + show out.                            |
| "Structural issue, I'll just fix it quickly"       | Flag per protocol. Don't silently pivot from pair to debug.                                    |
| "Build is failing but I can work around it"        | No. Restore the build first.                                                                   |
| "Vague feedback — let me ask clarifying questions" | Iteration IS the clarification. Interpret, show, refine next round. Don't slow the rhythm.     |
| "I should propose options first"                   | Just make the change. The cost of a miss is one round. Options-mode is for bigger decisions.   |
| "I'll add a small improvement while I'm there"     | No. Stay on the message. If you noticed something, mention it in the summary and let them ask. |

## Before declaring "live-pair complete"

You MUST have:

1. **Ended every round with a fresh screenshot** — no "done, trust me"
2. **Flagged every structural-bug detection** before patching
3. **Kept the build green** — no in-flight broken builds when ending
4. **Offered a commit** before teardown (user can decline)
5. **Summarized succinctly** — changes not visible, not descriptions of the screenshot

## Output artifacts

- **None by default.** The conversation is the log.
- Working tree with the iterated changes (committed or staged, per user choice at exit)
- Final `git diff` summary shown at exit

## Related skills

**REQUIRED BACKGROUND:**

- `/live-inspect` — primitive MCP tools (launch, screenshot, execute_command, rebuild_and_reload, refresh commands)

**Related:**

- `/live-exercise` — agent-driven audit counterpart; delegate here on structural issues
- `/live-perf` — agent-driven perf counterpart; delegate here on "this feels slow"
- `/commit` — exit-time commit of the session
- `/simplify` — code-quality cleanup if iteration accumulated drift
