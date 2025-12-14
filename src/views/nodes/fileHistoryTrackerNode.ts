import type { Disposable, TextEditor } from 'vscode';
import { TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import type { GitCommitish } from '../../git/gitUri';
import { GitUri, unknownGitUri } from '../../git/gitUri';
import { ensureWorkingUri } from '../../git/gitUri.utils';
import { isBranchReference } from '../../git/utils/reference.utils';
import { isSha } from '../../git/utils/revision.utils';
import { showReferencePicker } from '../../quickpicks/referencePicker';
import { setContext } from '../../system/-webview/context';
import { isFolderUri } from '../../system/-webview/path';
import { isVirtualUri } from '../../system/-webview/vscode/uris';
import { gate } from '../../system/decorators/gate';
import { debug, log } from '../../system/decorators/log';
import { weakEvent } from '../../system/event';
import type { Deferrable } from '../../system/function/debounce';
import { debounce } from '../../system/function/debounce';
import { Logger } from '../../system/logger';
import { getLogScope, setLogScopeExit } from '../../system/logger.scope';
import { areUrisEqual } from '../../system/uri';
import type { FileHistoryView } from '../fileHistoryView';
import { SubscribeableViewNode } from './abstract/subscribeableViewNode';
import type { ViewNode } from './abstract/viewNode';
import { ContextValues } from './abstract/viewNode';
import { FileHistoryNode } from './fileHistoryNode';

export class FileHistoryTrackerNode extends SubscribeableViewNode<'file-history-tracker', FileHistoryView> {
	private _base: string | undefined;

	constructor(view: FileHistoryView) {
		super('file-history-tracker', unknownGitUri, view);
	}

	override dispose(): void {
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

	protected override etag(): number {
		return 0;
	}

	get followingEditor(): boolean {
		return this.canSubscribe;
	}

	get hasUri(): boolean {
		return this._uri !== unknownGitUri && this._uri.repoPath != null;
	}

	async getChildren(): Promise<ViewNode[]> {
		this.view.message = undefined;

		if (this.child == null) {
			this.view.groupedLabel ??= this.view.name.toLocaleLowerCase();

			if (!this.hasUri) {
				this.view.description = this.view.grouped ? this.view.groupedLabel : undefined;

				this.view.message = 'There are no editors open that can provide file history information.';
				this.children = undefined;
				return [];
			}

			const commitish: GitCommitish = {
				...this.uri,
				repoPath: this.uri.repoPath!,
				sha: this._base ?? this.uri.sha,
			};
			const fileUri = new GitUri(this.uri, commitish);
			const folder = await isFolderUri(this.uri);

			if (this.view.grouped) {
				this.view.groupedLabel = (folder ? 'Folder History' : 'File History').toLocaleLowerCase();
				this.view.description = this.view.groupedLabel;
			} else {
				this.view.title = folder ? 'Folder History' : 'File History';
			}

			const svc = this.view.container.git.getRepositoryService(commitish.repoPath);

			let branch;
			if (!commitish.sha || commitish.sha === 'HEAD') {
				branch = await svc.branches.getBranch();
			} else if (!isSha(commitish.sha)) {
				branch = await svc.branches.getBranch(commitish.sha);
			}
			this.child = new FileHistoryNode(fileUri, this.view, this, folder, branch);
		}

		const children = this.child.getChildren();
		void children.then(children => {
			this.children = children;
			if (this._selectSha != null) {
				setTimeout(() => void this.revealCommit(), 250);
			}
		});
		return children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('File History', TreeItemCollapsibleState.Expanded);
		item.contextValue = ContextValues.ActiveFileHistory;

		return item;
	}

	@gate()
	@debug({ exit: true })
	override async refresh(reset: boolean = false): Promise<{ cancel: boolean }> {
		const scope = getLogScope();

		if (!this.canSubscribe) return { cancel: false };

		if (reset) {
			if (this._uri != null && this._uri !== unknownGitUri) {
				await this.view.container.documentTracker.resetCache(this._uri, 'log');
			}

			this.reset();
		}

		const updated = await this.updateUri(this._selectSha);
		setLogScopeExit(scope, `, uri=${Logger.toLoggable(this._uri)}`);
		return { cancel: !updated };
	}

	@debug()
	protected async subscribe(): Promise<Disposable | undefined> {
		await this.updateUri(this._selectSha);

		return weakEvent(window.onDidChangeActiveTextEditor, debounce(this.onActiveEditorChanged, 250), this);
	}

	private _triggerChangeDebounced: Deferrable<() => Promise<void>> | undefined;
	@debug({ args: false })
	private onActiveEditorChanged(editor: TextEditor | undefined) {
		// If we are losing the active editor, give more time before assuming its really gone
		// For virtual repositories the active editor event takes a while to fire
		// Ultimately we need to be using the upcoming Tabs api to avoid this
		if (editor == null && isVirtualUri(this._uri)) {
			this._triggerChangeDebounced ??= debounce(() => this.triggerChange(), 1500);
			void this._triggerChangeDebounced();
			return;
		}
		void this.triggerChange();
	}

	@gate()
	@log()
	async changeBase(): Promise<void> {
		const pick = await showReferencePicker(
			this.uri.repoPath!,
			'Change File History Base',
			'Choose a reference to set as the new base',
			{
				allowedAdditionalInput: { rev: true },
				picked: this._base,
				sort: { branches: { current: true }, tags: {} },
			},
		);
		if (pick == null) return;

		if (isBranchReference(pick)) {
			const branch = await this.view.container.git.getRepositoryService(this.uri.repoPath!).branches.getBranch();
			this._base = branch?.name === pick.name ? undefined : pick.ref;
		} else {
			this._base = pick.ref;
		}
		if (this.child == null) return;

		this.setUri();
		await this.triggerChange();
	}

	@log()
	setEditorFollowing(enabled: boolean): void {
		if (enabled) {
			this.setUri();
			// Don't need to call triggerChange here, since canSubscribe will do it
		}

		this.canSubscribe = enabled;
		if (!enabled) {
			void this.triggerChange();
		}
	}

	@debug()
	setUri(uri?: GitUri, sha?: string): void {
		this._uri = uri ?? unknownGitUri;
		this._selectSha = sha ?? uri?.sha;
		void setContext('gitlens:views:fileHistory:canPin', this.hasUri);
	}

	@log()
	async showHistoryForUri(uri: GitUri): Promise<void> {
		this.setUri(uri);
		await this.triggerChange();
	}

	private reset() {
		this.setUri();
		this.child = undefined;
		this._selectSha = undefined;
	}

	private _selectSha: string | undefined;

	private async updateUri(sha?: string): Promise<boolean> {
		const editor = window.activeTextEditor;
		if (editor == null || !this.view.container.git.isTrackable(editor.document.uri)) {
			if (
				!this.hasUri ||
				(this.view.container.git.isTrackable(this.uri) &&
					window.visibleTextEditors.some(e => e.document?.uri.path === this.uri.path))
			) {
				return false;
			}

			this.reset();
			return true;
		}

		let gitUri = await GitUri.fromUri(editor.document.uri);

		if (editor.document.uri.path === this.uri.path) {
			this._selectSha = sha ?? gitUri.sha;
			queueMicrotask(() => void this.revealCommit());
			return false;
		}

		// If we have a sha, normalize the history to the working file (so we get a full history all the time)
		const uri = await ensureWorkingUri(this.view.container, gitUri);

		if (this.hasUri && areUrisEqual(uri ?? gitUri, this.uri)) {
			this._selectSha = sha ?? gitUri.sha;
			queueMicrotask(() => void this.revealCommit());
			return false;
		}

		if (uri != null) {
			gitUri = await GitUri.fromUri(uri);
		}

		// If we have no repoPath then don't attempt to use the Uri
		if (!gitUri.repoPath) {
			this.reset();
			return true;
		}

		this.setUri(gitUri, sha);
		this.child = undefined;

		return true;
	}

	async revealCommit(): Promise<void> {
		const sha = this._selectSha;
		this._selectSha = undefined;

		const { children } = this;
		if (!children?.length) return;

		let node;
		if (sha == null || sha === 'HEAD') {
			[node] = children;
		} else {
			node = children.find(n =>
				n.is('file-commit') || n.is('commit') ? (n.commit?.sha?.startsWith(sha) ?? false) : false,
			);
			if (!node) {
				node = children[children.length - 1];
				if (!node.is('pager')) {
					node = undefined;
				}
			}
		}
		if (!node) return;

		await this.view.reveal(node, { select: true, focus: false });
	}
}
