import type { CancellationToken } from 'vscode';
import { Disposable, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import type { RepositoriesViewConfig } from '../config';
import { Commands } from '../constants';
import type { Container } from '../container';
import { AuthenticationRequiredError } from '../errors';
import { unknownGitUri } from '../git/gitUri';
import type { Draft } from '../gk/models/drafts';
import { showPatchesView } from '../plus/drafts/actions';
import { ensurePlusFeaturesEnabled } from '../plus/gk/utils';
import { groupByFilterMap } from '../system/array';
import { executeCommand } from '../system/command';
import { gate } from '../system/decorators/gate';
import { CacheableChildrenViewNode } from './nodes/abstract/cacheableChildrenViewNode';
import { DraftNode } from './nodes/draftNode';
import { GroupingNode } from './nodes/groupingNode';
import { ViewBase } from './viewBase';
import { registerViewCommand } from './viewCommands';

export class DraftsViewNode extends CacheableChildrenViewNode<'drafts', DraftsView, GroupingNode | DraftNode> {
	constructor(view: DraftsView) {
		super('drafts', unknownGitUri, view);
	}

	async getChildren(): Promise<(GroupingNode | DraftNode)[]> {
		if (this.children == null) {
			const children: (GroupingNode | DraftNode)[] = [];

			try {
				const drafts = await this.view.container.drafts.getDrafts();
				drafts.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

				const groups = groupByFilterMap(
					drafts,
					d => (d.isMine ? 'mine' : 'shared'),
					d => new DraftNode(this.uri, this.view, this, d),
				);

				const mine = groups.get('mine');
				const shared = groups.get('shared');

				if (mine?.length) {
					if (shared?.length) {
						children.push(new GroupingNode(this.view, 'Created by Me', mine));
					} else {
						children.push(...mine);
					}
				}

				if (shared?.length) {
					children.push(new GroupingNode(this.view, 'Shared with Me', shared));
				}
			} catch (ex) {
				if (!(ex instanceof AuthenticationRequiredError)) {
					throw ex;
				}
			}

			this.children = children;
		}

		return this.children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Drafts', TreeItemCollapsibleState.Expanded);
		return item;
	}
}

export class DraftsView extends ViewBase<'drafts', DraftsViewNode, RepositoriesViewConfig> {
	protected readonly configKey = 'drafts';
	private _disposable: Disposable | undefined;

	constructor(container: Container) {
		super(container, 'drafts', 'Cloud Patches', 'draftsView');

		this.description = `PREVIEW\u00a0\u00a0☁️`;
	}

	override dispose() {
		this._disposable?.dispose();
		super.dispose();
	}

	override get canSelectMany(): boolean {
		return false;
	}

	protected getRoot() {
		return new DraftsViewNode(this);
	}

	override async show(options?: { preserveFocus?: boolean | undefined }): Promise<void> {
		if (!(await ensurePlusFeaturesEnabled())) return;

		if (this._disposable == null) {
			// 	this._disposable = Disposable.from(
			// 		this.container.drafts.onDidResetDrafts(() => void this.ensureRoot().triggerChange(true)),
			// 	);
			this._disposable = Disposable.from(this.container.subscription.onDidChange(() => this.refresh(true), this));
		}

		return super.show(options);
	}

	override get canReveal(): boolean {
		return false;
	}

	protected registerCommands(): Disposable[] {
		void this.container.viewCommands;

		return [
			// registerViewCommand(
			// 	this.getQualifiedCommand('info'),
			// 	() => env.openExternal(Uri.parse('https://help.gitkraken.com/gitlens/side-bar/#drafts-☁%ef%b8%8f')),
			// 	this,
			// ),
			registerViewCommand(
				this.getQualifiedCommand('copy'),
				() => executeCommand(Commands.ViewsCopy, this.activeSelection, this.selection),
				this,
			),
			registerViewCommand(this.getQualifiedCommand('refresh'), () => this.refresh(true), this),
			registerViewCommand(
				this.getQualifiedCommand('create'),
				async () => {
					await executeCommand(Commands.CreateCloudPatch);
					void this.ensureRoot().triggerChange(true);
				},
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('delete'),
				async (node: DraftNode) => {
					const confirm = { title: 'Delete' };
					const cancel = { title: 'Cancel', isCloseAffordance: true };
					const result = await window.showInformationMessage(
						`Are you sure you want to delete Cloud Patch '${node.draft.title}'?`,
						{ modal: true },
						confirm,
						cancel,
					);

					if (result === confirm) {
						await this.container.drafts.deleteDraft(node.draft.id);
						void node.getParent()?.triggerChange(true);
					}
				},
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('open'),
				async (node: DraftNode) => {
					let draft = node.draft;
					if (draft.changesets == null) {
						try {
							draft = await this.container.drafts.getDraft(node.draft.id);
						} catch (ex) {
							void window.showErrorMessage(`Unable to open Cloud Patch '${node.draft.id}'`);
							return;
						}
					}
					void showPatchesView({ mode: 'view', draft: draft });
				},
				this,
			),
		];
	}

	async findDraft(draft: Draft, cancellation?: CancellationToken) {
		return this.findNode((n: any) => n.draft?.id === draft.id, {
			allowPaging: false,
			maxDepth: 2,
			canTraverse: n => {
				if (n instanceof DraftsViewNode) return true;

				return false;
			},
			token: cancellation,
		});
	}

	@gate(() => '')
	async revealDraft(
		draft: Draft,
		options?: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		},
	) {
		const node = await this.findDraft(draft);
		if (node == null) return undefined;

		await this.ensureRevealNode(node, options);

		return node;
	}
}
