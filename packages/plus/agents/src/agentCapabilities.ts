import type { AgentHookEvent } from './types.js';
import { canonicalBlockingHookEvents, canonicalNonBlockingHookEvents } from './types.js';

/** `gk ai hook` client id — the id the GitKraken CLI stamps onto every relayed hook event. NOT
 *  the same namespace as {@link AgentProviderId}. */
export type AgentHookClientId = 'claude-code' | 'codex' | 'copilot' | 'opencode';

/** GitLens session provider id — what lands on `AgentSession.providerId` and in telemetry. NOT
 *  the same namespace as {@link AgentHookClientId}. */
export type AgentProviderId = 'claudeCode' | 'codex' | 'copilot' | 'opencode';

/** Icon-font glyph name used to badge the agent in the UI. Every member must name a `ThemeIcon` id
 *  that actually exists: either a codicon glyph name (`codicons-map.ts` is generated from VS Code's
 *  own font, so it isn't ours to extend) or a GitLens-contributed `gitlens-*` id from the `glicons`
 *  font, built from SVGs in `images/icons/`. An agent with no mark of its own uses `robot` — a name
 *  with no glyph renders as tofu, it does not fall back. */
export type AgentIconName = 'claude' | 'openai' | 'copilot' | 'gitlens-provider-opencode' | 'robot';

/** How to reach an agent from a terminal, and which arguments reattach it to a past session. */
export interface AgentCliCapabilities {
	/** The agent's name in `gk agents list`, where the detected executable path comes from. */
	readonly agentName: string;
	/** Bare command to run when gkcli reports no usable executable. */
	readonly command: string;
	/** Arguments that reattach the agent to a past session by id. */
	readonly resumeArgs: (sessionId: string) => readonly string[];
}

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
	/** A past session can be resumed from its cwd via {@link cli}. */
	readonly supportsResume: boolean;
	/** The agent multiplexes concurrent sessions in one process, so a pid does not identify a
	 *  session (matches the CLI's `pidSharingClients`). */
	readonly sharesPids: boolean;

	/** How to reach the agent from a terminal. Omitted when GitLens cannot launch the agent itself. */
	readonly cli?: AgentCliCapabilities;

	/** Extra step the agent's own host requires before installed hooks will actually fire. Undefined
	 *  when installing is sufficient. Not a computed state — we cannot detect whether the step has been
	 *  done, so consumers surface this unconditionally whenever hooks are installed. */
	readonly manualActivation?: string;
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
	cli: { agentName: 'claude-cli', command: 'claude', resumeArgs: sessionId => ['--resume', sessionId] },
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
	supportsResume: true,
	cli: { agentName: 'codex', command: 'codex', resumeArgs: sessionId => ['resume', sessionId] },
	// The CLI lists codex in `pidSharingClients` — it multiplexes sessions in one process.
	sharesPids: true,
	// Verified empirically, not speculative: running an identical Codex session with
	// `--dangerously-bypass-hook-trust` fires the installed hooks immediately (a session record
	// appears); without that flag, zero records — Codex silently refuses to run command hooks it
	// hasn't trusted yet, with no log line or warning of any kind. Trust is granted via `/hooks`
	// inside interactive Codex and is bound to the hook's hash, so a reinstall invalidates it. There
	// is no known way to detect trust state from outside Codex, so this hint is unconditional.
	manualActivation:
		"Codex won't run these hooks until you trust them — run `/hooks` in Codex. You'll need to trust them again if the hooks are reinstalled.",
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
		// `powershell` is deliberately absent. Aliasing it to `Bash` would only be worth the lost
		// label fidelity (a PowerShell call rendering as `Bash(...)`) if it bought the command detail
		// `describeToolInput` extracts for shells — and it can't: Copilot relays its args as
		// `hookInput.toolInput` (camelCase), a key nothing here reads, so no tool input reaches us at
		// all. Pure label loss today; revisit if Copilot's tool inputs ever become readable.
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
	supportsResume: true,
	cli: { agentName: 'copilot', command: 'copilot', resumeArgs: sessionId => [`--resume=${sessionId}`] },
	sharesPids: false,
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
	icon: 'gitlens-provider-opencode',
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
	// Only `idle` resolves. `busy` is deliberately unmapped, and so is everything else (`retry`
	// included): the canonical event this returns doesn't just pick a status, it selects a branch of
	// the provider's state-machine switch, so a mapping inherits that event's ENTIRE handler. Naming
	// `PostToolUse` here would also clear a pending permission ask, decrement the parallel-tool
	// refcount, and schedule file decorations away — all wrong for a tick OpenCode emits
	// independently of any tool lifecycle, and the ask-clearing is visibly wrong (the agent is still
	// blocked on it). There is no tool-free canonical event meaning "resumed working", and `busy`
	// carries no tool semantics to justify inventing one.
	resolveEvent: (nativeEvent, hookInput) => {
		if (nativeEvent !== 'session.status') return undefined;

		return getOpenCodeSessionStatusType(hookInput) === 'idle' ? 'Stop' : undefined;
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
	supportsResume: true,
	cli: { agentName: 'opencode', command: 'opencode', resumeArgs: sessionId => ['--session', sessionId] },
	sharesPids: false,
	// OpenCode's tool hooks carry no per-call cwd: the CLI's generated plugin supplies the
	// plugin-init directory once, so a session's reported cwd is frozen at that value and never
	// reflects later movement. Deliberately prose and NOT a capability flag — it was one, and
	// nothing could be built on it. Every cwd-driven path in `gkAgentProvider` (the
	// visited-worktree unions, `cwdTimeline` resolution, the `cliSeatedWorktree` unexplained-move
	// clear) reacts only to an OBSERVED difference between successive cwds, so a frozen cwd
	// degrades each one to its already-correct single-value no-op. A flag hands that code no fact
	// it can act on: it explains why the diff never fires, it does not supply the directory the
	// hooks never sent. Promote it back to a field if a surface ever needs to caveat the
	// attribution to the user — that would be its first real consumer.
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
