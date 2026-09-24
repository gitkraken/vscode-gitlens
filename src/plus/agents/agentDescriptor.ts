import type { GkAgent } from '../../agents/agentService.js';

/**
 * Identifies an agent that can receive a prompt from Start Work / Start Review.
 *
 * Discriminated union of the three categories:
 * - `ide-chat`: the host IDE's built-in chat (Copilot Chat in VS Code, Cursor Chat in Cursor, etc.).
 *   Exactly one of these may exist per session, determined by `getHostAppName()`.
 * - `claude-extension`: Anthropic's `Anthropic.claude-code` VS Code extension. Optional, gated on install.
 * - `cli`: any detected CLI from `cliAgentIds` (`claude-cli`, `codex`, `gemini`, `copilot`, `opencode`).
 *   Filtered to entries with `detected: true` AND a non-empty `executable`.
 *
 * Descriptors are plain data: JSON-serializable for the deep-link cross-window dispatch bridge.
 * Do NOT add methods or closures here; they must round-trip through `storeSecret` / `JSON.parse`.
 */
export type AgentDescriptor =
	| { readonly id: 'ide-chat'; readonly kind: 'ide-chat'; readonly host: string; readonly label: string }
	| { readonly id: 'claude-extension'; readonly kind: 'claude-extension'; readonly label: string }
	| { readonly id: `cli:${string}`; readonly kind: 'cli'; readonly agent: GkAgent; readonly label: string };

/**
 * Where Start Work / Start Review hands off. `'kepler'` is a route, not an {@link AgentDescriptor}:
 * an agent is dispatched AFTER the branch/worktree is created, whereas Kepler creates its own
 * worktree, so it must short-circuit before that — an agent-shaped Kepler would mean two worktrees
 * per item. It lives in `gitlens.ai.openInAgent` despite not being an agent (design doc §5.3).
 */
export type AgentRoute = 'ask' | 'manual' | 'agent' | 'kepler';

export function getAgentDescriptorId(descriptor: AgentDescriptor): string {
	return descriptor.id;
}

/** Type guard: returns true when the descriptor is plain-data JSON-safe (no methods, no undefined leaves). */
export function isAgentDescriptor(value: unknown): value is AgentDescriptor {
	if (value == null || typeof value !== 'object') return false;

	const v = value as { id?: unknown; kind?: unknown; label?: unknown };
	if (typeof v.id !== 'string' || typeof v.label !== 'string') return false;

	switch (v.kind) {
		case 'ide-chat':
			return typeof (v as { host?: unknown }).host === 'string';
		case 'claude-extension':
			return v.id === 'claude-extension';
		case 'cli':
			return (v as { agent?: unknown }).agent != null && v.id.startsWith('cli:');
		default:
			return false;
	}
}
