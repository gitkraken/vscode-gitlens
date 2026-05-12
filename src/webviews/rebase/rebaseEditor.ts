import type {
	CancellationToken,
	ConfigurationChangeEvent,
	CustomTextEditorProvider,
	TextDocument,
	WebviewPanel,
} from 'vscode';
import { Disposable, Uri, ViewColumn, window } from 'vscode';
import { uuid } from '@gitlens/utils/crypto.js';
import { debug, trace } from '@gitlens/utils/decorators/log.js';
import { Logger } from '@gitlens/utils/logger.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { Container } from '../../container.js';
import {
	getRepoUriFromRebaseTodo,
	isRebaseTodoEditorEnabled,
	openRebaseEditor,
	reopenRebaseTodoEditor,
	setRebaseTodoEditorEnablement,
} from '../../git/utils/-webview/rebase.utils.js';
import { configuration } from '../../system/-webview/configuration.js';
import { setContext } from '../../system/-webview/context.js';
import type { WebviewCommandRegistrar } from '../webviewCommandRegistrar.js';
import { WebviewController } from '../webviewController.js';
import type { CustomEditorDescriptor } from '../webviewDescriptors.js';
import type { State } from './protocol.js';

const descriptor: CustomEditorDescriptor = {
	id: 'gitlens.rebase',
	fileName: 'rebase.html',
	iconPath: 'images/gitlens-icon.png',
	title: 'Interactive Rebase',
	contextKeyPrefix: 'gitlens:webview:rebase',
	trackingFeature: 'rebaseEditor',
	type: 'rebase',
	plusFeature: false,
	webviewOptions: { enableCommandUris: true, enableScripts: true },
	webviewHostOptions: { enableFindWidget: true, retainContextWhenHidden: true },
};

export class RebaseEditorProvider implements CustomTextEditorProvider, Disposable {
	private readonly _controllers = new Map<string, WebviewController<'gitlens.rebase', State>>();
	private readonly _disposable: Disposable;

	constructor(
		private readonly container: Container,
		private readonly commandRegistrar: WebviewCommandRegistrar,
	) {
		this._disposable = Disposable.from(
			window.registerCustomEditorProvider('gitlens.rebase', this, {
				supportsMultipleEditorsPerDocument: false,
				webviewOptions: descriptor.webviewHostOptions,
			}),
			configuration.onDidChangeAny(this.onAnyConfigurationChanged, this),
			container.git.onDidChangeRepository(e => {
				if (e.changed('rebase')) {
					void this.onRebaseChanged(e.repository.path);
				}
			}),
		);
		void setContext('gitlens:rebase:editor:enabled', this.enabled);
	}

	dispose(): void {
		this._controllers.forEach(c => c.dispose());
		this._controllers.clear();
		this._disposable.dispose();
	}

	get enabled(): boolean {
		return isRebaseTodoEditorEnabled();
	}

	async setEnabled(enabled: boolean): Promise<void> {
		// Only attempt to reopen if a rebase todo file is the active tab
		if (this.isRebaseTodoActive()) {
			void reopenRebaseTodoEditor(enabled ? 'gitlens.rebase' : 'default');
		}

		void setContext('gitlens:rebase:editor:enabled', enabled);
		await setRebaseTodoEditorEnablement(enabled);
	}

	refresh(uri: Uri): void {
		const controller = this._controllers.get(uri.toString());
		void controller?.refresh(true);
	}

	private isRebaseTodoActive(): boolean {
		const activeTab = window.tabGroups.activeTabGroup.activeTab;
		if (activeTab == null) return false;

		const input = activeTab.input;
		if (input != null && typeof input === 'object' && 'uri' in input) {
			const uri = input.uri;
			if (uri instanceof Uri && uri.path.endsWith('git-rebase-todo')) {
				return true;
			}
		}
		return false;
	}

	private isCommitMessageTabActive(): boolean {
		const activeTab = window.tabGroups.activeTabGroup.activeTab;
		if (activeTab == null) return false;

		const input = activeTab.input;
		if (input != null && typeof input === 'object' && 'uri' in input) {
			const uri = input.uri;
			if (uri instanceof Uri && uri.path.endsWith('COMMIT_EDITMSG')) {
				return true;
			}
		}
		return false;
	}

	private onAnyConfigurationChanged(e: ConfigurationChangeEvent) {
		if (!configuration.changedCore(e, 'workbench.editorAssociations')) return;

		void setContext('gitlens:rebase:editor:enabled', this.enabled);
	}

	@debug()
	private async onRebaseChanged(repoPath: string): Promise<void> {
		const openOnPausedRebase = configuration.get('rebaseEditor.openOnPausedRebase');
		if (!openOnPausedRebase || !isRebaseTodoEditorEnabled()) return;

		// Only open if the rebase is actually paused (waiting for user action), not just running
		const status = await this.container.git.getRepositoryService(repoPath).pausedOps?.getPausedOperationStatus?.();
		if (status?.type === 'rebase' && status.isPaused) {
			if (openOnPausedRebase === 'interactive' && !status.isInteractive) return;

			// `openBehavior` controls the viewColumn:
			//   - 'auto': reuse an existing non-active editor group if one exists; otherwise open in the
			//     active group. Never creates a new group. (`ViewColumn.Beside` can't be used here because
			//     it splits when the active group is the rightmost.)
			//   - 'beside': always beside (forces a new group if no sibling exists)
			// When the commit message editor is active (the reword case), keep focus on it so we don't
			// disrupt the user's typing — and additionally use background: true when opening in the same
			// group so the rebase editor doesn't get pushed behind the commit message tab.
			// For other pauses (e.g., the user picked `edit` first and there's no commit message editor
			// open), open the rebase editor normally so the user sees the pause.
			const openBehavior = configuration.get('rebaseEditor.openBehavior');
			let viewColumn: ViewColumn;
			if (openBehavior === 'beside') {
				viewColumn = ViewColumn.Beside;
			} else {
				const activeColumn = window.tabGroups.activeTabGroup.viewColumn;
				viewColumn =
					window.tabGroups.all.find(g => g.viewColumn !== activeColumn)?.viewColumn ?? ViewColumn.Active;
			}
			const commitMessageActive = this.isCommitMessageTabActive();
			const opensInActiveGroup = viewColumn === ViewColumn.Active;
			await openRebaseEditor(this.container, repoPath, {
				background: opensInActiveGroup && commitMessageActive,
				preserveFocus: commitMessageActive,
				viewColumn: viewColumn,
			});
		}
	}

	@trace({ args: document => ({ document: document }) })
	async resolveCustomTextEditor(
		document: TextDocument,
		panel: WebviewPanel,
		_token: CancellationToken,
	): Promise<void> {
		const scope = getScopedLogger();

		try {
			void this.container.usage.track(`${descriptor.trackingFeature}:shown`).catch();

			const key = document.uri.toString();

			// Dispose any existing controller for this document, (shouldn't happen due to supportsMultipleEditorsPerDocument being false)
			const existing = this._controllers.get(key);
			if (existing != null) {
				scope?.trace(`Disposing existing rebase editor controller for ${key}:${existing.instanceId}`);
				existing.dispose();
				this._controllers.delete(key);
			}

			const repoUri = await getRepoUriFromRebaseTodo(document.uri);

			let repoPath: string;
			let branchName: string | undefined;
			try {
				const svc = this.container.git.getRepositoryService(repoUri);
				repoPath = svc.path;
				const branch = await svc.branches.getBranch();
				branchName = branch?.name;
			} catch (ex) {
				Logger.error(ex, 'RebaseEditorProvider', `Failed to resolve repository for ${repoUri.toString()}`);
				repoPath = repoUri.fsPath;
			}

			// Set panel title and icon
			panel.title = `${descriptor.title}${branchName ? ` (${branchName})` : ''}`;
			panel.iconPath = Uri.file(this.container.context.asAbsolutePath(descriptor.iconPath));

			panel.webview.options = {
				enableCommandUris: true,
				enableScripts: true,
				localResourceRoots: [Uri.file(this.container.context.extensionPath)],
				...descriptor.webviewOptions,
			};

			const controller = await WebviewController.create<'gitlens.rebase', State>(
				this.container,
				this.commandRegistrar,
				descriptor,
				uuid(),
				panel,
				async (container, host) => {
					const { RebaseWebviewProvider } = await import(
						/* webpackChunkName: "webview-rebase" */ './rebaseWebviewProvider.js'
					);
					return new RebaseWebviewProvider(container, host, document, repoPath);
				},
			);
			this._controllers.set(key, controller);

			const subscriptions: Disposable[] = [
				controller.onDidDispose(() => {
					scope?.trace(`Disposing rebase editor controller (${key}:${controller.instanceId})`);

					this._controllers.delete(key);
					Disposable.from(...subscriptions).dispose();
				}),
				controller,
			];

			await controller.show(true, { preserveFocus: false }).catch();
		} catch (ex) {
			Logger.error(ex, 'RebaseEditorProvider', `Failed to open rebase editor for ${document.uri.toString()}`);
			void window.showErrorMessage(
				'GitLens was unable to open the Interactive Rebase Editor. Falling back to the text editor.',
			);
		}
	}
}
