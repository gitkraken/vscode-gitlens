import type { CancellationToken, TreeViewVisibilityChangeEvent } from 'vscode';
import { Disposable, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import type { OpenWalkthroughCommandArgs } from '../commands/walkthroughs';
import type { DraftsViewConfig } from '../config';
import { previewBadge } from '../constants';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { AuthenticationRequiredError } from '../errors';
import { unknownGitUri } from '../git/gitUri';
import type { Draft } from '../gk/models/drafts';
import { ensurePlusFeaturesEnabled } from '../plus/gk/utils';
import { gate } from '../system/decorators/gate';
import { groupByFilterMap } from '../system/iterable';
import { executeCommand } from '../system/vscode/command';
import { configuration } from '../system/vscode/configuration';
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
				drafts?.sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime());

				const groups = groupByFilterMap(
					drafts,
					this.calcDraftGroupKey.bind(this),
					d => new DraftNode(this.uri, this.view, this, d),
				);

				const mine = groups.get('mine');
				const shared = groups.get('shared');
				const isFlat = mine?.length && !shared?.length;

				if (!isFlat) {
					if (mine?.length) {
						children.push(new GroupingNode(this.view, 'Created by Me', mine));
					}
					if (shared?.length) {
						children.push(new GroupingNode(this.view, 'Shared with Me', shared));
					}
				} else {
					children.push(...mine);
				}
			} catch (ex) {
				if (!(ex instanceof AuthenticationRequiredError)) throw ex;
			}

			this.children = children;
		}

		return this.children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Drafts', TreeItemCollapsibleState.Expanded);
		return item;
	}

	private calcDraftGroupKey(d: Draft): DraftGroupKey {
		if (d.type === 'suggested_pr_change') {
			return 'pr_suggestion';
		}
		return d.isMine ? 'mine' : 'shared';
	}
}

type DraftGroupKey = 'pr_suggestion' | 'mine' | 'shared';

export class DraftsView extends ViewBase<'drafts', DraftsViewNode, DraftsViewConfig> {
	protected readonly configKey = 'drafts';
	private _disposable: Disposable | undefined;

	constructor(container: Container) {
		super(container, 'drafts', 'Cloud Patches', 'draftsView');

		this.description = previewBadge;
	}

	override dispose() {
		this._disposable?.dispose();
		super.dispose();
	}

	protected getRoot() {
		return new DraftsViewNode(this);
	}

	protected override onVisibilityChanged(e: TreeViewVisibilityChangeEvent): void {
		if (this._disposable == null) {
			this._disposable = Disposable.from(this.container.subscription.onDidChange(() => this.refresh(true), this));
		}

		super.onVisibilityChanged(e);
	}

	override async show(options?: { preserveFocus?: boolean | undefined }): Promise<void> {
		if (!(await ensurePlusFeaturesEnabled())) return;

		return super.show(options);
	}

	override get canReveal(): boolean {
		return false;
	}

	protected registerCommands(): Disposable[] {
		return [
			registerViewCommand(
				this.getQualifiedCommand('info'),
				() =>
					executeCommand<OpenWalkthroughCommandArgs>(GlCommand.OpenWalkthrough, {
						step: 'streamline-collaboration',
						source: 'cloud-patches',
						detail: 'info',
					}),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('copy'),
				() => executeCommand(GlCommand.ViewsCopy, this.activeSelection, this.selection),
				this,
			),
			registerViewCommand(this.getQualifiedCommand('refresh'), () => this.refresh(true), this),
			registerViewCommand(
				this.getQualifiedCommand('create'),
				async () => {
					await executeCommand(GlCommand.CreateCloudPatch);
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
			registerViewCommand(this.getQualifiedCommand('setShowAvatarsOn'), () => this.setShowAvatars(true), this),
			registerViewCommand(this.getQualifiedCommand('setShowAvatarsOff'), () => this.setShowAvatars(false), this),
		];
	}

	async findDraft(draft: Draft, cancellation?: CancellationToken) {
		return this.findNode((n: any) => n.draft?.id === draft.id, {
			allowPaging: false,
			maxDepth: 2,
			canTraverse: n => {
				if (n instanceof DraftsViewNode || n instanceof GroupingNode) return true;

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

	private setShowAvatars(enabled: boolean) {
		return configuration.updateEffective(`views.${this.configKey}.avatars` as const, enabled);
	}
}
