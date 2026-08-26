import type { AgentHookEvent } from './types.js';
import { canonicalBlockingHookEvents, canonicalNonBlockingHookEvents } from './types.js';

/** `gk ai hook` client id — the id the GitKraken CLI stamps onto every relayed hook event. NOT
 *  the same namespace as {@link AgentProviderId}. */
export type AgentHookClientId = 'claude-code' | 'codex' | 'copilot' | 'opencode';

/** GitLens session provider id — what lands on `AgentSession.providerId` and in telemetry. NOT
 *  the same namespace as {@link AgentHookClientId}. */
export type AgentProviderId = 'claudeCode' | 'codex' | 'copilot' | 'opencode';

/** Icon-font glyph name used to badge the agent in the UI. */
export type AgentIconName = 'claude' | 'openai' | 'copilot' | 'opencode';

/**
 * Flat, data-only description of one supported `gk ai hook` client. Mirrors how the GitKraken CLI
 * models its own clients (`internal/actions/aihook/events.json` + `registry.go`) so the two stay
 * comparable: the CLI relays each agent's native event and tool names verbatim, and this table is
 * what translates them into the canonical (Claude Code) vocabulary.
 */
export interface AgentCapabilities {
	/** The `gk ai hook` client id events arrive stamped with. */
	readonly hookClientId: AgentHookClientId;
	/** The GitLens session provider id — see {@link AgentProviderId}. */
	readonly providerId: AgentProviderId;
	readonly displayName: string;
	readonly icon: AgentIconName;

	/** Native event name → canonical event. Omitted when the agent's native names are already
	 *  canonical. */
	readonly eventMap?: Readonly<Record<string, AgentHookEvent>>;
	/** Escape hatch for the cases where the native event name alone can't determine the canonical
	 *  event and the payload has to be consulted. Tried BEFORE {@link eventMap}; returning
	 *  `undefined` falls through to it. `hookInput` is the ROOT of the JSON the agent piped to
	 *  `gk ai hook run` (what the CLI relays verbatim as `hookInput`), not a pre-unwrapped payload —
	 *  navigate the agent's own nesting from there. */
	readonly resolveEvent?: (
		nativeEvent: string,
		hookInput: Record<string, unknown> | undefined,
	) => AgentHookEvent | undefined;
	/** Native tool name → canonical (Claude Code) tool name. Omitted when already canonical. */
	readonly toolNameMap?: Readonly<Record<string, string>>;

	/** Native event names to register as non-blocking hooks at install time. `undefined` means
	 *  "pass no event flags and let `gk` apply its own per-client defaults". */
	readonly installEvents?: readonly string[];
	/** Native event names to register as blocking hooks at install time. `undefined` means
	 *  "pass no event flags and let `gk` apply its own per-client defaults". */
	readonly installBlockingEvents?: readonly string[];

	/** The agent can be installed with blocking hooks, so GitLens can answer a permission ask. */
	readonly supportsBlockingPermissions: boolean;
	/** The agent writes an on-disk transcript GitLens can tail for titles/prompts. */
	readonly supportsTranscripts: boolean;
	/** A past session can be resumed from its cwd. */
	readonly supportsResume: boolean;
	/** The agent multiplexes concurrent sessions in one process, so a pid does not identify a
	 *  session (matches the CLI's `pidSharingClients`). */
	readonly sharesPids: boolean;
	/** The agent's hook events carry no per-call cwd, so the reported cwd is fixed at install/init
	 *  time and never reflects later movement. */
	readonly cwdIsStatic: boolean;
}

const canonicalHookEvents = new Set<string>([...canonicalNonBlockingHookEvents, ...canonicalBlockingHookEvents]);

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return typeof value === 'object' && value != null ? (value as Record<string, unknown>) : undefined;
}

function isCanonicalHookEvent(event: string): event is AgentHookEvent {
	return canonicalHookEvents.has(event);
}

/** Claude Code's install set: its full native vocabulary minus the worktree events, which the CLI
 *  also skips by default (`skippedDefaultEvents` in its `events.json`) and GitLens has no use for. */
const claudeCodeInstallEvents: readonly AgentHookEvent[] = canonicalNonBlockingHookEvents.filter(
	e => e !== 'WorktreeCreate' && e !== 'WorktreeRemove',
);

/** Exported because Claude Code is the wire default: an event with no `providerId` comes from a CLI
 *  too old to stamp one, which predates every other client. */
export const claudeCodeCapabilities: AgentCapabilities = {
	hookClientId: 'claude-code',
	providerId: 'claudeCode',
	displayName: 'Claude Code',
	icon: 'claude',
	// No `eventMap`/`toolNameMap` — Claude Code's vocabulary IS the canonical one.
	installEvents: claudeCodeInstallEvents,
	installBlockingEvents: canonicalBlockingHookEvents,
	supportsBlockingPermissions: true,
	supportsTranscripts: true,
	supportsResume: true,
	sharesPids: false,
	cwdIsStatic: false,
};

const codexCapabilities: AgentCapabilities = {
	hookClientId: 'codex',
	providerId: 'codex',
	displayName: 'Codex',
	icon: 'openai',
	// No `eventMap` — Codex emits canonical event names already.
	toolNameMap: {
		apply_patch: 'Edit',
		// `update_plan` is deliberately NOT mapped to `ExitPlanMode`: it's a todo-list update, not a
		// plan-approval ask, and mapping it would classify routine progress as a permission prompt.
		// Left unmapped so it falls through to the generic tool path.
	},
	// `undefined` install sets: let `gk` apply its per-client defaults for now. Blocking permissions
	// are supported by the client but not requested until a later phase.
	supportsBlockingPermissions: true,
	supportsTranscripts: false,
	supportsResume: false,
	// The CLI lists codex in `pidSharingClients` — it multiplexes sessions in one process.
	sharesPids: true,
	cwdIsStatic: false,
};

const copilotCapabilities: AgentCapabilities = {
	hookClientId: 'copilot',
	providerId: 'copilot',
	displayName: 'GitHub Copilot CLI',
	icon: 'copilot',
	eventMap: {
		// Copilot's event names are otherwise canonical; `ErrorOccurred` is the one with no canonical
		// equivalent, so it maps onto Claude's turn-ended-in-error event (which derives to `idle`).
		ErrorOccurred: 'StopFailure',
	},
	// Copilot's own documented tool alias table.
	toolNameMap: {
		bash: 'Bash',
		// Deliberate: `powershell` → `Bash` loses label fidelity (a PowerShell call renders as
		// `Bash(...)`) but gains the command detail, because `describeToolInput` only extracts
		// `toolInput.command` for tools it knows to be shells.
		powershell: 'Bash',
		view: 'Read',
		create: 'Write',
		edit: 'Edit',
		str_replace_editor: 'Edit',
		apply_patch: 'Edit',
		grep: 'Grep',
		rg: 'Grep',
		glob: 'Glob',
		web_fetch: 'WebFetch',
		web_search: 'WebSearch',
		ask_user: 'AskUserQuestion',
	},
	supportsBlockingPermissions: true,
	supportsTranscripts: false,
	supportsResume: false,
	sharesPids: false,
	cwdIsStatic: false,
};

/** Reads the status type out of an OpenCode `session.status` hook input. The CLI's generated
 *  OpenCode plugin nests the raw SDK event under `hook_payload.event` (`buildHookInput` sets
 *  `hook_payload: payload`, and the generic event hook passes `{ event }`), so the full path from
 *  the hook-input root is `hook_payload.event.properties.status.type`. The payload is untyped JSON,
 *  so every hop is checked rather than cast. */
function getOpenCodeSessionStatusType(hookInput: Record<string, unknown> | undefined): string | undefined {
	const hookPayload = asRecord(hookInput?.hook_payload);
	const event = asRecord(hookPayload?.event);
	const properties = asRecord(event?.properties);
	const status = asRecord(properties?.status);
	const type = status?.type;

	return typeof type === 'string' ? type : undefined;
}

const openCodeCapabilities: AgentCapabilities = {
	hookClientId: 'opencode',
	providerId: 'opencode',
	displayName: 'OpenCode',
	icon: 'opencode',
	eventMap: {
		'session.created': 'SessionStart',
		'session.deleted': 'SessionEnd',
		// `session.idle` is deprecated in OpenCode's own source in favor of `session.status`, which is
		// why both are handled — older builds still emit it.
		'session.idle': 'Stop',
		'session.error': 'StopFailure',
		'session.compacted': 'PostCompact',
		'permission.asked': 'PermissionRequest',
		'permission.replied': 'ElicitationResult',
		'tool.execute.before': 'PreToolUse',
		'tool.execute.after': 'PostToolUse',
		// `session.updated` is intentionally absent — it has no canonical analogue.
		// `session.status` is resolved by `resolveEvent` below, since its meaning is in the payload.
	},
	resolveEvent: (nativeEvent, hookInput) => {
		if (nativeEvent !== 'session.status') return undefined;

		switch (getOpenCodeSessionStatusType(hookInput)) {
			case 'idle':
				return 'Stop';
			case 'busy':
				return 'PostToolUse';
			// Anything else (including `retry`) carries no status change we can canonicalize.
			default:
				return undefined;
		}
	},
	toolNameMap: {
		bash: 'Bash',
		read: 'Read',
		write: 'Write',
		edit: 'Edit',
		grep: 'Grep',
		glob: 'Glob',
		webfetch: 'WebFetch',
		websearch: 'WebSearch',
		apply_patch: 'Edit',
	},
	// The CLI hard-errors when asked to install blocking events for opencode.
	supportsBlockingPermissions: false,
	supportsTranscripts: false,
	supportsResume: false,
	sharesPids: false,
	// OpenCode's tool hooks carry no per-call cwd; the CLI's generated plugin supplies the
	// plugin-init directory once, so cwd never reflects later movement.
	cwdIsStatic: true,
};

/** Every supported hook client, in registry order. */
export const agentCapabilities: readonly AgentCapabilities[] = [
	claudeCodeCapabilities,
	codexCapabilities,
	copilotCapabilities,
	openCodeCapabilities,
];

/** Looks up capabilities by `gk ai hook` client id. Returns `undefined` for clients GitLens has no
 *  descriptor for (the CLI supports more than this table does). */
export function getAgentCapabilities(hookClientId: string): AgentCapabilities | undefined {
	return agentCapabilities.find(c => c.hookClientId === hookClientId);
}

/** Looks up capabilities by GitLens session provider id. */
export function getAgentCapabilitiesByProviderId(providerId: string): AgentCapabilities | undefined {
	return agentCapabilities.find(c => c.providerId === providerId);
}

/**
 * Translates an agent's native hook event name into the canonical vocabulary: `resolveEvent` first,
 * then `eventMap`, then an identity pass-through for names that are already canonical. Returns
 * `undefined` for anything else — unknown strings are never assumed to be canonical events.
 */
export function resolveCanonicalHookEvent(
	capabilities: AgentCapabilities,
	nativeEvent: string,
	hookInput?: Record<string, unknown>,
): AgentHookEvent | undefined {
	const resolved = capabilities.resolveEvent?.(nativeEvent, hookInput);
	if (resolved != null) return resolved;

	const mapped = capabilities.eventMap?.[nativeEvent];
	if (mapped != null) return mapped;

	return isCanonicalHookEvent(nativeEvent) ? nativeEvent : undefined;
}

/** Translates an agent's native tool name into the canonical (Claude Code) tool name, falling back
 *  to the input unchanged when the agent has no alias for it. */
export function resolveCanonicalToolName(capabilities: AgentCapabilities, nativeToolName: string): string {
	return capabilities.toolNameMap?.[nativeToolName] ?? nativeToolName;
}
