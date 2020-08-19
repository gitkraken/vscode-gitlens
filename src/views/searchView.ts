'use strict';
import { commands, ConfigurationChangeEvent } from 'vscode';
import { configuration, SearchViewConfig, ViewFilesLayout } from '../configuration';
import { CommandContext, setCommandContext, WorkspaceState } from '../constants';
import { Container } from '../container';
import { GitLog, SearchPattern } from '../git/git';
import { Functions, Strings } from '../system';
import { nodeSupportsConditionalDismissal, SearchNode, SearchResultsCommitsNode, ViewNode } from './nodes';
import { ViewBase } from './viewBase';

interface SearchQueryResults {
	readonly label: string;
	readonly log: GitLog | undefined;
	readonly hasMore: boolean;
	more?(limit: number | undefined): Promise<void>;
}

export class SearchView extends ViewBase<SearchNode, SearchViewConfig> {
	protected readonly configKey = 'search';

	constructor() {
		super('gitlens.views.search', 'Search Commits');

		void setCommandContext(CommandContext.ViewsSearchKeepResults, this.keepResults);
	}

	getRoot() {
		return new SearchNode(this);
	}

	protected get location(): string {
		return this.config.location;
	}

	protected registerCommands() {
		void Container.viewCommands;

		commands.registerCommand(this.getQualifiedCommand('clear'), () => this.clear(), this);
		commands.registerCommand(
			this.getQualifiedCommand('copy'),
			() => commands.executeCommand('gitlens.views.copy', this.selection),
			this,
		);
		commands.registerCommand(this.getQualifiedCommand('refresh'), () => this.refresh(true), this);
		commands.registerCommand(
			this.getQualifiedCommand('setFilesLayoutToAuto'),
			() => this.setFilesLayout(ViewFilesLayout.Auto),
			this,
		);
		commands.registerCommand(
			this.getQualifiedCommand('setFilesLayoutToList'),
			() => this.setFilesLayout(ViewFilesLayout.List),
			this,
		);
		commands.registerCommand(
			this.getQualifiedCommand('setFilesLayoutToTree'),
			() => this.setFilesLayout(ViewFilesLayout.Tree),
			this,
		);
		commands.registerCommand(this.getQualifiedCommand('setKeepResultsToOn'), () => this.setKeepResults(true), this);
		commands.registerCommand(
			this.getQualifiedCommand('setKeepResultsToOff'),
			() => this.setKeepResults(false),
			this,
		);
		commands.registerCommand(this.getQualifiedCommand('setShowAvatarsOn'), () => this.setShowAvatars(true), this);
		commands.registerCommand(this.getQualifiedCommand('setShowAvatarsOff'), () => this.setShowAvatars(false), this);
	}

	protected filterConfigurationChanged(e: ConfigurationChangeEvent) {
		const changed = super.filterConfigurationChanged(e);
		if (
			!changed &&
			!configuration.changed(e, 'defaultDateFormat') &&
			!configuration.changed(e, 'defaultDateSource') &&
			!configuration.changed(e, 'defaultDateStyle') &&
			!configuration.changed(e, 'defaultGravatarsStyle')
		) {
			return false;
		}

		return true;
	}

	protected onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (configuration.changed(e, 'views', this.configKey, 'location')) {
			this.initialize(this.config.location, { showCollapseAll: true });
		}

		if (!configuration.initializing(e) && this._root != null) {
			void this.refresh(true);
		}
	}

	get keepResults(): boolean {
		return Container.context.workspaceState.get<boolean>(WorkspaceState.ViewsSearchKeepResults, false);
	}

	clear() {
		this._root?.clear();
	}

	dismissNode(node: ViewNode) {
		if (this._root == null) return;
		if (nodeSupportsConditionalDismissal(node) && node.canDismiss() === false) return;

		this._root.dismiss(node);
	}

	async search(
		repoPath: string,
		search: SearchPattern,
		{
			label,
			reveal,
			...options
		}: {
			label:
				| string
				| {
						label: string;
						resultsType?: { singular: string; plural: string };
				  };
			limit?: number;
			reveal?: {
				select?: boolean;
				focus?: boolean;
				expand?: boolean | number;
			};
		},
		results?: Promise<GitLog | undefined> | GitLog,
	) {
		if (!this.visible) {
			await this.show();
		}

		const searchQueryFn = this.getSearchQueryFn(
			results ?? Container.git.getLogForSearch(repoPath, search, options),
			{ label: label },
		);

		return this.addResults(
			new SearchResultsCommitsNode(
				this,
				this._root!,
				repoPath,
				search,
				`Results ${typeof label === 'string' ? label : label.label}`,
				searchQueryFn,
			),
			reveal,
		);
	}

	showSearchResults(
		repoPath: string,
		search: SearchPattern,
		log: GitLog,
		{
			label,
			reveal,

			...options
		}: {
			label:
				| string
				| {
						label: string;
						resultsType?: { singular: string; plural: string };
				  };
			limit?: number;
			reveal?: {
				select?: boolean;
				focus?: boolean;
				expand?: boolean | number;
			};
		},
	) {
		const labelString = this.getSearchLabel(label, log);
		const results: Mutable<Partial<SearchQueryResults>> = {
			label: labelString,
			log: log,
			hasMore: log.hasMore,
		};
		if (results.hasMore) {
			results.more = async (limit: number | undefined) => {
				results.log = (await results.log?.more?.(limit)) ?? results.log;

				results.label = this.getSearchLabel(label, results.log);
				results.hasMore = results.log?.hasMore ?? true;
			};
		}

		const searchQueryFn = Functions.cachedOnce(
			this.getSearchQueryFn(log, { label: label, ...options }),
			results as SearchQueryResults,
		);

		return this.addResults(
			new SearchResultsCommitsNode(this, this._root!, repoPath, search, labelString, searchQueryFn),
			reveal,
		);
	}

	private addResults(
		results: ViewNode,
		options: {
			select?: boolean;
			focus?: boolean;
			expand?: boolean | number;
		} = { select: true, expand: true },
	) {
		const root = this.ensureRoot();
		root.addOrReplace(results, !this.keepResults);

		setImmediate(() => void this.reveal(results, options));
	}

	private getSearchLabel(
		label:
			| string
			| {
					label: string;
					resultsType?: { singular: string; plural: string };
			  },
		log: GitLog | undefined,
	) {
		if (typeof label === 'string') return label;

		const count = log?.count ?? 0;

		const resultsType =
			label.resultsType === undefined ? { singular: 'result', plural: 'results' } : label.resultsType;

		return `${Strings.pluralize(resultsType.singular, count, {
			number: log?.hasMore ?? false ? `${count}+` : undefined,
			plural: resultsType.plural,
			zero: 'No',
		})} ${label.label}`;
	}

	private getSearchQueryFn(
		logOrPromise: Promise<GitLog | undefined> | GitLog | undefined,
		options: {
			label:
				| string
				| {
						label: string;
						resultsType?: { singular: string; plural: string };
				  };
		},
	): (limit: number | undefined) => Promise<SearchQueryResults> {
		let useCacheOnce = true;

		return async (limit: number | undefined) => {
			let log = await logOrPromise;

			if (!useCacheOnce && log !== undefined && log.query !== undefined) {
				log = await log.query(limit);
			}
			useCacheOnce = false;

			const results: Mutable<Partial<SearchQueryResults>> = {
				label: this.getSearchLabel(options.label, log),
				log: log,
				hasMore: log?.hasMore,
			};
			if (results.hasMore) {
				results.more = async (limit: number | undefined) => {
					results.log = (await results.log?.more?.(limit)) ?? results.log;

					results.label = this.getSearchLabel(options.label, results.log);
					results.hasMore = results.log?.hasMore ?? true;
				};
			}

			return results as SearchQueryResults;
		};
	}

	private setFilesLayout(layout: ViewFilesLayout) {
		return configuration.updateEffective('views', this.configKey, 'files', 'layout', layout);
	}

	private setKeepResults(enabled: boolean) {
		void Container.context.workspaceState.update(WorkspaceState.ViewsSearchKeepResults, enabled);
		void setCommandContext(CommandContext.ViewsSearchKeepResults, enabled);
	}

	private setShowAvatars(enabled: boolean) {
		return configuration.updateEffective('views', this.configKey, 'avatars', enabled);
	}
}
