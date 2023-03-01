import type { Selection } from 'vscode';
import { TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import { ContextKeys } from '../../constants';
import { setContext } from '../../context';
import type { GitCommitish } from '../../git/gitUri';
import { GitUri, unknownGitUri } from '../../git/gitUri';
import { deletedOrMissing } from '../../git/models/constants';
import { isBranchReference, isSha } from '../../git/models/reference';
import { showReferencePicker } from '../../quickpicks/referencePicker';
import { UriComparer } from '../../system/comparers';
import { gate } from '../../system/decorators/gate';
import { debug, log } from '../../system/decorators/log';
import { debounce } from '../../system/function';
import { Logger } from '../../system/logger';
import { getLogScope } from '../../system/logger.scope';
import type { LinesChangeEvent } from '../../trackers/gitLineTracker';
import type { FileHistoryView } from '../fileHistoryView';
import type { LineHistoryView } from '../lineHistoryView';
import { LineHistoryNode } from './lineHistoryNode';
import type { ViewNode } from './viewNode';
import { ContextValues, SubscribeableViewNode } from './viewNode';

export class LineHistoryTrackerNode extends SubscribeableViewNode<FileHistoryView | LineHistoryView> {
	private _base: string | undefined;
	private _child: LineHistoryNode | undefined;
	private _editorContents: string | undefined;
	private _selection: Selection | undefined;
	protected override splatted = true;

	constructor(view: FileHistoryView | LineHistoryView) {
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

				this.view.message = 'There are no editors open that can provide line history information.';
				return [];
			}

			if (this._selection == null) {
				this.view.description = undefined;

				this.view.message = 'There was no selection provided for line history.';
				this.view.description = `${this.uri.fileName}${
					this.uri.sha
						? ` ${this.uri.sha === deletedOrMissing ? this.uri.shortSha : `(${this.uri.shortSha})`}`
						: ''
				}${!this.followingEditor ? ' (pinned)' : ''}`;
				return [];
			}

			this.view.message = undefined;

			const commitish: GitCommitish = {
				...this.uri,
				repoPath: this.uri.repoPath!,
				sha: this.uri.sha ?? this._base,
			};
			const fileUri = new GitUri(this.uri, commitish);

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
			this._child = new LineHistoryNode(fileUri, this.view, this, branch, this._selection, this._editorContents);
		}

		return this._child.getChildren();
	}

	getTreeItem(): TreeItem {
		this.splatted = false;

		const item = new TreeItem('Line History', TreeItemCollapsibleState.Expanded);
		item.contextValue = ContextValues.ActiveLineHistory;

		void this.ensureSubscription();

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
			'Change Line History Base',
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

		if (
			editor.document.uri.path === this.uri.path &&
			this._selection != null &&
			editor.selection.isEqual(this._selection)
		) {
			if (scope != null) {
				scope.exitDetails = `, uri=${Logger.toLoggable(this._uri)}`;
			}
			return true;
		}

		const gitUri = await GitUri.fromUri(editor.document.uri);

		if (
			this.hasUri &&
			UriComparer.equals(gitUri, this.uri) &&
			this._selection != null &&
			editor.selection.isEqual(this._selection)
		) {
			return true;
		}

		// If we have no repoPath then don't attempt to use the Uri
		if (gitUri.repoPath == null) {
			this.reset();
		} else {
			this.setUri(gitUri);
			this._editorContents = editor.document.isDirty ? editor.document.getText() : undefined;
			this._selection = editor.selection;
			this.resetChild();
		}

		if (scope != null) {
			scope.exitDetails = `, uri=${Logger.toLoggable(this._uri)}`;
		}
		return false;
	}

	private reset() {
		this.setUri();
		this._editorContents = undefined;
		this._selection = undefined;
		this.resetChild();
	}

	@log()
	setEditorFollowing(enabled: boolean) {
		this.canSubscribe = enabled;
	}

	@debug()
	protected subscribe() {
		if (this.view.container.lineTracker.subscribed(this)) return undefined;

		const onActiveLinesChanged = debounce(this.onActiveLinesChanged.bind(this), 250);

		return this.view.container.lineTracker.subscribe(
			this,
			this.view.container.lineTracker.onDidChangeActiveLines((e: LinesChangeEvent) => {
				if (e.pending) return;

				onActiveLinesChanged(e);
			}),
		);
	}

	protected override etag(): number {
		return 0;
	}

	@debug<LineHistoryTrackerNode['onActiveLinesChanged']>({
		args: {
			0: e =>
				`editor=${e.editor?.document.uri.toString(true)}, selections=${e.selections
					?.map(s => `[${s.anchor}-${s.active}]`)
					.join(',')}, pending=${Boolean(e.pending)}, reason=${e.reason}`,
		},
	})
	private onActiveLinesChanged(_e: LinesChangeEvent) {
		void this.triggerChange();
	}

	setUri(uri?: GitUri) {
		this._uri = uri ?? unknownGitUri;
		void setContext(ContextKeys.ViewsFileHistoryCanPin, this.hasUri);
	}
}
