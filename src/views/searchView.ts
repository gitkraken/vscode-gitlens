'use strict';
import { commands, ConfigurationChangeEvent } from 'vscode';
import { configuration, SearchViewConfig, ViewFilesLayout, ViewsConfig } from '../configuration';
import { CommandContext, setCommandContext, WorkspaceState } from '../constants';
import { Container } from '../container';
import { GitLog, GitRepoSearchBy } from '../git/gitService';
import { Functions, Strings } from '../system';
import { nodeSupportsConditionalDismissal, SearchNode, SearchResultsCommitsNode, ViewNode } from './nodes';
import { ViewBase } from './viewBase';

interface SearchQueryResult {
	label: string;
	log: GitLog | undefined;
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
		search: string,
		searchBy: GitRepoSearchBy,
		options: {
			maxCount?: number;
			label:
				| string
				| {
						label: string;
						resultsType?: { singular: string; plural: string };
				  };
		}
	) {
		await this.show();

		const searchQueryFn = this.getSearchQueryFn(
			Container.git.getLogForSearch(repoPath, search, searchBy, {
				maxCount: options.maxCount
			}),
			options
		);

		return this.addResults(
			new SearchResultsCommitsNode(
				this,
				this._root!,
				repoPath,
				search,
				searchBy,
				`results for ${typeof options.label === 'string' ? options.label : options.label.label}`,
				searchQueryFn
			)
		);
	}

	showSearchResults(
		repoPath: string,
		search: string,
		searchBy: GitRepoSearchBy,
		results: GitLog,
		options: {
			label:
				| string
				| {
						label: string;
						resultsType?: { singular: string; plural: string };
				  };
		}
	) {
		const label = this.getSearchLabel(options.label, results);
		const searchQueryFn = Functions.cachedOnce(this.getSearchQueryFn(results, options), {
			label: label,
			log: results
		});

		return this.addResults(
			new SearchResultsCommitsNode(this, this._root!, repoPath, search, searchBy, label, searchQueryFn)
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

		const count = log !== undefined ? log.count : 0;
		const truncated = log !== undefined ? log.truncated : false;

		const resultsType =
			label.resultsType === undefined ? { singular: 'result', plural: 'results' } : label.resultsType;

		return `${Strings.pluralize(resultsType.singular, count, {
			number: truncated ? `${count}+` : undefined,
			plural: resultsType.plural,
			zero: 'No'
		})} for ${label.label}`;
	}

	private getSearchQueryFn(
		results: Promise<GitLog | undefined> | GitLog | undefined,
		options: {
			label:
				| string
				| {
						label: string;
						resultsType?: { singular: string; plural: string };
				  };
		}
	): (maxCount: number | undefined) => Promise<SearchQueryResult> {
		return async (maxCount: number | undefined) => {
			const res = await results;

			let log;
			if (res !== undefined) {
				log = await (res.query === undefined
					? (maxCount: number | undefined) => Promise.resolve(res)
					: res.query)(maxCount);
			}

			const label = this.getSearchLabel(options.label, log);
			return {
				label: label,
				log: log
			};
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
