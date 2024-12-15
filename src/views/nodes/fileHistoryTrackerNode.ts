import type { TextEditor } from 'vscode';
import { Disposable, FileType, TreeItem, TreeItemCollapsibleState, window, workspace } from 'vscode';
import type { GitCommitish } from '../../git/gitUri';
import { GitUri, unknownGitUri } from '../../git/gitUri';
import { isBranchReference } from '../../git/models/reference.utils';
import { isSha } from '../../git/models/revision.utils';
import { showReferencePicker } from '../../quickpicks/referencePicker';
import { UriComparer } from '../../system/comparers';
import { gate } from '../../system/decorators/gate';
import { debug, log } from '../../system/decorators/log';
import { weakEvent } from '../../system/event';
import type { Deferrable } from '../../system/function';
import { debounce } from '../../system/function';
import { Logger } from '../../system/logger';
import { getLogScope, setLogScopeExit } from '../../system/logger.scope';
import { setContext } from '../../system/vscode/context';
import { isVirtualUri } from '../../system/vscode/utils';
import type { FileHistoryView } from '../fileHistoryView';
import { SubscribeableViewNode } from './abstract/subscribeableViewNode';
import type { ViewNode } from './abstract/viewNode';
import { ContextValues } from './abstract/viewNode';
import { FileHistoryNode } from './fileHistoryNode';

export class FileHistoryTrackerNode extends SubscribeableViewNode<'file-history-tracker', FileHistoryView> {
	private _base: string | undefined;
	protected override splatted = true;

	constructor(view: FileHistoryView) {
		super('file-history-tracker', unknownGitUri, view);
	}

	override dispose() {
		super.dispose();
		this.child = undefined;
	}

	private _child: FileHistoryNode | undefined;
	protected get child(): FileHistoryNode | undefined {
		return this._child;
	}
	protected set child(value: FileHistoryNode | undefined) {
		if (this._child === value) return;

		this._child?.dispose();
		this._child = value;
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this.child == null) {
			if (!this.hasUri) {
				this.view.description = undefined;

				this.view.message = 'There are no editors open that can provide file history information.';
				return [];
			}

			this.view.message = undefined;

			const commitish: GitCommitish = {
				...this.uri,
				repoPath: this.uri.repoPath!,
				sha: this._base ?? this.uri.sha,
			};
			const fileUri = new GitUri(this.uri, commitish);

			let folder = false;
			try {
				const stats = await workspace.fs.stat(this.uri);
				if ((stats.type & FileType.Directory) === FileType.Directory) {
					folder = true;
				}
			} catch {}

			this.view.title = folder ? 'Folder History' : 'File History';

			let branch;
			if (!commitish.sha || commitish.sha === 'HEAD') {
				branch = await this.view.container.git.getBranch(this.uri.repoPath);
			} else if (!isSha(commitish.sha)) {
				branch = await this.view.container.git.getBranch(this.uri.repoPath, commitish.sha);
			}
			this.child = new FileHistoryNode(fileUri, this.view, this, folder, branch);
		}

		return this.child.getChildren();
	}

	getTreeItem(): TreeItem {
		this.splatted = false;

		const item = new TreeItem('File History', TreeItemCollapsibleState.Expanded);
		item.contextValue = ContextValues.ActiveFileHistory;

		return item;
	}

	get followingEditor(): boolean {
		return this.canSubscribe;
	}

	get hasUri(): boolean {
		return this._uri !== unknownGitUri && this._uri.repoPath != null;
	}

	@gate()
	@log()
	async changeBase() {
		const pick = await showReferencePicker(
			this.uri.repoPath!,
			'Change File History Base',
			'Choose a reference to set as the new base',
			{
				allowRevisions: true,
				picked: this._base,
				sort: { branches: { current: true }, tags: {} },
			},
		);
		if (pick == null) return;

		if (isBranchReference(pick)) {
			const branch = await this.view.container.git.getBranch(this.uri.repoPath);
			this._base = branch?.name === pick.name ? undefined : pick.ref;
		} else {
			this._base = pick.ref;
		}
		if (this.child == null) return;

		this.setUri();
		await this.triggerChange();
	}

	@gate()
	@debug({ exit: true })
	override async refresh(reset: boolean = false) {
		const scope = getLogScope();

		if (!this.canSubscribe) return false;

		if (reset) {
			if (this._uri != null && this._uri !== unknownGitUri) {
				await this.view.container.documentTracker.resetCache(this._uri, 'log');
			}

			this.reset();
		}

		const editor = window.activeTextEditor;
		if (editor == null || !this.view.container.git.isTrackable(editor.document.uri)) {
			if (
				!this.hasUri ||
				(this.view.container.git.isTrackable(this.uri) &&
					window.visibleTextEditors.some(e => e.document?.uri.path === this.uri.path))
			) {
				return true;
			}

			this.reset();

			setLogScopeExit(scope, `, uri=${Logger.toLoggable(this._uri)}`);
			return false;
		}

		if (editor.document.uri.path === this.uri.path) {
			setLogScopeExit(scope, `, uri=${Logger.toLoggable(this._uri)}`);
			return true;
		}

		let gitUri = await GitUri.fromUri(editor.document.uri);

		let uri;
		if (gitUri.sha != null) {
			// If we have a sha, normalize the history to the working file (so we get a full history all the time)
			const workingUri = await this.view.container.git.getWorkingUri(gitUri.repoPath!, gitUri);
			if (workingUri != null) {
				uri = workingUri;
			}
		}

		if (this.hasUri && UriComparer.equals(uri ?? gitUri, this.uri)) {
			return true;
		}

		if (uri != null) {
			gitUri = await GitUri.fromUri(uri);
		}

		// If we have no repoPath then don't attempt to use the Uri
		if (gitUri.repoPath == null) {
			this.reset();
		} else {
			this.setUri(gitUri);
			this.child = undefined;
		}

		setLogScopeExit(scope, `, uri=${Logger.toLoggable(this._uri)}`);
		return false;
	}

	private reset() {
		this.setUri();
		this.child = undefined;
	}

	@log()
	setEditorFollowing(enabled: boolean) {
		if (enabled) {
			this.setUri();
			// Don't need to call triggerChange here, since canSubscribe will do it
		}

		this.canSubscribe = enabled;
		if (!enabled) {
			void this.triggerChange();
		}
	}

	@log()
	async showHistoryForUri(uri: GitUri) {
		this.setUri(uri);
		await this.triggerChange();
	}

	@debug()
	protected subscribe() {
		return Disposable.from(
			weakEvent(window.onDidChangeActiveTextEditor, debounce(this.onActiveEditorChanged, 250), this),
		);
	}

	protected override etag(): number {
		return 0;
	}

	private _triggerChangeDebounced: Deferrable<() => Promise<void>> | undefined;
	@debug({ args: false })
	private onActiveEditorChanged(editor: TextEditor | undefined) {
		// If we are losing the active editor, give more time before assuming its really gone
		// For virtual repositories the active editor event takes a while to fire
		// Ultimately we need to be using the upcoming Tabs api to avoid this
		if (editor == null && isVirtualUri(this._uri)) {
			if (this._triggerChangeDebounced == null) {
				this._triggerChangeDebounced = debounce(() => this.triggerChange(), 1500);
			}

			void this._triggerChangeDebounced();
			return;
		}
		void this.triggerChange();
	}

	setUri(uri?: GitUri) {
		this._uri = uri ?? unknownGitUri;
		void setContext('gitlens:views:fileHistory:canPin', this.hasUri);
	}
}
