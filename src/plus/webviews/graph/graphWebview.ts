import type { CommitType } from '@gitkraken/gitkraken-components';
import { commitNodeType, mergeNodeType, stashNodeType } from '@gitkraken/gitkraken-components';
import type { ColorTheme, Disposable, Event } from 'vscode';
import { ColorThemeKind, EventEmitter, Uri, ViewColumn, window } from 'vscode';
import type { GraphColumnConfig } from '../../../configuration';
import { configuration } from '../../../configuration';
import { Commands } from '../../../constants';
import type { Container } from '../../../container';
import { emojify } from '../../../emojis';
import type { GitBranch } from '../../../git/models/branch';
import type { GitCommit, GitStashCommit } from '../../../git/models/commit';
import { isStash } from '../../../git/models/commit';
import type { GitLog } from '../../../git/models/log';
import type { GitRemote } from '../../../git/models/remote';
import type { Repository, RepositoryChangeEvent } from '../../../git/models/repository';
import type { GitTag } from '../../../git/models/tag';
import type { IpcMessage } from '../../../webviews/protocol';
import { onIpc } from '../../../webviews/protocol';
import { WebviewWithConfigBase } from '../../../webviews/webviewWithConfigBase';
import { ensurePlusFeaturesEnabled } from '../../subscription/utils';
import type { GraphCommit, GraphCompositeConfig, GraphRemote, GraphRepository, State } from './protocol';
import {
	ColumnChangeCommandType,
	DidChangeCommitsNotificationType,
	DidChangeConfigNotificationType,
	DidChangeNotificationType,
	DismissPreviewCommandType,
	MoreCommitsCommandType,
	SelectRepositoryCommandType,
	UpdateSelectionCommandType,
} from './protocol';

export interface GraphSelectionChangeEvent {
	readonly selection: GitCommit[];
}

export class GraphWebview extends WebviewWithConfigBase<State> {
	private _onDidChangeSelection = new EventEmitter<GraphSelectionChangeEvent>();
	get onDidChangeSelection(): Event<GraphSelectionChangeEvent> {
		return this._onDidChangeSelection.event;
	}

	private selectedRepository?: Repository;
	private currentLog?: GitLog;
	private repoDisposable: Disposable | undefined;
	private previewBanner?: boolean;

	constructor(container: Container) {
		super(
			container,
			'gitlens.graph',
			'graph.html',
			'images/gitlens-icon.png',
			'Commit Graph',
			Commands.ShowGraphPage,
		);
		this.disposables.push({ dispose: () => void this.repoDisposable?.dispose() });
	}

	override async show(column: ViewColumn = ViewColumn.Active, ...args: any[]): Promise<void> {
		if (!(await ensurePlusFeaturesEnabled())) return;

		void this.container.usage.track('graphWebview:shown');
		return super.show(column, ...args);
	}

	private _theme: ColorTheme | undefined;
	protected override onInitializing(): Disposable[] | undefined {
		this._theme = window.activeColorTheme;
		return [window.onDidChangeActiveColorTheme(this.onThemeChanged, this)];
	}

	private onThemeChanged(theme: ColorTheme) {
		if (this._theme != null) {
			if (
				(isDarkTheme(theme) && isDarkTheme(this._theme)) ||
				(isLightTheme(theme) && isLightTheme(this._theme))
			) {
				return;
			}
		}

		this._theme = theme;
		void this.notifyDidChangeState();
	}

	protected override onMessageReceived(e: IpcMessage) {
		switch (e.method) {
			case ColumnChangeCommandType.method:
				onIpc(ColumnChangeCommandType, e, params => this.changeColumn(params.name, params.config));
				break;
			case MoreCommitsCommandType.method:
				onIpc(MoreCommitsCommandType, e, params => this.moreCommits(params.limit));
				break;
			case SelectRepositoryCommandType.method:
				onIpc(SelectRepositoryCommandType, e, params => this.changeRepository(params.path));
				break;
			case UpdateSelectionCommandType.method:
				onIpc(UpdateSelectionCommandType, e, params => this.onSelectionChanged(params.selection));
				break;
			case DismissPreviewCommandType.method:
				onIpc(DismissPreviewCommandType, e, () => this.dismissPreview());
				break;
		}
	}

	private dismissPreview() {
		this.previewBanner = false;
		void this.container.storage.storeWorkspace('graph:preview', false);
	}

	private changeColumn(name: string, config: GraphColumnConfig) {
		const columns = this.container.storage.getWorkspace('graph:columns') ?? {};
		columns[name] = config;
		void this.container.storage.storeWorkspace('graph:columns', columns);
		void this.notifyDidChangeConfig();
	}

	private async moreCommits(limit?: number) {
		if (this.currentLog?.more !== undefined) {
			const { defaultItemLimit, pageItemLimit } = this.getConfig();
			const nextLog = await this.currentLog.more(limit ?? pageItemLimit ?? defaultItemLimit);
			if (nextLog !== undefined) {
				this.currentLog = nextLog;
			}
		}
		void this.notifyDidChangeCommits();
	}

	private changeRepository(path: string) {
		if (this.selectedRepository?.path !== path) {
			this.selectedRepository = path ? this.getRepos().find(r => r.path === path) : undefined;
			this.currentLog = undefined;
		}
		void this.notifyDidChangeState();
	}

	private async onSelectionChanged(selection: GraphCommit[]) {
		const ref = selection[0]?.sha;

		let commits: GitCommit[] | undefined;
		if (ref != null) {
			const commit = await this.selectedRepository?.getCommit(ref);
			if (commit != null) {
				commits = [commit];
			}
		}

		this._onDidChangeSelection.fire({ selection: commits ?? [] });
	}

	private async notifyDidChangeConfig() {
		return this.notify(DidChangeConfigNotificationType, {
			config: this.getConfig(),
		});
	}

	private async notifyDidChangeCommits() {
		const [commitsAndLog, stashCommits] = await Promise.all([this.getCommits(), this.getStashCommits()]);

		const log = commitsAndLog?.log;
		const combinedCommitsWithFilteredStashes = combineAndFilterStashCommits(
			commitsAndLog?.commits,
			stashCommits,
			log,
		);

		return this.notify(DidChangeCommitsNotificationType, {
			commits: formatCommits(combinedCommitsWithFilteredStashes),
			log: log != null ? formatLog(log) : undefined,
		});
	}

	private async notifyDidChangeState() {
		return this.notify(DidChangeNotificationType, {
			state: await this.getState(),
		});
		// return window.withProgress({ location: { viewId: this.id } }, async () => {
		// 	void this.notify(DidChangeNotificationType, {
		// 		state: await this.getState(),
		// 	});
		// });
	}

	private getRepos(): Repository[] {
		return this.container.git.openRepositories;
	}

	private async getLog(repo: string | Repository): Promise<GitLog | undefined> {
		const repository = typeof repo === 'string' ? this.container.git.getRepository(repo) : repo;
		if (repository === undefined) {
			return undefined;
		}

		const { defaultItemLimit, pageItemLimit } = this.getConfig();
		return this.container.git.getLog(repository.uri, {
			all: true,
			limit: pageItemLimit ?? defaultItemLimit,
		});
	}

	private async getCommits(): Promise<{ log: GitLog; commits: GitCommit[] } | undefined> {
		if (this.selectedRepository === undefined) {
			return undefined;
		}

		if (this.currentLog === undefined) {
			const log = await this.getLog(this.selectedRepository);
			if (log?.commits === undefined) {
				return undefined;
			}
			this.currentLog = log;
		}

		if (this.currentLog?.commits === undefined) {
			return undefined;
		}

		return {
			log: this.currentLog,
			commits: Array.from(this.currentLog.commits.values()),
		};
	}

	private async getRemotes(): Promise<GitRemote[] | undefined> {
		if (this.selectedRepository === undefined) {
			return undefined;
		}

		return this.selectedRepository.getRemotes();
	}

	private async getTags(): Promise<GitTag[] | undefined> {
		if (this.selectedRepository === undefined) {
			return undefined;
		}

		const tags = await this.container.git.getTags(this.selectedRepository.uri);
		if (tags === undefined) {
			return undefined;
		}

		return Array.from(tags.values);
	}

	private async getBranches(): Promise<GitBranch[] | undefined> {
		if (this.selectedRepository === undefined) {
			return undefined;
		}

		const branches = await this.container.git.getBranches(this.selectedRepository.uri);
		if (branches === undefined) {
			return undefined;
		}

		return Array.from(branches.values);
	}

	private async getStashCommits(): Promise<GitStashCommit[] | undefined> {
		if (this.selectedRepository === undefined) {
			return undefined;
		}

		const stash = await this.container.git.getStash(this.selectedRepository.uri);
		if (stash === undefined || stash.commits === undefined) {
			return undefined;
		}

		return Array.from(stash?.commits?.values());
	}

	private pickRepository(repositories: Repository[]): Repository | undefined {
		if (repositories.length === 0) {
			return undefined;
		}

		if (repositories.length === 1) {
			return repositories[0];
		}

		const bestRepo = this.container.git.getBestRepository(window.activeTextEditor);
		if (bestRepo != null) {
			return bestRepo;
		}

		return repositories[0];
	}

	private getConfig(): GraphCompositeConfig {
		const settings = configuration.get('graph');
		const config: GraphCompositeConfig = {
			...settings,
			columns: this.container.storage.getWorkspace('graph:columns'),
		};
		return config;
	}

	private onRepositoryChanged(_e: RepositoryChangeEvent) {
		// TODO: e.changed(RepositoryChange.Heads)
		this.currentLog = undefined;
		void this.notifyDidChangeState();
	}

	private async getState(): Promise<State> {
		const repositories = this.getRepos();
		if (repositories.length === 0) {
			return {
				repositories: [],
			};
		}

		if (this.previewBanner == null) {
			this.previewBanner = this.container.storage.getWorkspace('graph:preview') ?? true;
		}

		if (this.selectedRepository === undefined) {
			const idealRepo = this.pickRepository(repositories);
			this.selectedRepository = idealRepo;
			this.repoDisposable?.dispose();
			if (this.selectedRepository != null) {
				this.repoDisposable = this.selectedRepository.onDidChange(this.onRepositoryChanged, this);
			}
		}

		if (this.selectedRepository !== undefined) {
			this.title = `${this.originalTitle}: ${this.selectedRepository.formattedName}`;
		}

		const [commitsAndLog, remotes, tags, branches, stashCommits] = await Promise.all([
			this.getCommits(),
			this.getRemotes(),
			this.getTags(),
			this.getBranches(),
			this.getStashCommits(),
		]);

		const log = commitsAndLog?.log;
		const combinedCommitsWithFilteredStashes = combineAndFilterStashCommits(
			commitsAndLog?.commits,
			stashCommits,
			log,
		);

		const theme = window.activeColorTheme;

		return {
			previewBanner: this.previewBanner,
			repositories: formatRepositories(repositories),
			selectedRepository: this.selectedRepository?.path,
			commits: formatCommits(combinedCommitsWithFilteredStashes),
			remotes: formatRemotes(remotes, icon =>
				this._panel?.webview
					.asWebviewUri(
						Uri.joinPath(
							this.container.context.extensionUri,
							`images/${isLightTheme(theme) ? 'light' : 'dark'}/icon-${icon}.svg`,
						),
					)
					.toString(),
			),
			branches: branches, // TODO: add a format function
			tags: tags, // TODO: add a format function
			config: this.getConfig(),
			log: log != null ? formatLog(log) : undefined,
			nonce: this.cspNonce,
		};
	}

	protected override async includeBootstrap(): Promise<State> {
		return this.getState();
	}
}

function isDarkTheme(theme: ColorTheme): boolean {
	return theme.kind === ColorThemeKind.Dark || theme.kind === ColorThemeKind.HighContrast;
}

function isLightTheme(theme: ColorTheme): boolean {
	return theme.kind === ColorThemeKind.Light || theme.kind === ColorThemeKind.HighContrastLight;
}

function formatCommits(commits: (GitCommit | GitStashCommit)[]): GraphCommit[] {
	return commits.map((commit: GitCommit) => ({
		sha: commit.sha,
		author: commit.author,
		message: emojify(commit.message && String(commit.message).length ? commit.message : commit.summary),
		parents: commit.parents,
		committer: commit.committer,
		type: getCommitType(commit),
	}));
}

function getCommitType(commit: GitCommit | GitStashCommit): CommitType {
	if (isStash(commit)) {
		return stashNodeType as CommitType;
	}

	if (commit.parents.length > 1) {
		return mergeNodeType as CommitType;
	}

	// TODO: add other needed commit types for graph
	return commitNodeType as CommitType;
}

function combineAndFilterStashCommits(
	commits: GitCommit[] | undefined,
	stashCommits: GitStashCommit[] | undefined,
	log: GitLog | undefined,
): (GitCommit | GitStashCommit)[] {
	if (commits === undefined || log === undefined) {
		return [];
	}

	if (stashCommits === undefined) {
		return commits;
	}

	const stashCommitShas = stashCommits?.map(c => c.sha);
	const stashCommitShaSecondParents = stashCommits?.map(c => (c.parents.length > 1 ? c.parents[1] : undefined));
	const filteredCommits = commits.filter(
		(commit: GitCommit): boolean =>
			!stashCommitShas.includes(commit.sha) && !stashCommitShaSecondParents.includes(commit.sha),
	);

	const filteredStashCommits = stashCommits.filter((stashCommit: GitStashCommit): boolean => {
		if (!stashCommit.parents?.length) {
			return true;
		}
		const parentCommit: GitCommit | undefined = log.commits.get(stashCommit.parents[0]);
		return parentCommit !== undefined;
	});

	// Remove the second parent, if existing, from each stash commit as it affects column processing
	for (const stashCommit of filteredStashCommits) {
		if (stashCommit.parents.length > 1) {
			stashCommit.parents.splice(1, 1);
		}
	}

	return [...filteredCommits, ...filteredStashCommits];
}

function formatRemotes(
	remotes: GitRemote[] | undefined,
	getIconUrl: (icon?: string) => string | undefined,
): GraphRemote[] | undefined {
	return remotes?.map(r => ({
		name: r.name,
		url: r.url,
		avatarUrl:
			r.provider?.avatarUri?.toString(true) ??
			(r.provider?.icon != null ? getIconUrl(r.provider.icon) : undefined),
	}));
}

function formatRepositories(repositories: Repository[]): GraphRepository[] {
	if (repositories.length === 0) {
		return repositories;
	}

	return repositories.map(({ formattedName, id, name, path }) => ({
		formattedName: formattedName,
		id: id,
		name: name,
		path: path,
	}));
}

function formatLog(log: GitLog) {
	return {
		count: log.count,
		limit: log.limit,
		hasMore: log.hasMore,
		cursor: log.cursor,
	};
}
