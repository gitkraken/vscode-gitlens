import type { Command, Disposable, Uri } from 'vscode';
import { commands, l10n, MarkdownString, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { getScopedCounter } from '@gitlens/utils/counter.js';
import { getNumericFormat } from '@gitlens/utils/date.js';
import { isPromise } from '@gitlens/utils/promise.js';
import { compareSubstringIgnoreCase, equalsIgnoreCase } from '@gitlens/utils/string.js';
import { GlyphChars } from '../../constants.js';
import { unknownGitUri } from '../../git/gitUri.js';
import type { GlRepository } from '../../git/models/repository.js';
import { configuration } from '../../system/-webview/configuration.js';
import type { View } from '../viewBase.js';
import type { PageableViewNode } from './abstract/viewNode.js';
import { ContextValues, ViewNode } from './abstract/viewNode.js';

type AllowedContextValues = ContextValues | `gitlens:views:${View['type']}`;

export class MessageNode extends ViewNode<'message'> {
	constructor(
		view: View,
		protected override readonly parent: ViewNode,
		protected message: string,
		protected description?: string,
		protected tooltip?: string,
		protected iconPath?: TreeItem['iconPath'],
		protected contextValue?: AllowedContextValues,
		protected resourceUri?: Uri,
	) {
		super('message', unknownGitUri, view, parent);
	}

	getChildren(): ViewNode[] | Promise<ViewNode[]> {
		return [];
	}

	getTreeItem(): TreeItem | Promise<TreeItem> {
		const item = new TreeItem(this.message, TreeItemCollapsibleState.None);
		item.contextValue = this.contextValue ?? ContextValues.Message;
		item.description = this.description;
		item.tooltip = this.tooltip;
		item.iconPath = this.iconPath;
		item.resourceUri = this.resourceUri;
		return item;
	}
}

export class CommandMessageNode extends MessageNode {
	constructor(
		view: View,
		protected override readonly parent: ViewNode,
		private readonly _command: Command,
		message: string,
		description?: string,
		tooltip?: string,
		iconPath?: TreeItem['iconPath'],
		contextValue?: AllowedContextValues,
		resourceUri?: Uri,
	) {
		super(view, parent, message, description, tooltip, iconPath, contextValue, resourceUri);
	}

	override getTreeItem(): TreeItem | Promise<TreeItem> {
		const item = super.getTreeItem();
		if (isPromise(item)) {
			return item.then(i => {
				i.command = this._command;
				return i;
			});
		}

		item.command = this._command;
		return item;
	}

	override getCommand(): Command | undefined {
		return this._command;
	}
}

const actionCommandCounter = getScopedCounter();

export abstract class ActionMessageNodeBase extends CommandMessageNode {
	private readonly _disposable: Disposable;

	constructor(
		view: View,
		parent: ViewNode,
		message: string,
		description?: string,
		tooltip?: string,
		iconPath?: TreeItem['iconPath'],
		contextValue?: AllowedContextValues,
		resourceUri?: Uri,
	) {
		const command = {
			command: `gitlens.node.action:${actionCommandCounter.next()}`,
			title: l10n.t('Execute action'),
		};
		super(view, parent, command, message, description, tooltip, iconPath, contextValue, resourceUri);

		this._disposable = commands.registerCommand(command.command, this.action.bind(this));
	}

	abstract action(): void | Promise<void>;

	override dispose(): void {
		this._disposable.dispose();
	}

	update(options: {
		message?: string;
		description?: string | null;
		tooltip?: string | null;
		iconPath?: TreeItem['iconPath'] | null;
		contextValue?: AllowedContextValues | null;
		resourceUri?: Uri | null;
	}): void {
		this.message = options.message ?? this.message;
		this.description = options.description === null ? undefined : (options.description ?? this.description);
		this.tooltip = options.tooltip === null ? undefined : (options.tooltip ?? this.tooltip);
		this.iconPath = options.iconPath === null ? undefined : (options.iconPath ?? this.iconPath);
		this.contextValue = options.contextValue === null ? undefined : (options.contextValue ?? this.contextValue);
		this.resourceUri = options.resourceUri === null ? undefined : (options.resourceUri ?? this.resourceUri);
		this.view.triggerNodeChange(this);
	}
}

export class ActionMessageNode extends ActionMessageNodeBase {
	private readonly _action: (node: ActionMessageNode) => void | Promise<void>;

	constructor(
		view: View,
		parent: ViewNode,
		action: (node: ActionMessageNode) => void | Promise<void>,
		message: string,
		description?: string,
		tooltip?: string,
		iconPath?: TreeItem['iconPath'],
		contextValue?: AllowedContextValues,
		resourceUri?: Uri,
	) {
		super(view, parent, message, description, tooltip, iconPath, contextValue, resourceUri);
		this._action = action;
	}

	override action(): void | Promise<void> {
		return this._action(this);
	}
}

export class GroupedHeaderNode extends ActionMessageNodeBase {
	constructor(view: View, parent: ViewNode) {
		super(
			view,
			parent,
			view.grouped ? (view.groupedLabel ?? view.name).toLocaleUpperCase() : l10n.t('Showing'),
			view.grouped ? view.description : undefined,
			undefined,
			undefined,
			view.grouped ? `gitlens:views:${view.type}` : undefined,
		);
	}

	override async action(): Promise<void> {
		if (!this.view.canFilterRepositories()) return;
		return this.view.filterRepositories();
	}

	override async getTreeItem(): Promise<TreeItem> {
		const item = await super.getTreeItem();
		const repos = this.view.getFilteredRepositories();

		item.description = this.getDescription(repos);
		item.tooltip = this.getTooltip(repos);
		if (!this.view.grouped) {
			item.iconPath =
				this.view.isRepositoryFilterActive() || this.view.isRepositoryFilterExcludingWorktreesActive()
					? new ThemeIcon('filter-filled')
					: new ThemeIcon('filter');
		}
		return item;
	}

	private getDescription(repos: GlRepository[]): string | undefined {
		const description = this.getViewDescription();
		const label = this.getRepositoryFilterLabel(repos, true);
		return label
			? description
				? `${description} ${GlyphChars.Space}${GlyphChars.Dot}${GlyphChars.Space} ${label}`
				: label
			: description;
	}

	private getTooltip(repos: GlRepository[]): MarkdownString {
		const tooltip = new MarkdownString();
		if (this.view.grouped) {
			tooltip.appendText(this.view.name);
			const description = this.getViewDescription();
			if (description) {
				// TODO: This is so hacky
				if (description.startsWith('(')) {
					tooltip.appendMarkdown(` ${description}`);
				} else if (description.startsWith(GlyphChars.Dot)) {
					tooltip.appendMarkdown(` ${GlyphChars.Space}${description}`);
				} else {
					tooltip.appendMarkdown(`: ${description}`);
				}
			}
		}

		if (!this.view.supportsRepositoryFilter) return tooltip;

		if (this.view.isRepositoryFilterExcludingWorktreesActive()) {
			tooltip.appendMarkdown(
				l10n.t('\n\nShowing all repos, excluding worktrees / submodules\\\nClick to change filtering'),
			);
		} else {
			const { openRepositories } = this.view.container.git;
			const mixed = openRepositories.some(r => r.isWorktree);

			if (this.view.isRepositoryFilterActive()) {
				tooltip.appendMarkdown(
					mixed
						? l10n.t(
								'\n\nShowing {0} of {1} repos / worktrees\\\nClick to change filtering',
								String(repos.length),
								String(openRepositories.length),
							)
						: l10n.t(
								'\n\nShowing {0} of {1} repos\\\nClick to change filtering',
								String(repos.length),
								String(openRepositories.length),
							),
				);
			} else if (repos.length > 1) {
				tooltip.appendMarkdown(
					mixed
						? l10n.t('\n\nShowing all repos / worktrees\\\nClick to filter by a repo or worktree')
						: l10n.t('\n\nShowing all repos\\\nClick to filter by a repo or worktree'),
				);
			}
		}

		return tooltip;
	}

	private getRepositoryFilterLabel(repos?: GlRepository[], addSuffix?: boolean): string | undefined {
		if (!this.view.supportsRepositoryFilter) return undefined;
		if (!repos?.length) return undefined;

		if (repos.length === 1) {
			if (this.view.repositoryFilter?.length) {
				if (!addSuffix) return repos[0].name;

				return this.view.grouped
					? l10n.t('showing {0} — click to change', repos[0].name)
					: l10n.t('{0} — click to change', repos[0].name);
			}
			return undefined;
		}

		// When excluding worktrees/submodules, always show "repos" not "repos / worktrees"
		const mixed = !this.view.supportsWorktreeCollapsing && !this.view.isRepositoryFilterExcludingWorktreesActive();

		const count = getNumericFormat()(repos.length);
		if (!addSuffix) {
			return mixed ? l10n.t('{0} repos / worktrees', count) : l10n.t('{0} repos', count);
		}

		if (this.view.grouped) {
			return mixed
				? l10n.t('showing {0} repos / worktrees — click to filter', count)
				: l10n.t('showing {0} repos — click to filter', count);
		}

		return mixed
			? l10n.t('{0} repos / worktrees — click to filter', count)
			: l10n.t('{0} repos — click to filter', count);
	}

	private getViewDescription(): string | undefined {
		let description = this.view.grouped ? this.view.description : undefined;
		if (description && !equalsIgnoreCase(this.view.name, description)) {
			const index = compareSubstringIgnoreCase(description, this.view.name, 0, this.view.name.length);
			description = index === 0 ? description.substring(this.view.name.length).trimStart() : description;
			if (description.startsWith(':')) {
				description = description.substring(1).trimStart();
			}
			return description;
		}

		return undefined;
	}
}

export abstract class PagerNode extends ViewNode<'pager'> {
	constructor(
		view: View,
		parent: ViewNode & PageableViewNode,
		protected readonly message: string,
		protected readonly previousNode?: ViewNode,
		protected readonly options?: {
			context?: Record<string, unknown>;
			pageSize?: number;
			getCount?: () => Promise<number | undefined>;
		}, // protected readonly pageSize: number = configuration.get('views.pageItemLimit'), // protected readonly countFn?: () => Promise<number | undefined>, // protected readonly context?: Record<string, unknown>, // protected readonly beforeLoadCallback?: (mode: 'all' | 'more') => void,
	) {
		super('pager', unknownGitUri, view, parent);
	}

	async loadAll(): Promise<void> {
		const count = (await this.options?.getCount?.()) ?? 0;
		return this.view.loadMoreNodeChildren(
			this.parent! as ViewNode & PageableViewNode,
			count > 5000 ? 5000 : 0,
			this.previousNode,
			this.options?.context,
		);
	}

	loadMore(): Promise<void> {
		return this.view.loadMoreNodeChildren(
			this.parent! as ViewNode & PageableViewNode,
			this.options?.pageSize ?? configuration.get('views.pageItemLimit'),
			this.previousNode,
			this.options?.context,
		);
	}

	getChildren(): ViewNode[] | Promise<ViewNode[]> {
		return [];
	}

	getTreeItem(): TreeItem | Promise<TreeItem> {
		const item = new TreeItem(this.message, TreeItemCollapsibleState.None);
		item.contextValue = ContextValues.Pager;
		item.command = this.getCommand();
		return item;
	}

	override getCommand(): Command | undefined {
		return {
			title: l10n.t('Load more'),
			command: 'gitlens.views.loadMoreChildren',
			arguments: [this],
		};
	}
}

export class LoadMoreNode extends PagerNode {
	constructor(
		view: View,
		parent: ViewNode & PageableViewNode,
		previousNode: ViewNode,
		options?: {
			context?: Record<string, unknown>;
			getCount?: () => Promise<number | undefined>;
			message?: string;
			pageSize?: number;
		},
	) {
		super(
			view,
			parent,
			options?.message ??
				(options?.pageSize === 0
					? l10n.t('Load all {0}{1}{0} this may take a while', GlyphChars.Space, GlyphChars.Dash)
					: l10n.t('Load more')),
			previousNode,
			options,
		);
	}
}
