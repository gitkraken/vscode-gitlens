'use strict';
import { commands, ConfigurationChangeEvent } from 'vscode';
import { configuration, SearchViewConfig, ViewFilesLayout, ViewsConfig } from '../configuration';
import { CommandContext, setCommandContext, WorkspaceState } from '../constants';
import { Container } from '../container';
import { GitLog, SearchPattern } from '../git/gitService';
import { Functions, Mutable, Strings } from '../system';
import { nodeSupportsConditionalDismissal, SearchNode, SearchResultsCommitsNode, ViewNode } from './nodes';
import { ViewBase } from './viewBase';

interface SearchQueryResults {
	readonly label: string;
	readonly log: GitLog | undefined;
	readonly hasMore: boolean;
	more?(limit: number | undefined): Promise<void>;
}

export class SearchView extends ViewBase<SearchNode> {
	constructor() {
		super('gitlens.views.search', 'Search Commits');

		setCommandContext(CommandContext.ViewsSearchKeepResults, this.keepResults);
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
			this
		);
		commands.registerCommand(this.getQualifiedCommand('refresh'), () => this.refresh(true), this);
		commands.registerCommand(
			this.getQualifiedCommand('setFilesLayoutToAuto'),
			() => this.setFilesLayout(ViewFilesLayout.Auto),
			this
		);
		commands.registerCommand(
			this.getQualifiedCommand('setFilesLayoutToList'),
			() => this.setFilesLayout(ViewFilesLayout.List),
			this
		);
		commands.registerCommand(
			this.getQualifiedCommand('setFilesLayoutToTree'),
			() => this.setFilesLayout(ViewFilesLayout.Tree),
			this
		);
		commands.registerCommand(this.getQualifiedCommand('setKeepResultsToOn'), () => this.setKeepResults(true), this);
		commands.registerCommand(
			this.getQualifiedCommand('setKeepResultsToOff'),
			() => this.setKeepResults(false),
			this
		);
	}

	protected onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (
			!configuration.changed(e, 'views', 'search') &&
			!configuration.changed(e, 'views') &&
			!configuration.changed(e, 'defaultDateFormat') &&
			!configuration.changed(e, 'defaultDateSource') &&
			!configuration.changed(e, 'defaultDateStyle') &&
			!configuration.changed(e, 'defaultGravatarsStyle')
		) {
			return;
		}

		if (configuration.changed(e, 'views', 'search', 'location')) {
			this.initialize(this.config.location, { showCollapseAll: true });
		}

		if (!configuration.initializing(e) && this._root !== undefined) {
			void this.refresh(true);
		}
	}

	get config(): ViewsConfig & SearchViewConfig {
		return { ...Container.config.views, ...Container.config.views.search };
	}

	get keepResults(): boolean {
		return Container.context.workspaceState.get<boolean>(WorkspaceState.ViewsSearchKeepResults, false);
	}

	clear() {
		if (this._root === undefined) return;

		this._root.clear();
	}

	dismissNode(node: ViewNode) {
		if (this._root === undefined) return;
		if (nodeSupportsConditionalDismissal(node) && node.canDismiss() === false) return;

		this._root.dismiss(node);
	}

	async search(
		repoPath: string,
		search: SearchPattern,
		{
			label,
			...options
		}: {
			label:
				| string
				| {
						label: string;
						resultsType?: { singular: string; plural: string };
				  };
			limit?: number;
		},
		results?: Promise<GitLog | undefined> | GitLog
	) {
		if (!this.visible) {
			await this.show();
		}

		const searchQueryFn = this.getSearchQueryFn(
			results || Container.git.getLogForSearch(repoPath, search, options),
			{ label: label }
		);

		return this.addResults(
			new SearchResultsCommitsNode(
				this,
				this._root!,
				repoPath,
				search,
				`Results ${typeof label === 'string' ? label : label.label}`,
				searchQueryFn
			)
		);
	}

	showSearchResults(
		repoPath: string,
		search: SearchPattern,
		log: GitLog,
		{
			label,
			...options
		}: {
			label:
				| string
				| {
						label: string;
						resultsType?: { singular: string; plural: string };
				  };
			limit?: number;
		}
	) {
		const labelString = this.getSearchLabel(label, log);
		const results: Mutable<Partial<SearchQueryResults>> = {
			label: labelString,
			log: log,
			hasMore: log.hasMore
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
			results as SearchQueryResults
		);

		return this.addResults(
			new SearchResultsCommitsNode(this, this._root!, repoPath, search, labelString, searchQueryFn)
		);
	}

	private addResults(results: ViewNode) {
		const root = this.ensureRoot();
		root.addOrReplace(results, !this.keepResults);

		setImmediate(() => void this.reveal(results, { select: true, expand: true }));
	}

	private getSearchLabel(
		label:
			| string
			| {
					label: string;
					resultsType?: { singular: string; plural: string };
			  },
		log: GitLog | undefined
	) {
		if (typeof label === 'string') return label;

		const count = log?.count ?? 0;

		const resultsType =
			label.resultsType === undefined ? { singular: 'result', plural: 'results' } : label.resultsType;

		return `${Strings.pluralize(resultsType.singular, count, {
			number: log?.hasMore ?? false ? `${count}+` : undefined,
			plural: resultsType.plural,
			zero: 'No'
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
		}
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
				hasMore: log?.hasMore
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
		return configuration.updateEffective('views', 'search', 'files', 'layout', layout);
	}

	private setKeepResults(enabled: boolean) {
		Container.context.workspaceState.update(WorkspaceState.ViewsSearchKeepResults, enabled);
		setCommandContext(CommandContext.ViewsSearchKeepResults, enabled);
	}
}
