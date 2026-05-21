import type { TextEditor, Uri } from 'vscode';
import { Disposable, window } from 'vscode';
import { debug } from '@gitlens/utils/decorators/log.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { Container } from '../../container.js';
import { countConflictMarkers } from '../../git/utils/-webview/mergeConflicts.utils.js';
import { executeCoreCommand } from '../../system/-webview/command.js';
import { configuration } from '../../system/-webview/configuration.js';

const customEditorId = 'gitlens.mergeConflict';

/**
 * Watches the active editor and re-opens conflicted files in the GitLens merge conflict editor
 * when the feature is enabled. VS Code's `customEditors` contribution is filename-glob-only, so
 * content-based interception has to be reactive.
 *
 * Loop-guarded by tracking the set of URIs we've already promoted; re-promotion only fires after
 * a different editor becomes active.
 */
export class MergeConflictAutoOpenWatcher implements Disposable {
	private readonly _conflictMarkerCache = new Map<string, { mtime: number; count: number }>();
	private readonly _disposables: Disposable[];
	private readonly _pendingPromotions = new Set<string>();

	constructor(private readonly container: Container) {
		this._disposables = [
			window.onDidChangeActiveTextEditor(e => {
				void this.onActiveEditorChanged(e);
			}),
		];
	}

	dispose(): void {
		Disposable.from(...this._disposables).dispose();
	}

	@debug()
	private async onActiveEditorChanged(editor: TextEditor | undefined): Promise<void> {
		if (editor == null) return;
		if (!this.isEnabled()) return;

		const uri = editor.document.uri;
		if (uri.scheme !== 'file') return;

		const key = uri.toString();
		if (this._pendingPromotions.has(key)) return;

		// Skip when the active tab is already our custom editor — VS Code re-fires this event
		// on tab focus changes and we don't want to re-promote ourselves into a loop.
		const activeTab = window.tabGroups.activeTabGroup.activeTab;
		const input = activeTab?.input as { viewType?: string } | undefined;
		if (input?.viewType === customEditorId) return;

		// Respect the user's choice: once they dismissed our editor for this URI while leaving
		// another tab open, don't re-promote until every tab for the URI is closed.
		if (this.container.mergeConflictEditor.isOptedOut(uri)) return;

		// If our editor already has a tab open for this URI but the user is focused on a non-our-
		// editor tab for the same file, treat that as an explicit "show me the default editor"
		// — don't yank focus back. We also record the opt-out so the next active-editor change
		// (e.g., re-focusing the default tab after switching to another file) doesn't re-promote.
		const ourTabOpen = window.tabGroups.all.some(g =>
			g.tabs.some(t => {
				const i = t.input as { uri?: Uri; viewType?: string } | undefined;
				return i?.uri?.toString() === key && i?.viewType === customEditorId;
			}),
		);
		if (ourTabOpen) {
			this.container.mergeConflictEditor.markOptedOut(uri);
			return;
		}

		try {
			const repo = this.container.git.getRepository(uri);
			if (repo == null) return;

			// Only intercept when the repo is in a paused operation. This excludes random files
			// containing `<<<<<<<` in their content (e.g., this very file in a markdown doc).
			const svc = this.container.git.getRepositoryService(repo.path);
			const status = await svc.pausedOps?.getPausedOperationStatus?.();
			if (status == null) return;

			const markerCount = await countConflictMarkers(uri, {
				get: k => this._conflictMarkerCache.get(k),
				set: (k, v) => this._conflictMarkerCache.set(k, v),
			});
			if (markerCount === 0) return;

			this._pendingPromotions.add(key);
			try {
				await this.promote(uri);
			} finally {
				// Hold for one tick so the editor-change event doesn't re-promote immediately.
				setTimeout(() => this._pendingPromotions.delete(key), 0);
			}
		} catch (ex) {
			Logger.error(ex, 'MergeConflictAutoOpenWatcher', 'Failed to evaluate active editor for conflict promotion');
		}
	}

	private isEnabled(): boolean {
		return (
			(configuration.get('mergeConflictEditor.enabled') ?? false) &&
			(configuration.get('mergeConflictEditor.openOnFileOpen') ?? true)
		);
	}

	private async promote(uri: Uri): Promise<void> {
		await executeCoreCommand('vscode.openWith', uri, customEditorId);
	}
}
