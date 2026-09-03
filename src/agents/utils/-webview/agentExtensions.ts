import type { Disposable, Event } from 'vscode';
import { EventEmitter, extensions } from 'vscode';
import { claudeCodeCapabilities } from '@gitlens/agents/agentCapabilities.js';
import type { AgentSessionResumeTarget } from '@gitlens/agents/types.js';
import { arePathsEqual } from '@gitlens/utils/path.js';
import { isClaudeExtensionAvailable, tryOpenClaudeSession } from './claudeExtension.js';

/** A VS Code extension GitLens can open one of an agent's sessions in. */
export interface AgentExtension {
	/** `true` when the extension is installed and its open-session command is registered. */
	isAvailable(): Promise<boolean>;
	/** Opens `sessionId` in the extension; `false` when every open command failed. */
	openSession(sessionId: string): Promise<boolean>;
}

/** The VS Code extension GitLens can open a session in, keyed by session provider id. Only Claude
 *  Code has one today. */
const registry: ReadonlyMap<string, AgentExtension> = new Map([
	[claudeCodeCapabilities.providerId, { isAvailable: isClaudeExtensionAvailable, openSession: tryOpenClaudeSession }],
]);

export function getAgentExtension(providerId: string): AgentExtension | undefined {
	return registry.get(providerId);
}

/** Sync view of {@link AgentExtension.isAvailable} for every registered agent extension, refreshed
 *  on `extensions.onDidChange` and on demand — target computation needs a synchronous read, and
 *  probing each extension's registered commands is async. */
export class AgentExtensionAvailability implements Disposable {
	private readonly _onDidChange = new EventEmitter<void>();
	readonly onDidChange: Event<void> = this._onDidChange.event;

	private readonly _disposable: Disposable;
	private readonly _availability = new Map<string, boolean>();

	constructor() {
		this._disposable = extensions.onDidChange(() => void this.refresh());
		void this.refresh();
	}

	dispose(): void {
		this._disposable.dispose();
		this._onDidChange.dispose();
	}

	/** Last known value; `false` until the first {@link refresh} lands. */
	isAvailable(providerId: string): boolean {
		return this._availability.get(providerId) ?? false;
	}

	async refresh(): Promise<void> {
		const results = await Promise.allSettled(
			Array.from(registry.entries(), async ([providerId, extension]) => {
				return [providerId, await extension.isAvailable()] as const;
			}),
		);

		let changed = false;
		for (const result of results) {
			if (result.status !== 'fulfilled') continue;

			const [providerId, available] = result.value;
			if (this._availability.get(providerId) !== available) {
				changed = true;
			}
			this._availability.set(providerId, available);
		}

		if (changed) {
			this._onDidChange.fire();
		}
	}
}

/** Resume destinations for a session of `providerId` homed at `cwd`; always ends with `'terminal'`.
 *  The extension only ever leads when it can actually open the session: it has one registered
 *  ({@link getAgentExtension}), it is installed and its open-session command is registered
 *  (`isExtensionAvailable`), and `cwd` is a workspace folder the extension's own window has open. */
export function computeResumeTargets(
	providerId: string,
	cwd: string,
	isExtensionAvailable: (providerId: string) => boolean,
	workspaceFolders: readonly string[],
): readonly AgentSessionResumeTarget[] {
	const extensionUsable =
		getAgentExtension(providerId) != null &&
		isExtensionAvailable(providerId) &&
		workspaceFolders.some(folder => arePathsEqual(folder, cwd));

	return extensionUsable ? ['extension', 'terminal'] : ['terminal'];
}
