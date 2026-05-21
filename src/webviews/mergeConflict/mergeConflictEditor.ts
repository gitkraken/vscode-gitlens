import type { CancellationToken, CustomTextEditorProvider, TextDocument, WebviewPanel } from 'vscode';
import { Disposable, Uri, window } from 'vscode';
import { uuid } from '@gitlens/utils/crypto.js';
import { trace } from '@gitlens/utils/decorators/log.js';
import { Logger } from '@gitlens/utils/logger.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import type { Container } from '../../container.js';
import { configuration } from '../../system/-webview/configuration.js';
import type { WebviewCommandRegistrar } from '../webviewCommandRegistrar.js';
import { WebviewController } from '../webviewController.js';
import type { CustomEditorDescriptor } from '../webviewDescriptors.js';
import type { State } from './protocol.js';

const descriptor: CustomEditorDescriptor<'gitlens.mergeConflict'> = {
	id: 'gitlens.mergeConflict',
	fileName: 'mergeConflict.html',
	iconPath: 'images/gitlens-icon.png',
	title: 'Merge Conflict',
	contextKeyPrefix: 'gitlens:webview:mergeConflict',
	trackingFeature: 'mergeConflictEditor',
	type: 'mergeConflict',
	plusFeature: false,
	webviewOptions: { enableCommandUris: true, enableScripts: true },
	webviewHostOptions: { enableFindWidget: true, retainContextWhenHidden: true },
};

export class MergeConflictEditorProvider implements CustomTextEditorProvider, Disposable {
	private readonly _controllers = new Map<string, WebviewController<'gitlens.mergeConflict', State>>();
	private readonly _disposable: Disposable;
	/** URIs the user has dismissed from our editor while keeping another tab open for the same
	 *  file. The auto-open watcher consults this to avoid re-promoting after the user explicitly
	 *  chose VS Code's default editor for that file. Cleared when every tab for the URI closes. */
	private readonly _optedOut = new Set<string>();
	/** URIs queued to auto-trigger AI resolution as soon as the controller initializes. Populated
	 *  by the `gitlens.conflicts.resolveWithAI` command before it calls `vscode.openWith` on us. */
	private readonly _pendingAIResolve = new Set<string>();

	constructor(
		private readonly container: Container,
		private readonly commandRegistrar: WebviewCommandRegistrar,
	) {
		this._disposable = Disposable.from(
			window.registerCustomEditorProvider('gitlens.mergeConflict', this, {
				supportsMultipleEditorsPerDocument: false,
				webviewOptions: descriptor.webviewHostOptions,
			}),
			window.tabGroups.onDidChangeTabs(e => {
				for (const closed of e.closed) {
					const uri = (closed.input as { uri?: Uri } | undefined)?.uri;
					if (uri == null) continue;
					const key = uri.toString();
					if (!this._optedOut.has(key)) continue;
					// If no tab anywhere still references this URI, the user fully closed the file
					// — reset the opt-out so next time it's opened we promote again.
					const stillOpen = window.tabGroups.all.some(g =>
						g.tabs.some(t => (t.input as { uri?: Uri } | undefined)?.uri?.toString() === key),
					);
					if (!stillOpen) this._optedOut.delete(key);
				}
			}),
		);
	}

	dispose(): void {
		this._controllers.forEach(c => c.dispose());
		this._controllers.clear();
		this._disposable.dispose();
	}

	get enabled(): boolean {
		return configuration.get('mergeConflictEditor.enabled') ?? false;
	}

	/** True when the user explicitly switched away from our editor for this URI in this session
	 *  (e.g., via "Reopen Editor With…" or our Switch to Text Editor button). Auto-promotion
	 *  honors this until every tab for the URI is closed. */
	isOptedOut(uri: Uri): boolean {
		return this._optedOut.has(uri.toString());
	}

	/** Mark a URI as opted-out of auto-promotion. The auto-open watcher calls this when it
	 *  detects the user is actively focused on a non-our-editor tab for a URI that also has our
	 *  editor open — i.e., they deliberately want to see the default editor. */
	markOptedOut(uri: Uri): void {
		this._optedOut.add(uri.toString());
	}

	/** Stage a URI for an automatic AI resolve once the merge editor opens. The command opener
	 *  calls this just before `vscode.openWith('gitlens.mergeConflict')`; `resolveCustomTextEditor`
	 *  consumes the flag and kicks off the run. */
	queueAIResolve(uri: Uri): void {
		this._pendingAIResolve.add(uri.toString());
	}

	refresh(uri: Uri): void {
		const controller = this._controllers.get(uri.toString());
		void controller?.refresh(true);
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

			const existing = this._controllers.get(key);
			if (existing != null) {
				scope?.trace(`Disposing existing merge conflict editor controller for ${key}:${existing.instanceId}`);
				existing.dispose();
				this._controllers.delete(key);
			}

			// Prefer the registered-repo lookup (fast, works for any file inside a workspace repo).
			// `getValidatedRepositoryService(fileUri)` runs `git rev-parse` against the file path
			// directly, which fails on Windows when the URI carries Git-incompatible markers.
			let repoPath: string | undefined = this.container.git.getRepository(document.uri)?.path;
			if (repoPath == null) {
				try {
					const svc = await this.container.git.getValidatedRepositoryService(document.uri);
					repoPath = svc.path;
				} catch (ex) {
					Logger.error(
						ex,
						'MergeConflictEditorProvider',
						`Failed to resolve repository for ${document.uri.toString()}`,
					);
					void window.showWarningMessage(
						"GitLens couldn't access this repository, so the Merge Conflict Editor isn't available here. Falling back to the text editor.",
					);
					return;
				}
			}

			panel.title = `${descriptor.title}: ${getDisplayName(document.uri)}`;
			panel.iconPath = Uri.file(this.container.context.asAbsolutePath(descriptor.iconPath));

			panel.webview.options = {
				enableCommandUris: true,
				enableScripts: true,
				localResourceRoots: [Uri.file(this.container.context.extensionPath)],
				...descriptor.webviewOptions,
			};

			const controller = await WebviewController.create<'gitlens.mergeConflict', State>(
				this.container,
				this.commandRegistrar,
				descriptor,
				uuid(),
				panel,
				async (container, host) => {
					const { MergeConflictWebviewProvider } = await import(
						/* webpackChunkName: "webview-mergeConflict" */ './mergeConflictWebviewProvider.js'
					);
					return new MergeConflictWebviewProvider(container, host, document, repoPath);
				},
			);
			this._controllers.set(key, controller);

			const subscriptions: Disposable[] = [
				controller.onDidDispose(() => {
					scope?.trace(`Disposing merge conflict controller (${key}:${controller.instanceId})`);
					this._controllers.delete(key);
					// If the user dismissed our editor while leaving another tab open for the same
					// file (e.g., switched to VS Code's default editor), record the opt-out so the
					// auto-open watcher doesn't immediately re-promote on the next active-editor
					// change. The opt-out is cleared by the tab-close listener when every tab for
					// the URI is gone.
					const stillOpen = window.tabGroups.all.some(g =>
						g.tabs.some(t => (t.input as { uri?: Uri } | undefined)?.uri?.toString() === key),
					);
					if (stillOpen) this._optedOut.add(key);
					Disposable.from(...subscriptions).dispose();
				}),
				controller,
			];

			await controller.show(true, { preserveFocus: false }).catch();

			if (this._pendingAIResolve.delete(key)) {
				const provider = (controller as unknown as { provider?: { runAIResolve?: () => Promise<void> } })
					.provider;
				if (typeof provider?.runAIResolve === 'function') {
					void provider.runAIResolve().catch((ex: unknown) => {
						Logger.error(ex, 'MergeConflictEditorProvider', `Failed to auto-run AI resolve for ${key}`);
					});
				}
			}
		} catch (ex) {
			Logger.error(
				ex,
				'MergeConflictEditorProvider',
				`Failed to open merge conflict editor for ${document.uri.toString()}`,
			);
			void window.showErrorMessage(
				'GitLens was unable to open the Merge Conflict Editor. Falling back to the text editor.',
			);
		}
	}
}

function getDisplayName(uri: Uri): string {
	const fsPath = uri.fsPath;
	const m = /[\\/]([^\\/]+)$/.exec(fsPath);
	return m?.[1] ?? fsPath;
}
