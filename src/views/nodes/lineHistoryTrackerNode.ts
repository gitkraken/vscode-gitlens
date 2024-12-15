import type { Selection } from 'vscode';
import { TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import type { GitCommitish } from '../../git/gitUri';
import { GitUri, unknownGitUri } from '../../git/gitUri';
import { isBranchReference } from '../../git/models/reference.utils';
import { deletedOrMissing } from '../../git/models/revision';
import { isSha } from '../../git/models/revision.utils';
import { showReferencePicker } from '../../quickpicks/referencePicker';
import { UriComparer } from '../../system/comparers';
import { gate } from '../../system/decorators/gate';
import { debug, log } from '../../system/decorators/log';
import { weakEvent } from '../../system/event';
import { debounce } from '../../system/function';
import { Logger } from '../../system/logger';
import { getLogScope, setLogScopeExit } from '../../system/logger.scope';
import { setContext } from '../../system/vscode/context';
import type { LinesChangeEvent } from '../../trackers/lineTracker';
import type { FileHistoryView } from '../fileHistoryView';
import type { LineHistoryView } from '../lineHistoryView';
import { SubscribeableViewNode } from './abstract/subscribeableViewNode';
import type { ViewNode } from './abstract/viewNode';
import { ContextValues } from './abstract/viewNode';
import { LineHistoryNode } from './lineHistoryNode';

export class LineHistoryTrackerNode extends SubscribeableViewNode<
	'line-history-tracker',
	FileHistoryView | LineHistoryView
> {
	private _base: string | undefined;
	private _editorContents: string | undefined;
	private _selection: Selection | undefined;
	protected override splatted = true;

	constructor(view: FileHistoryView | LineHistoryView) {
		super('line-history-tracker', unknownGitUri, view);
	}

	override dispose() {
		super.dispose();
		this.child = undefined;
	}

	private _child: LineHistoryNode | undefined;
	protected get child(): LineHistoryNode | undefined {
		return this._child;
	}
	protected set child(value: LineHistoryNode | undefined) {
		if (this._child === value) return;

		this._child?.dispose();
		this._child = value;
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this.child == null) {
			if (!this.hasUri) {
				this.view.description = undefined;

				this.view.message = 'There are no editors open that can provide line history information.';
				return [];
			}

			const selection = this._selection;
			const editorContents = this._editorContents;

			if (selection == null) {
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
				branch = await this.view.container.git.getBranch(this.uri.repoPath, commitish.sha);
			}
			this.child = new LineHistoryNode(fileUri, this.view, this, branch, selection, editorContents);
		}

		return this.child.getChildren();
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
		return this._uri !== unknownGitUri && this._uri.repoPath != null;
	}

	@gate()
	@log()
	async changeBase() {
		const pick = await showReferencePicker(
			this.uri.repoPath!,
			'Change Line History Base',
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

		if (
			editor.document.uri.path === this.uri.path &&
			this._selection != null &&
			editor.selection.isEqual(this._selection)
		) {
			setLogScopeExit(scope, `, uri=${Logger.toLoggable(this._uri)}`);
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
			this.child = undefined;
		}

		setLogScopeExit(scope, `, uri=${Logger.toLoggable(this._uri)}`);
		return false;
	}

	private reset() {
		this.setUri();
		this._editorContents = undefined;
		this._selection = undefined;
		this.child = undefined;
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
			weakEvent(
				this.view.container.lineTracker.onDidChangeActiveLines,
				(e: LinesChangeEvent) => {
					if (e.pending) return;

					onActiveLinesChanged(e);
				},
				this,
			),
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
		void setContext('gitlens:views:fileHistory:canPin', this.hasUri);
	}
}
