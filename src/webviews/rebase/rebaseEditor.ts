import type {
	CancellationToken,
	ConfigurationChangeEvent,
	CustomTextEditorProvider,
	TextDocument,
	WebviewPanel,
} from 'vscode';
import { Disposable, Uri, ViewColumn, window } from 'vscode';
import { uuid } from '@env/crypto.js';
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
import { debug, trace } from '../../system/decorators/log.js';
import { getScopedLogger } from '../../system/logger.scope.js';
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

			// Open beside the current editor (e.g., commit message editor) during active rebase
			await openRebaseEditor(this.container, repoPath, { viewColumn: ViewColumn.Beside });
		}
	}

	@trace({ args: document => ({ document: document }) })
	async resolveCustomTextEditor(
		document: TextDocument,
		panel: WebviewPanel,
		_token: CancellationToken,
	): Promise<void> {
		const scope = getScopedLogger();

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
		const svc = this.container.git.getRepositoryService(repoUri);
		const branch = await svc.branches.getBranch();

		// Set panel title and icon
		panel.title = `${descriptor.title}${branch?.name ? ` (${branch.name})` : ''}`;
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
				return new RebaseWebviewProvider(container, host, document, svc.path);
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
	}
}
