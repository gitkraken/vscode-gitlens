import type { TextEditor } from 'vscode';
import { Disposable, FileType, TreeItem, TreeItemCollapsibleState, window, workspace } from 'vscode';
import { ContextKeys } from '../../constants';
import { setContext } from '../../context';
import type { GitCommitish } from '../../git/gitUri';
import { GitUri, unknownGitUri } from '../../git/gitUri';
import { isBranchReference, isSha } from '../../git/models/reference';
import { showReferencePicker } from '../../quickpicks/referencePicker';
import { UriComparer } from '../../system/comparers';
import { gate } from '../../system/decorators/gate';
import { debug, log } from '../../system/decorators/log';
import type { Deferrable } from '../../system/function';
import { debounce } from '../../system/function';
import { Logger } from '../../system/logger';
import { getLogScope } from '../../system/logger.scope';
import { isVirtualUri } from '../../system/utils';
import type { FileHistoryView } from '../fileHistoryView';
import { FileHistoryNode } from './fileHistoryNode';
import type { ViewNode } from './viewNode';
import { ContextValues, SubscribeableViewNode } from './viewNode';

export class FileHistoryTrackerNode extends SubscribeableViewNode<FileHistoryView> {
	private _base: string | undefined;
	private _child: FileHistoryNode | undefined;
	protected override splatted = true;

	constructor(view: FileHistoryView) {
		super(unknownGitUri, view);
	}

	override dispose() {
		super.dispose();

		this.resetChild();
	}

	@debug()
	private resetChild() {
		if (this._child == null) return;

		this._child.dispose();
		this._child = undefined;
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this._child == null) {
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
				({
					values: [branch],
				} = await this.view.container.git.getBranches(this.uri.repoPath, {
					filter: b => b.name === commitish.sha,
				}));
			}
			this._child = new FileHistoryNode(fileUri, this.view, this, folder, branch);
		}

		return this._child.getChildren();
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
		return this._uri != unknownGitUri;
	}

	@gate()
	@log()
	async changeBase() {
		const pick = await showReferencePicker(
			this.uri.repoPath!,
			'Change File History Base',
			'Choose a reference to set as the new base',
			{
				allowEnteringRefs: true,
				picked: this._base,
				// checkmarks: true,
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
		if (this._child == null) return;

		this.setUri();
		await this.triggerChange();
	}

	@gate()
	@debug({
		exit: r => `returned ${r}`,
	})
	override async refresh(reset: boolean = false) {
		const scope = getLogScope();

		if (!this.canSubscribe) return false;

		if (reset) {
			if (this._uri != null && this._uri !== unknownGitUri) {
				await this.view.container.tracker.resetCache(this._uri, 'log');
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

			if (scope != null) {
				scope.exitDetails = `, uri=${Logger.toLoggable(this._uri)}`;
			}
			return false;
		}

		if (editor.document.uri.path === this.uri.path) {
			if (scope != null) {
				scope.exitDetails = `, uri=${Logger.toLoggable(this._uri)}`;
			}
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
			this.resetChild();
		}

		if (scope != null) {
			scope.exitDetails = `, uri=${Logger.toLoggable(this._uri)}`;
		}
		return false;
	}

	private reset() {
		this.setUri();
		this.resetChild();
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
		return Disposable.from(window.onDidChangeActiveTextEditor(debounce(this.onActiveEditorChanged, 250), this));
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
		void setContext(ContextKeys.ViewsFileHistoryCanPin, this.hasUri);
	}
}
