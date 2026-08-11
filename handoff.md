# Handoff — `feature/connect-agents`

Generalizes GitLens's Claude-only hooks integration to every harness the GitKraken CLI supports, aligns MCP and hooks on an "install everything, settings for granular control" model, and consolidates the MCP + Claude-hooks onboarding surfaces into one agent-agnostic treatment.

Based on `main` at `0c9a8f4ed` (rebased 2026-08-11; build + full unit suite re-verified green on this base). Design mock (approved): https://claude.ai/code/artifact/2d0faa14-db7c-4482-80ef-5a993ba386db

## Commits

| Commit      | Scope                                                                                                                                                   |
| ----------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `3112480a7` | Command/service layer: install-all + per-agent hooks commands, MCP install-all, `connectAgents` chain, MCP org-gating, settings-table targeting bug fix |
| `417422f05` | State/RPC: per-agent hooks state everywhere, graph IPC rename, aggregate AI-panel row, settings Editors group                                           |
| `9978f39a5` | UI consolidation: `gl-agents-banner` replaces both banners, single `agents:banner` key, merged graph-header popover                                     |
| `0b6883b66` | Per-agent MCP uninstall + bundled MCP opt-out checkbox in settings                                                                                      |

## What changed, user-visibly

- **Commands** (old `gitlens.agents.installClaudeHook` / `uninstallClaudeHook` / `gitlens.ai.mcp.selectAgents` are gone):
  - `gitlens.agents.installHooks` / `uninstallHooks` — install/uninstall GitKraken hooks for **all** detected, supported agents. Palette-visible, gated on `gitlens:agents:enabled`.
  - `gitlens.agents.installHooksForAgent` / `uninstallHooksForAgent` — hidden, `{agentId, source}`; dispatched by the settings table (`cli:` prefix stripped; raw editor names pass through).
  - `gitlens.ai.mcp.installForAllAgents` — replaces the multi-select agent picker (`mcpAgentPicker.ts` deleted).
  - `gitlens.ai.mcp.uninstallForAgent` — hidden; runs `gk mcp uninstall <name>`. Deliberately **no** `ai.allowed` guard: removal must work for disabled orgs.
  - `gitlens.ai.connectAgents` — the combined banner CTA: MCP setup for the host → MCP install-all → hooks install-all (hooks half only when `gitlens:agents:enabled`).
- **Settings → Agents table**: per-agent Hooks buttons now target the right agent (previously a live bug — any row installed _Claude_ hooks). New **Editors** group for hook-capable IDE agents (Cursor, Antigravity) with dimmed "Not detected" treatment, read-only MCP status, and hooks install/uninstall. MCP cells gain an uninstall icon next to "✓ Installed". New checkbox for `gitkraken.mcp.autoEnabled` (the bundled/host registration — nothing to "uninstall", it's a live registration, so it's a setting; disabled when AI is off).
- **One banner** (`gl-agents-banner`, "Connect Your AI Agents") replaces the MCP banner + hooks banner across Home, graph sidebar/kanban/treemap. One dismissal key `agents:banner` (schema 18.3.0) replaces `mcp:banner` + `hooks:banner` — users who dismissed the old ones will see the combined banner **once** (accepted). Copy adapts: MCP-only when the agents feature is gated off; "bundled" variant when the host auto-registers.
- **Graph header**: the two sequenced popover buttons (mcp icon → robot icon) merge into one button/popover with a per-agent ✓/○ status list.
- **AI panel** (Home account bar → integrations chip): the Claude hooks row becomes one aggregate "Agent Hooks" row ("Installed for X of Y agents", install-all / uninstall-all / gear→settings).

## Design decisions and rationale

- **Install-all, no picker.** Top-level CTAs act on every detected+supported+not-installed agent; granular control lives exclusively in Settings → Agents. (Eric's call; picker deleted.)
- **MCP and hooks stay coupled at the surface, decoupled underneath.** `connectAgents` is a convenience chain over fully independent commands. Known trade-off: one click writes into every detected tool's config; the escape hatch is per-agent uninstall in settings.
- **Gating is intentionally asymmetric.** MCP now checks `container.ai.allowed` — the **fail-open** form (`enabled && orgEnabled`, org defaults true until settings load) — because host registration must exist at startup and flapping is worse than briefly serving a disabled org. Hooks/agents keep the **fail-closed** confirmed gate (`gitlens:gk:organization:ai:enabled === true`) because that context constructs visible chrome and runtime machinery, and offering hook installs to a disabled org has durable side effects. `GkMcpService` now also re-evaluates registration on the org context change (previously config-only).
- **Event curation is minimal and deliberate.** `gk`'s own manifest (`events.json`) curates per-client defaults (claude-code's defaults already skip the Worktree events). The only thing gk defaults can't express is **blocking** events — so claude-code keeps GitLens's full flag set (blocking `PermissionRequest` powers the graph's approve/deny flow), and every other client installs bare. Do **not** pass blocking flags for other clients: nothing in GitLens resolves their permission asks, and a blocking hook parks the agent up to 24h.
- **The CLI is the source of truth.** All install/support state (`mcpSupported/Installed`, `hooksSupported/Installed`) comes from `gk agents list --json` per agent; nothing is hardcoded per-harness. Exceptions kept GitLens-side: `cliAgentIds` (which names are CLI rows), the `claude-cli` → `claude-code` hook-client-id mapping (`src/agents/utils/agentHooks.ts`), and Claude's event flags. A new harness gk supports shows up in Editors + install-all with zero GitLens changes.
- **Hooks eligibility does NOT reuse the MCP IDE exclusion.** MCP install-all excludes `ideAgentIds` (host registration covers the current editor); hooks trust `hooksSupported` alone — cursor/antigravity are valid hook clients.

## Live-update semantics (settings freshness)

Every GitLens-initiated install/uninstall ends in `AgentService.invalidateCache()` → fires `onDidChangeAgents`; the Agents RPC (settings table) and AI RPC (panel, banner) subscribe to that + `onDidChangeHooksInstallState` and re-query; the graph gets `DidChangeCanInstallHooks` (payload now carries the per-agent list; dedup sentinel kept). Verified live: row state flips immediately on click. **External** changes (e.g. `gk mcp install codex` in a terminal) are not pushed — the 5-minute agent-list TTL picks them up on the next re-query. Pre-existing gap, unchanged.

## Verification done

- `pnpm run build` + full unit suite (2088 passing) green after every phase.
- Live inspector session: command registry correct (old ids absent incl. palette); settings-table per-agent targeting proven end-to-end — Codex Install ran exactly `gk ai hook install codex --force` (bare), Uninstall reverted it, row state updated both ways; Claude hooks untouched; AI panel aggregate row correct ("Installed for 1 of 4 agents"); machine state restored.
- Home banner + graph popover were hidden in the inspector due to its onboarding-suppression behavior — gating state values verified correct underneath; **the rendered banner/popover have not been eyeballed in a real session** (see checklist).
- gk contract checks against the local `gkcli` source: single-client `mcp uninstall` success output always contains "Successfully Uninstalled", failures return real errors; `mcp uninstall` takes **no `--source` flag** (an earlier draft passed one — every uninstall would have failed; fixed pre-commit).

## Open questions / follow-ups (not in this branch)

1. **Live sessions provider filter — decide before or at landing.** `ClaudeCodeProvider` ingests `gk ai hook list-sessions` records and relay IPC events **without filtering by `providerId`**. Now that non-Claude hooks are installable, their sessions will surface in the graph's Live UI as pseudo-Claude sessions with wrong affordances (Claude resume/open, Claude permission semantics). Recommended: add a null-tolerant `providerId === 'claude-code'` guard to the poll (and the IPC path if events carry a provider) until real multi-harness session support is built. Not implemented — awaiting a decision.
2. **Multi-harness Live sessions** — the real feature behind #1; provider architecture is already array-shaped.
3. **gk-side: per-client default blocking events** in `events.json`, so GitLens can drop Claude's event flags entirely.
4. **gk stdout notes are discarded** — e.g. `gk ai hook install codex` prints "Codex runs SessionEnd only after you trust its hook group in Codex"; the aggregate toast doesn't surface per-client notes.
5. **Settings freshness for external changes** — optional: re-query on settings-webview visibility to bypass the TTL.
6. **MCP vs Hooks cell treatment asymmetry** — MCP is state-first ("✓ Installed" + quiet uninstall icon), Hooks is action-first (full Install/Uninstall button). Recommended: unify Hooks to the MCP treatment. Not done — awaiting a decision.
7. **Antigravity row oddity** — dimmed "Not detected" yet MCP "✓ Installed" (gk-reported truth: config written, app absent). Accurate but reads odd; could suppress status on undetected rows.
8. **Telemetry dashboards**: `agents/hookInstalled`/`hookUninstalled` `agent.provider` values change from `claudeCode` to hook client ids (`claude-code`, `codex`, …). New events: `agents/hooks/setup/completed`, `mcp/agent/uninstalled`. Removed: `mcp/agents/selected`.
9. **Optional polish**: rename `AgentSessionProvider.setClaudeHooksInstalled` (kept Claude-keyed on purpose — it gates ClaudeCodeProvider's reconciliation poll).

## Landing checklist

- [ ] Eyeball `gl-agents-banner` (Home) and the merged graph popover in a real session (`dev:launch`) — the only surfaces not visually confirmed.
- [ ] Decide open question #1 (Live provider filter) — cheap to add here if wanted.
- [ ] CHANGELOG entry (not written; intra-release conventions per `/audit-commits`).
- [ ] Remove this `handoff.md` before/at merge.

## References

- Plan: `~/.claude/plans/we-need-to-adapt-sorted-pie.md` (includes full exploration findings and the decided design)
- gk CLI contract details: `gkcli` repo — `internal/actions/aihook/events.json` (per-client events + `skippedDefaultEvents`), `hook.go:105-146` (`InstallHooks` default behavior), `cmd/gk/mcp/uninstall.go` (output branches)
