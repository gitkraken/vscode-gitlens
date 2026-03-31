import type { Disposable } from 'vscode';
import { EventEmitter, window, workspace } from 'vscode';
import type { AgentSession, AgentSessionProvider, PermissionSuggestion } from './provider.js';

export class AgentStatusService implements Disposable {
	private readonly _onDidChange = new EventEmitter<void>();
	readonly onDidChange = this._onDidChange.event;

	private readonly _disposables: Disposable[] = [];
	private readonly _providers: AgentSessionProvider[];

	constructor(providers: AgentSessionProvider[]) {
		this._providers = providers;

		for (const provider of this._providers) {
			this._disposables.push(provider.onDidChangeSessions(() => this._onDidChange.fire()));
		}

		this._disposables.push(
			window.onDidChangeWindowState(e => {
				if (e.focused) {
					this.startProviders();
				} else {
					this.stopProviders();
				}
			}),
		);

		this.startProviders();
	}

	dispose(): void {
		this.stopProviders();
		for (const provider of this._providers) {
			provider.dispose();
		}
		for (const d of this._disposables) {
			d.dispose();
		}
		this._onDidChange.dispose();
	}

	get sessions(): readonly AgentSession[] {
		return this._providers.flatMap(p => p.sessions);
	}

	resolvePermission(
		sessionId: string,
		decision: 'allow' | 'deny',
		updatedPermissions?: PermissionSuggestion[],
	): void {
		for (const provider of this._providers) {
			const session = provider.sessions.find(s => s.id === sessionId);
			if (session != null) {
				// Only resolve permissions on local sessions — remote sessions'
				// permissions are handled by their own GitLens instance
				if (!session.isLocal) return;
				provider.resolvePermission?.(sessionId, decision, updatedPermissions);
				return;
			}
		}
	}

	private getWorkspacePaths(): string[] {
		return workspace.workspaceFolders?.map(f => f.uri.fsPath) ?? [];
	}

	private startProviders(): void {
		const paths = this.getWorkspacePaths();
		if (paths.length === 0) return;

		for (const provider of this._providers) {
			provider.start(paths);
		}
	}

	private stopProviders(): void {
		for (const provider of this._providers) {
			provider.stop();
		}
	}
}
