'use strict';
import { Disposable, TextEditor, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import { MessageNode } from './common';
import { UriComparer } from '../../comparers';
import { Container } from '../../container';
import { FileHistoryView } from '../fileHistoryView';
import { FileHistoryNode } from './fileHistoryNode';
import { GitReference } from '../../git/git';
import { GitCommitish, GitUri } from '../../git/gitUri';
import { Logger } from '../../logger';
import { ReferencePicker } from '../../quickpicks';
import { debug, Functions, gate, log } from '../../system';
import { ContextValues, SubscribeableViewNode, unknownGitUri, ViewNode } from './viewNode';

export class FileHistoryTrackerNode extends SubscribeableViewNode<FileHistoryView> {
	private _base: string | undefined;
	private _fileUri: GitUri | undefined;
	private _child: FileHistoryNode | undefined;

	constructor(view: FileHistoryView) {
		super(unknownGitUri, view);
	}

	dispose() {
		super.dispose();

		this.resetChild();
	}

	@debug()
	private resetChild() {
		if (this._child == null) return;

		this._child.dispose();
		this._child = undefined;
	}

	getChildren(): ViewNode[] {
		if (this._child == null) {
			if (this._fileUri == null && this.uri === unknownGitUri) {
				return [
					new MessageNode(
						this.view,
						this,
						'There are no editors open that can provide file history information.',
					),
				];
			}

			const uri = this._fileUri ?? this.uri;
			const commitish: GitCommitish = { ...uri, repoPath: uri.repoPath!, sha: this._base ?? uri.sha };
			const fileUri = new GitUri(uri, commitish);
			this._child = new FileHistoryNode(fileUri, this.view, this);
		}

		return [this._child];
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('File History', TreeItemCollapsibleState.Expanded);
		item.contextValue = ContextValues.ActiveFileHistory;

		void this.ensureSubscription();

		return item;
	}

	@gate()
	@log()
	async changeBase() {
		const pick = await ReferencePicker.show(
			this.uri.repoPath!,
			'Change File History Base',
			'Choose a reference to set as the new base',
			{
				allowEnteringRefs: true,
				picked: this._base,
				// checkmarks: true,
			},
		);
		if (pick == null) return;

		if (GitReference.isBranch(pick)) {
			const branch = await Container.git.getBranch(this.uri.repoPath);
			this._base = branch?.name === pick.name ? undefined : pick.ref;
		} else {
			this._base = pick.ref;
		}
		if (this._child == null) return;

		this._uri = unknownGitUri;
		await this.triggerChange();
	}

	@gate()
	@debug({
		exit: r => `returned ${r}`,
	})
	async refresh(reset: boolean = false) {
		const cc = Logger.getCorrelationContext();

		if (reset) {
			this._uri = unknownGitUri;
			this.resetChild();
		}

		const editor = window.activeTextEditor;
		if (editor == null || !Container.git.isTrackable(editor.document.uri)) {
			if (
				this.uri === unknownGitUri ||
				(Container.git.isTrackable(this.uri) &&
					window.visibleTextEditors.some(e => e.document?.uri.path === this.uri.path))
			) {
				return true;
			}

			this._uri = unknownGitUri;
			this.resetChild();

			if (cc !== undefined) {
				cc.exitDetails = `, uri=${Logger.toLoggable(this._uri)}`;
			}
			return false;
		}

		if (editor.document.uri.path === this.uri.path) {
			if (cc !== undefined) {
				cc.exitDetails = `, uri=${Logger.toLoggable(this._uri)}`;
			}
			return true;
		}

		let gitUri = await GitUri.fromUri(editor.document.uri);

		let uri;
		if (gitUri.sha !== undefined) {
			// If we have a sha, normalize the history to the working file (so we get a full history all the time)
			const workingUri = await Container.git.getWorkingUri(gitUri.repoPath!, gitUri);
			if (workingUri !== undefined) {
				uri = workingUri;
			}
		}

		if (this.uri !== unknownGitUri && UriComparer.equals(uri ?? gitUri, this.uri)) {
			return true;
		}

		if (uri !== undefined) {
			gitUri = await GitUri.fromUri(uri);
		}

		this._uri = gitUri;
		this.resetChild();

		if (cc !== undefined) {
			cc.exitDetails = `, uri=${Logger.toLoggable(this._uri)}`;
		}
		return false;
	}

	@log()
	setEditorFollowing(enabled: boolean) {
		if (enabled && this._fileUri !== undefined) {
			this._fileUri = undefined;
			this._base = undefined;

			this._uri = unknownGitUri;
			// Don't need to call triggerChange here, since canSubscribe will do it
		}

		this.canSubscribe = enabled;
	}

	@log()
	async showHistoryForUri(uri: GitUri, baseRef?: string) {
		this._fileUri = uri;
		this._base = baseRef;

		this._uri = unknownGitUri;
		await this.triggerChange();
	}

	@debug()
	protected subscribe() {
		return Disposable.from(
			window.onDidChangeActiveTextEditor(Functions.debounce(this.onActiveEditorChanged, 500), this),
		);
	}

	@debug({ args: false })
	private onActiveEditorChanged(_editor: TextEditor | undefined) {
		void this.triggerChange();
	}
}
