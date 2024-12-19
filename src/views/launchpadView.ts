import type { ConfigurationChangeEvent, TreeViewVisibilityChangeEvent } from 'vscode';
import { Disposable, ThemeIcon, TreeItem, TreeItemCollapsibleState, Uri, window } from 'vscode';
import type { OpenWalkthroughCommandArgs } from '../commands/walkthroughs';
import type { LaunchpadViewConfig, ViewFilesLayout } from '../config';
import { proBadge } from '../constants';
import { GlCommand } from '../constants.commands';
import type { Container } from '../container';
import { AuthenticationRequiredError } from '../errors';
import { PlusFeatures } from '../features';
import { GitUri, unknownGitUri } from '../git/gitUri';
import type { SubscriptionChangeEvent } from '../plus/gk/account/subscriptionService';
import { ensurePlusFeaturesEnabled } from '../plus/gk/utils';
import type { LaunchpadCommandArgs } from '../plus/launchpad/launchpad';
import type { LaunchpadItem } from '../plus/launchpad/launchpadProvider';
import { groupAndSortLaunchpadItems } from '../plus/launchpad/launchpadProvider';
import type { LaunchpadGroup } from '../plus/launchpad/models';
import { launchpadGroupIconMap, launchpadGroupLabelMap } from '../plus/launchpad/models';
import { createCommand, executeCommand } from '../system/vscode/command';
import { configuration } from '../system/vscode/configuration';
import { CacheableChildrenViewNode } from './nodes/abstract/cacheableChildrenViewNode';
import type { ClipboardType, ViewNode } from './nodes/abstract/viewNode';
import { ContextValues, getViewNodeId } from './nodes/abstract/viewNode';
import type { GroupingNode } from './nodes/groupingNode';
import { LaunchpadViewGroupingNode } from './nodes/launchpadViewGroupingNode';
import { getPullRequestChildren, getPullRequestTooltip } from './nodes/pullRequestNode';
import { disposeChildren, ViewBase } from './viewBase';
import { registerViewCommand } from './viewCommands';

export class LaunchpadItemNode extends CacheableChildrenViewNode<'launchpad-item', LaunchpadView> {
	readonly repoPath: string | undefined;

	constructor(
		view: LaunchpadView,
		protected override readonly parent: ViewNode,
		private readonly group: LaunchpadGroup,
		public readonly item: LaunchpadItem,
	) {
		const repoPath = item.openRepository?.repo?.path;

		super('launchpad-item', repoPath != null ? GitUri.fromRepoPath(repoPath) : unknownGitUri, view, parent);

		this.updateContext({ launchpadGroup: group, launchpadItem: item });
		this._uniqueId = getViewNodeId(this.type, this.context);
		this.repoPath = repoPath;
	}

	override get id(): string {
		return this._uniqueId;
	}

	override toClipboard(type?: ClipboardType): string {
		const url = this.getUrl();
		switch (type) {
			case 'markdown':
				return `[${this.item.underlyingPullRequest.id}](${url}) ${this.item.underlyingPullRequest.title}`;
			default:
				return url;
		}
	}

	override getUrl(): string {
		return this.item.url ?? this.item.underlyingPullRequest.url;
	}

	get pullRequest() {
		return this.item.type === 'pullrequest' ? this.item.underlyingPullRequest : undefined;
	}

	async getChildren(): Promise<ViewNode[]> {
		if (this.children == null) {
			const children = await getPullRequestChildren(
				this.view,
				this,
				this.item.underlyingPullRequest,
				this.item.openRepository?.repo ?? this.repoPath,
			);
			this.children = children;
		}

		return this.children;
	}

	getTreeItem(): TreeItem {
		const lpi = this.item;

		const item = new TreeItem(
			lpi.title.length > 60 ? `${lpi.title.substring(0, 60)}...` : lpi.title,
			this.item.openRepository?.localBranch?.current
				? TreeItemCollapsibleState.Expanded
				: TreeItemCollapsibleState.Collapsed,
		);
		item.contextValue = ContextValues.LaunchpadItem;
		item.description = `\u00a0 ${lpi.repository.owner.login}/${lpi.repository.name}#${lpi.id} \u00a0 ${
			lpi.codeSuggestionsCount > 0 ? ` $(gitlens-code-suggestion) ${lpi.codeSuggestionsCount}` : ''
		}`;
		item.iconPath = lpi.author?.avatarUrl != null ? Uri.parse(lpi.author.avatarUrl) : undefined;
		item.command = createCommand<[Omit<LaunchpadCommandArgs, 'command'>]>(
			GlCommand.ShowLaunchpad,
			'Open in Launchpad',
			{
				source: 'launchpad-view',
				state: {
					item: { ...this.item, group: this.group },
				},
			} satisfies Omit<LaunchpadCommandArgs, 'command'>,
		);

		if (lpi.type === 'pullrequest') {
			item.contextValue += '+pr';
			item.tooltip = getPullRequestTooltip(lpi.underlyingPullRequest, {
				idPrefix: `${lpi.repository.owner.login}/${lpi.repository.name}`,
				codeSuggestionsCount: lpi.codeSuggestionsCount,
			});
		}

		return item;
	}
}

export class LaunchpadViewNode extends CacheableChildrenViewNode<
	'launchpad',
	LaunchpadView,
	GroupingNode | LaunchpadItemNode
> {
	private disposable: Disposable;

	constructor(view: LaunchpadView) {
		super('launchpad', unknownGitUri, view);
		this.disposable = Disposable.from(
			this.view.container.launchpad.onDidChange(this.refresh, this),
			this.view.container.subscription.onDidChange(this.onSubscriptionChanged, this),
		);
	}

	override dispose() {
		this.disposable?.dispose();
		super.dispose();
	}

	private onSubscriptionChanged(e: SubscriptionChangeEvent) {
		if (e.current.plan !== e.previous.plan) {
			void this.triggerChange(true);
		}
	}

	override refresh() {
		if (this.children == null) return;

		disposeChildren(this.children);
		this.children = undefined;
	}

	async getChildren(): Promise<(GroupingNode | LaunchpadItemNode)[]> {
		this.view.description = this.view.grouped
			? `${this.view.name.toLocaleLowerCase()}\u00a0\u2022\u00a0 ${proBadge}`
			: proBadge;
		this.view.message = undefined;

		if (this.children == null) {
			const access = await this.view.container.git.access(PlusFeatures.Launchpad);
			if (!access.allowed) return [];

			const children: (GroupingNode | LaunchpadItemNode)[] = [];

			const hasIntegrations = await this.view.container.launchpad.hasConnectedIntegration();
			if (!hasIntegrations) {
				return [];
			}

			try {
				const result = await this.view.container.launchpad.getCategorizedItems();
				if (!result.items?.length) {
					this.view.message = 'All done! Take a vacation.';
					return [];
				}

				const uiGroups = groupAndSortLaunchpadItems(result.items);
				const expanded = new Map(
					(
						(this.view.container.storage.get('launchpadView:groups:expanded') satisfies
							| LaunchpadGroup[]
							| undefined) ?? []
					).map(g => [g, true]),
				);
				for (const [ui, groupItems] of uiGroups) {
					if (!groupItems.length) continue;

					const icon = launchpadGroupIconMap.get(ui)!;

					children.push(
						new LaunchpadViewGroupingNode(
							this.view,
							launchpadGroupLabelMap.get(ui)!,
							ui,
							groupItems.map(i => new LaunchpadItemNode(this.view, this, ui, i)),
							ui === 'current-branch' || expanded.get(ui)
								? TreeItemCollapsibleState.Expanded
								: TreeItemCollapsibleState.Collapsed,
							undefined,
							undefined,
							new ThemeIcon(icon.substring(2, icon.length - 1)),
						),
					);
				}
			} catch (ex) {
				if (!(ex instanceof AuthenticationRequiredError)) throw ex;
			}

			this.children = children;
		}

		return this.children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem('Launchpad', TreeItemCollapsibleState.Expanded);
		return item;
	}
}

export class LaunchpadView extends ViewBase<'launchpad', LaunchpadViewNode, LaunchpadViewConfig> {
	protected readonly configKey = 'launchpad';
	private _disposable: Disposable | undefined;

	constructor(container: Container, grouped?: boolean) {
		super(container, 'launchpad', 'Launchpad', 'launchpadView', grouped);
	}

	override dispose() {
		this._disposable?.dispose();
		super.dispose();
	}

	override getViewDescription(count?: number): string {
		const description = super.getViewDescription(count);
		return description ? `${description} \u00a0\u2022\u00a0 ${proBadge}` : proBadge;
	}

	protected getRoot() {
		return new LaunchpadViewNode(this);
	}

	protected override onVisibilityChanged(e: TreeViewVisibilityChangeEvent): void {
		if (this._disposable == null) {
			this._disposable = Disposable.from(
				this.container.integrations.onDidChangeConnectionState(() => this.refresh(), this),
				this.container.launchpad.onDidRefresh(() => this.refresh(), this),
				this.container.integrations.onDidSyncCloudIntegrations(() => this.refresh(), this),
			);
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
						step: 'accelerate-pr-reviews',
						source: 'launchpad-view',
						detail: 'info',
					}),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('copy'),
				() => executeCommand(GlCommand.ViewsCopy, this.activeSelection, this.selection),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('refresh'),
				() =>
					window.withProgress({ location: { viewId: this.id } }, () =>
						this.container.launchpad.getCategorizedItems({ force: true }),
					),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setFilesLayoutToAuto'),
				() => this.setFilesLayout('auto'),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setFilesLayoutToList'),
				() => this.setFilesLayout('list'),
				this,
			),
			registerViewCommand(
				this.getQualifiedCommand('setFilesLayoutToTree'),
				() => this.setFilesLayout('tree'),
				this,
			),
			registerViewCommand(this.getQualifiedCommand('setShowAvatarsOn'), () => this.setShowAvatars(true), this),
			registerViewCommand(this.getQualifiedCommand('setShowAvatarsOff'), () => this.setShowAvatars(false), this),
		];
	}

	protected override filterConfigurationChanged(e: ConfigurationChangeEvent) {
		const changed = super.filterConfigurationChanged(e);
		if (
			!changed &&
			!configuration.changed(e, 'defaultDateFormat') &&
			!configuration.changed(e, 'defaultDateLocale') &&
			!configuration.changed(e, 'defaultDateShortFormat') &&
			!configuration.changed(e, 'defaultDateSource') &&
			!configuration.changed(e, 'defaultDateStyle') &&
			!configuration.changed(e, 'defaultGravatarsStyle') &&
			!configuration.changed(e, 'defaultTimeFormat')
		) {
			return false;
		}

		return true;
	}

	private setFilesLayout(layout: ViewFilesLayout) {
		return configuration.updateEffective(`views.${this.configKey}.files.layout` as const, layout);
	}

	private setShowAvatars(enabled: boolean) {
		return configuration.updateEffective(`views.${this.configKey}.avatars` as const, enabled);
	}
}
