import type { ConfigurationChangeEvent } from 'vscode';
import { Disposable, workspace } from 'vscode';
import type { CreatePullRequestActionContext } from '../../api/gitlens';
import { getAvatarUriFromGravatarEmail } from '../../avatars';
import type { OpenPullRequestOnRemoteCommandArgs } from '../../commands/openPullRequestOnRemote';
import { GlyphChars, urls } from '../../constants';
import { Commands } from '../../constants.commands';
import type { ContextKeys } from '../../constants.context';
import type { HomeTelemetryContext } from '../../constants.telemetry';
import type { Container } from '../../container';
import { executeGitCommand } from '../../git/actions';
import * as RepoActions from '../../git/actions/repository';
import type { BranchContributorOverview } from '../../git/gitProvider';
import type { GitBranch } from '../../git/models/branch';
import { sortBranches } from '../../git/models/branch';
import type { PullRequest } from '../../git/models/pullRequest';
import { getComparisonRefsForPullRequest } from '../../git/models/pullRequest';
import { getReferenceFromBranch } from '../../git/models/reference';
import { RemoteResourceType } from '../../git/models/remoteResource';
import type { Repository } from '../../git/models/repository';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../../git/models/repository';
import type { GitStatus } from '../../git/models/status';
import type { GitWorktree } from '../../git/models/worktree';
import { getOpenedWorktreesByBranch, groupWorktreesByBranch } from '../../git/models/worktree';
import type { Subscription } from '../../plus/gk/account/subscription';
import type { SubscriptionChangeEvent } from '../../plus/gk/account/subscriptionService';
import { getLaunchpadSummary } from '../../plus/launchpad/utils';
import type { ShowInCommitGraphCommandArgs } from '../../plus/webviews/graph/protocol';
import { showRepositoryPicker } from '../../quickpicks/repositoryPicker';
import type { Deferrable } from '../../system/function';
import { debounce } from '../../system/function';
import { map } from '../../system/iterable';
import { getSettledValue } from '../../system/promise';
import { executeActionCommand, executeCommand, registerCommand } from '../../system/vscode/command';
import { configuration } from '../../system/vscode/configuration';
import { getContext, onDidChangeContext } from '../../system/vscode/context';
import { openUrl, openWorkspace } from '../../system/vscode/utils';
import type { IpcMessage } from '../protocol';
import type { WebviewHost, WebviewProvider, WebviewShowingArgs } from '../webviewProvider';
import type { WebviewShowOptions } from '../webviewsController';
import type {
	CollapseSectionParams,
	DidChangeRepositoriesParams,
	GetOverviewBranch,
	GetOverviewBranches,
	GetOverviewResponse,
	OpenInGraphParams,
	OverviewFilters,
	OverviewRecentThreshold,
	OverviewStaleThreshold,
	State,
} from './protocol';
import {
	ChangeOverviewRepository,
	CollapseSectionCommand,
	DidChangeIntegrationsConnections,
	DidChangeOrgSettings,
	DidChangeOverviewFilter,
	DidChangePreviewEnabled,
	DidChangeRepositories,
	DidChangeRepositoryWip,
	DidChangeSubscription,
	DidChangeWalkthroughProgress,
	DidCompleteDiscoveringRepositories,
	DidFocusAccount,
	DismissWalkthroughSection,
	GetLaunchpadSummary,
	GetOverview,
	GetOverviewFilterState,
	OpenInGraphCommand,
	SetOverviewFilter,
	TogglePreviewEnabledCommand,
} from './protocol';
import type { HomeWebviewShowingArgs } from './registration';

const emptyDisposable = Object.freeze({
	dispose: () => {
		/* noop */
	},
});

type RepositorySubscription = { repo: Repository; subscription?: Disposable };
type RepositoryBranchData = {
	repo: Repository;
	branches: GitBranch[];
	worktreesByBranch: Map<string, GitWorktree>;
};
type BranchRef = { repoPath: string; branchId: string };

export class HomeWebviewProvider implements WebviewProvider<State, State, HomeWebviewShowingArgs> {
	private readonly _disposable: Disposable;
	private _discovering: Promise<number | undefined> | undefined;
	private _etag?: number;
	private _pendingFocusAccount = false;

	constructor(
		private readonly container: Container,
		private readonly host: WebviewHost,
	) {
		this._disposable = Disposable.from(
			this.container.git.onDidChangeRepositories(this.onRepositoriesChanged, this),
			!workspace.isTrusted
				? workspace.onDidGrantWorkspaceTrust(() => this.notifyDidChangeRepositories(), this)
				: emptyDisposable,
			this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
			onDidChangeContext(this.onContextChanged, this),
			this.container.integrations.onDidChangeConnectionState(this.onChangeConnectionState, this),
			this.container.walkthrough.onProgressChanged(this.onWalkthroughChanged, this),
			configuration.onDidChange(this.onDidChangeConfig, this),
		);
	}

	dispose() {
		this._disposable.dispose();
	}

	getTelemetryContext(): HomeTelemetryContext {
		return {
			...this.host.getTelemetryContext(),
			'context.preview': this.getPreviewEnabled() ? 'v16' : undefined,
		};
	}

	private _overviewBranchFilter: OverviewFilters = {
		recent: {
			threshold: 'OneWeek',
		},
		stale: {
			threshold: 'OneYear',
			show: false,
		},
	};

	onShowing(
		loading: boolean,
		_options?: WebviewShowOptions,
		...args: WebviewShowingArgs<HomeWebviewShowingArgs, State>
	): [boolean, Record<`context.${string}`, string | number | boolean> | undefined] {
		this._etag = this.container.git.etag;
		void this.ensureRepoDiscovery();

		const [arg] = args as HomeWebviewShowingArgs;
		if (arg?.focusAccount === true) {
			if (!loading && this.host.ready && this.host.visible) {
				queueMicrotask(() => void this.host.notify(DidFocusAccount, undefined));
				return [true, undefined];
			}
			this._pendingFocusAccount = true;
		}

		return [true, undefined];
	}

	private async ensureRepoDiscovery() {
		if (!this.container.git.isDiscoveringRepositories) {
			return;
		}

		this._discovering = this.container.git.isDiscoveringRepositories;
		this._etag = await this._discovering;
		this._discovering = undefined;
		this.notifyDidCompleteDiscoveringRepositories();
	}

	private onChangeConnectionState() {
		this.notifyDidChangeOnboardingIntegration();
	}

	private async shouldNotifyRepositoryChange(): Promise<boolean> {
		if (this._etag === this.container.git.etag) {
			return false;
		}

		if (this._discovering != null) {
			this._etag = await this._discovering;
			if (this._etag === this.container.git.etag) return false;
		}

		return true;
	}

	private async onChooseRepository() {
		const currentRepo = this.getSelectedRepository();
		// Ensure that the current repository is always last
		const repositories = this.container.git.openRepositories.sort(
			(a, b) =>
				(a === currentRepo ? 1 : -1) - (b === currentRepo ? 1 : -1) ||
				(a.starred ? -1 : 1) - (b.starred ? -1 : 1) ||
				a.index - b.index,
		);

		const pick = await showRepositoryPicker(
			`Switch Repository ${GlyphChars.Dot} ${currentRepo?.name}`,
			'Choose a repository to switch to',
			repositories,
		);

		if (pick == null || pick === currentRepo) return;

		this.selectRepository(pick.path);
	}

	private async onRepositoriesChanged() {
		if (!(await this.shouldNotifyRepositoryChange())) {
			return;
		}
		this.notifyDidChangeRepositories();
	}

	private onWalkthroughChanged() {
		this.notifyDidChangeProgress();
	}

	private onDidChangeConfig(e?: ConfigurationChangeEvent) {
		if (configuration.changed(e, 'home.preview.enabled')) {
			this.notifyDidChangeConfig();
		}
	}

	private async push(force = false) {
		const repo = this.getSelectedRepository();
		if (repo) {
			return executeGitCommand({
				command: 'push',
				state: { repos: [repo], flags: force ? ['--force'] : undefined },
			});
		}
		return Promise.resolve();
	}

	private async pull() {
		const repo = this.getSelectedRepository();
		if (repo) {
			return executeGitCommand({
				command: 'pull',
				state: { repos: [repo] },
			});
		}
		return Promise.resolve();
	}

	registerCommands(): Disposable[] {
		return [
			registerCommand(`${this.host.id}.pull`, this.pull, this),
			registerCommand(
				`${this.host.id}.push`,
				args => {
					void this.push(args.force);
				},
				this,
			),
			registerCommand(`${this.host.id}.publishBranch`, this.push, this),
			registerCommand(`${this.host.id}.refresh`, () => this.host.refresh(true), this),
			registerCommand(`${this.host.id}.disablePreview`, () => this.onTogglePreviewEnabled(false), this),
			registerCommand(
				`${this.host.id}.previewFeedback`,
				() => openUrl('https://github.com/gitkraken/vscode-gitlens/discussions/3721'),
				this,
			),
			registerCommand(`${this.host.id}.whatsNew`, () => openUrl(urls.releaseNotes), this),
			registerCommand(`${this.host.id}.help`, () => openUrl(urls.helpCenter), this),
			registerCommand(`${this.host.id}.issues`, () => openUrl(urls.githubIssues), this),
			registerCommand(`${this.host.id}.discussions`, () => openUrl(urls.githubDiscussions), this),
			registerCommand(
				`${this.host.id}.account.resync`,
				() => this.container.subscription.validate({ force: true }),
				this,
			),
			registerCommand('gitlens.home.openPullRequestComparison', this.pullRequestCompare, this),
			registerCommand('gitlens.home.openPullRequestOnRemote', this.pullRequestViewOnRemote, this),
			registerCommand('gitlens.home.createPullRequest', this.pullRequestCreate, this),
			registerCommand('gitlens.home.openWorktree', this.worktreeOpen, this),
			registerCommand('gitlens.home.switchToBranch', this.switchToBranch, this),
			registerCommand('gitlens.home.fetch', this.fetch, this),
			registerCommand('gitlens.home.openInGraph', this.openInGraph, this),
		];
	}

	private setOverviewFilter(value: OverviewFilters) {
		this._overviewBranchFilter = value;
		void this.host.notify(DidChangeOverviewFilter, { filter: this._overviewBranchFilter });
	}

	async onMessageReceived(e: IpcMessage) {
		switch (true) {
			case CollapseSectionCommand.is(e):
				this.onCollapseSection(e.params);
				break;
			case DismissWalkthroughSection.is(e):
				this.dismissWalkthrough();
				break;
			case SetOverviewFilter.is(e):
				this.setOverviewFilter(e.params);
				break;
			case GetLaunchpadSummary.is(e):
				void this.host.respond(GetLaunchpadSummary, e, await getLaunchpadSummary(this.container));
				break;
			case GetOverview.is(e):
				void this.host.respond(GetOverview, e, await this.getBranchOverview());
				break;
			case GetOverviewFilterState.is(e):
				void this.host.respond(GetOverviewFilterState, e, this._overviewBranchFilter);
				break;
			case ChangeOverviewRepository.is(e):
				await this.onChooseRepository();
				void this.host.respond(ChangeOverviewRepository, e, undefined);
				break;
			case TogglePreviewEnabledCommand.is(e):
				this.onTogglePreviewEnabled();
				break;
			case OpenInGraphCommand.is(e):
				this.openInGraph(e.params);
				break;
		}
	}

	includeBootstrap(): Promise<State> {
		return this.getState();
	}

	onRefresh() {
		this.resetBranchOverview();
		this.notifyDidChangeRepositories();
	}

	onReloaded() {
		this.onRefresh();
		this.notifyDidChangeProgress();
	}

	onReady() {
		if (this._pendingFocusAccount === true) {
			this._pendingFocusAccount = false;

			void this.host.notify(DidFocusAccount, undefined);
		}
	}

	onVisibilityChanged(visible: boolean) {
		if (!visible) {
			this.stopRepositorySubscription();

			return;
		}

		this.resumeRepositorySubscription();
		this.notifyDidChangeRepositories(true);
	}

	private openInGraph(params: OpenInGraphParams) {
		if (params?.type === 'branch') {
			const repo = this._repositoryBranches.get(params.repoPath);
			if (repo == null) return;

			const branch = repo.branches.find(b => b.id === params.branchId);
			if (branch == null) return;

			const ref = getReferenceFromBranch(branch);
			if (ref == null) return;
			void executeCommand<ShowInCommitGraphCommandArgs>(Commands.ShowInCommitGraph, { ref: ref });
			return;
		}

		let repo: Repository | undefined;
		if (params == null) {
			repo = this.getSelectedRepository();
		} else {
			const repoBranches = this._repositoryBranches.get(params.repoPath);
			repo = repoBranches?.repo;
		}
		if (repo == null) return;
		void executeCommand(Commands.ShowGraph, repo);
	}

	private onTogglePreviewEnabled(isEnabled?: boolean) {
		if (isEnabled === undefined) {
			isEnabled = !this.getPreviewEnabled();
		}

		if (!this.getPreviewCollapsed()) {
			this.onCollapseSection({
				section: 'newHomePreview',
				collapsed: true,
			});
		}

		this.container.telemetry.sendEvent('home/preview/toggled', { enabled: isEnabled, version: 'v16' });
		configuration.updateEffective('home.preview.enabled', isEnabled);
	}

	private onCollapseSection(params: CollapseSectionParams) {
		const collapsed = this.container.storage.get('home:sections:collapsed');
		if (collapsed == null) {
			if (params.collapsed === true) {
				void this.container.storage.store('home:sections:collapsed', [params.section]);
			}
			return;
		}

		const idx = collapsed.indexOf(params.section);
		if (params.collapsed === true) {
			if (idx === -1) {
				void this.container.storage.store('home:sections:collapsed', [...collapsed, params.section]);
			}

			return;
		}

		if (idx !== -1) {
			collapsed.splice(idx, 1);
			void this.container.storage.store('home:sections:collapsed', collapsed);
		}
	}

	private dismissWalkthrough() {
		const dismissed = this.container.storage.get('home:walkthrough:dismissed');
		if (!dismissed) {
			void this.container.storage.store('home:walkthrough:dismissed', true);
			void this.container.usage.track('home:walkthrough:dismissed');
		}
	}

	private getWalkthroughDismissed() {
		return Boolean(this.container.storage.get('home:walkthrough:dismissed'));
	}

	private getPreviewCollapsed() {
		return this.container.storage.get('home:sections:collapsed')?.includes('newHomePreview') ?? false;
	}

	private getIntegrationBannerCollapsed() {
		return this.container.storage.get('home:sections:collapsed')?.includes('integrationBanner') ?? false;
	}

	private getOrgSettings(): State['orgSettings'] {
		return {
			drafts: getContext('gitlens:gk:organization:drafts:enabled', false),
		};
	}

	private onContextChanged(key: keyof ContextKeys) {
		if (key === 'gitlens:gk:organization:drafts:enabled') {
			this.notifyDidChangeOrgSettings();
		}
	}

	private onSubscriptionChanged(e: SubscriptionChangeEvent) {
		void this.notifyDidChangeSubscription(e.current);
	}

	private async getState(subscription?: Subscription): Promise<State> {
		const subResult = await this.getSubscription(subscription);

		return {
			...this.host.baseWebviewState,
			discovering: this._discovering != null,
			repositories: this.getRepositoriesState(),
			webroot: this.host.getWebRoot(),
			subscription: subResult.subscription,
			avatar: subResult.avatar,
			organizationsCount: subResult.organizationsCount,
			orgSettings: this.getOrgSettings(),
			previewCollapsed: this.getPreviewCollapsed(),
			integrationBannerCollapsed: this.getIntegrationBannerCollapsed(),
			hasAnyIntegrationConnected: this.isAnyIntegrationConnected(),
			walkthroughProgress: {
				allCount: this.container.walkthrough.walkthroughSize,
				doneCount: this.container.walkthrough.doneCount,
				progress: this.container.walkthrough.progress,
			},
			showWalkthroughProgress: !this.getWalkthroughDismissed(),
			previewEnabled: this.getPreviewEnabled(),
			newInstall: getContext('gitlens:install:new', false),
		};
	}

	private getPreviewEnabled() {
		return configuration.get('home.preview.enabled');
	}

	private getRepositoriesState(): DidChangeRepositoriesParams {
		return {
			count: this.container.git.repositoryCount,
			openCount: this.container.git.openRepositoryCount,
			hasUnsafe: this.container.git.hasUnsafeRepositories(),
			trusted: workspace.isTrusted,
		};
	}

	private async getBranchOverview(): Promise<GetOverviewResponse | undefined> {
		if (this._discovering != null) {
			await this._discovering;
		}

		const repo = this.getSelectedRepository();
		if (repo == null) return undefined;

		const forceRepo = this._invalidateOverview === 'repo';
		const forceWip = this._invalidateOverview !== undefined;
		const branchesAndWorktrees = await this.getBranchesData(repo, forceRepo);
		const overviewBranches = await getOverviewBranches(
			branchesAndWorktrees,
			this.container,
			this._overviewBranchFilter,
			forceWip ? { forceActive: true } : undefined,
		);
		this._invalidateOverview = undefined;
		if (overviewBranches == null) return undefined;

		const formattedRepo = await this.formatRepository(repo);

		const result: GetOverviewResponse = {
			repository: {
				...formattedRepo,
				branches: overviewBranches,
			},
		};

		return result;
	}

	private async formatRepository(repo: Repository): Promise<{
		name: string;
		path: string;
		provider?: {
			name: string;
			icon?: string;
			url?: string;
		};
	}> {
		const remotes = await repo.git.getBestRemotesWithProviders();
		const remote = remotes.find(r => r.hasIntegration()) ?? remotes[0];

		return {
			name: repo.commonRepositoryName ?? repo.name,
			path: repo.path,
			provider: remote?.provider
				? {
						name: remote.provider.name,
						icon: remote.provider.icon === 'remote' ? 'cloud' : remote.provider.icon,
						url: remote.provider.url({ type: RemoteResourceType.Repo }),
				  }
				: undefined,
		};
	}

	private _repositorySubscription: RepositorySubscription | undefined;
	private selectRepository(repoPath?: string) {
		let repo: Repository | undefined;
		if (repoPath != null) {
			repo = this.container.git.getRepository(repoPath)!;
		} else {
			repo = this.container.git.highlander;
			if (repo == null) {
				repo = this.container.git.getBestRepositoryOrFirst();
			}
		}

		if (this._repositorySubscription != null) {
			this._repositorySubscription.subscription?.dispose();
			this._repositorySubscription = undefined;
		}
		if (repo != null) {
			this._repositorySubscription = {
				repo: repo,
				subscription: this.subscribeToRepository(repo),
			};
		}

		return repo;
	}

	private stopRepositorySubscription() {
		if (this._repositorySubscription != null) {
			this._repositorySubscription.subscription?.dispose();
			this._repositorySubscription.subscription = undefined;
		}
	}

	private resumeRepositorySubscription(force = false) {
		if (this._repositorySubscription == null) {
			return;
		}

		if (force || this._repositorySubscription.subscription == null) {
			this._repositorySubscription.subscription?.dispose();
			this._repositorySubscription.subscription = undefined;
			this._repositorySubscription.subscription = this.subscribeToRepository(this._repositorySubscription.repo);
		}
	}

	private resetBranchOverview() {
		this._repositoryBranches.clear();

		if (!this.host.visible) {
			this.stopRepositorySubscription();
			return;
		}

		this.resumeRepositorySubscription(true);
	}

	private subscribeToRepository(repo: Repository): Disposable {
		return Disposable.from(
			// TODO: advanced confiugration for the watchFileSystem timing
			repo.watchFileSystem(1000),
			repo.onDidChangeFileSystem(() => this.onOverviewRepoChanged('wip')),
			repo.onDidChange(e => {
				if (
					e.changed(
						RepositoryChange.Unknown,
						RepositoryChange.Index,
						RepositoryChange.Status,
						RepositoryChange.Remotes,
						RepositoryChange.Config,
						RepositoryChange.Heads,
						RepositoryChangeComparisonMode.Any,
					)
				) {
					this.onOverviewRepoChanged('repo');
				}
			}),
		);
	}

	private onOverviewRepoChanged(scope: 'repo' | 'wip') {
		if (this._invalidateOverview !== 'repo') {
			this._invalidateOverview = scope;
		}
		if (!this.host.visible) return;

		if (scope === 'wip') {
			void this.host.notify(DidChangeRepositoryWip, undefined);
		} else {
			this.notifyDidChangeRepositories();
		}
	}

	private getSelectedRepository() {
		if (this._repositorySubscription == null) {
			this.selectRepository();
		}

		return this._repositorySubscription?.repo;
	}

	private _invalidateOverview: 'repo' | 'wip' | undefined;
	private readonly _repositoryBranches: Map<string, RepositoryBranchData> = new Map();
	private async getBranchesData(repo: Repository, force = false) {
		if (force || !this._repositoryBranches.has(repo.path)) {
			const worktrees = (await repo.git.getWorktrees()) ?? [];
			const worktreesByBranch = groupWorktreesByBranch(worktrees, { includeDefault: true });
			const [branchesResult] = await Promise.allSettled([
				repo.git.getBranches({
					filter: b => !b.remote,
					sort: { current: true, openedWorktreesByBranch: getOpenedWorktreesByBranch(worktreesByBranch) },
				}),
			]);

			const branches = getSettledValue(branchesResult)?.values ?? [];

			this._repositoryBranches.set(repo.path, {
				repo: repo,
				branches: branches,
				worktreesByBranch: worktreesByBranch,
			});
		}

		return this._repositoryBranches.get(repo.path)!;
	}

	private _hostedIntegrationConnected: boolean | undefined;
	private isAnyIntegrationConnected(force = false) {
		if (this._hostedIntegrationConnected == null || force === true) {
			this._hostedIntegrationConnected =
				[
					...this.container.integrations.getConnected('hosting'),
					...this.container.integrations.getConnected('issues'),
				].length > 0;
		}
		return this._hostedIntegrationConnected;
	}

	private async getSubscription(subscription?: Subscription) {
		subscription ??= await this.container.subscription.getSubscription(true);

		let avatar;
		if (subscription.account?.email) {
			avatar = getAvatarUriFromGravatarEmail(subscription.account.email, 34).toString();
		} else {
			avatar = `${this.host.getWebRoot() ?? ''}/media/gitlens-logo.webp`;
		}

		return {
			subscription: subscription,
			avatar: avatar,
			organizationsCount:
				subscription != null ? ((await this.container.organizations.getOrganizations()) ?? []).length : 0,
		};
	}

	private notifyDidCompleteDiscoveringRepositories() {
		void this.host.notify(DidCompleteDiscoveringRepositories, {
			discovering: this._discovering != null,
			repositories: this.getRepositoriesState(),
		});
	}

	private notifyDidChangeRepositoriesCore() {
		void this.host.notify(DidChangeRepositories, this.getRepositoriesState());
	}
	private _notifyDidChangeRepositoriesDebounced: Deferrable<() => void> | undefined = undefined;
	private notifyDidChangeRepositories(immediate = false) {
		if (immediate) {
			this.notifyDidChangeRepositoriesCore();
			return;
		}

		if (this._notifyDidChangeRepositoriesDebounced == null) {
			this._notifyDidChangeRepositoriesDebounced = debounce(this.notifyDidChangeRepositoriesCore.bind(this), 500);
		}

		this._notifyDidChangeRepositoriesDebounced();
	}

	private notifyDidChangeProgress() {
		void this.host.notify(DidChangeWalkthroughProgress, {
			allCount: this.container.walkthrough.walkthroughSize,
			doneCount: this.container.walkthrough.doneCount,
			progress: this.container.walkthrough.progress,
		});
	}

	private notifyDidChangeConfig() {
		void this.host.notify(DidChangePreviewEnabled, {
			previewEnabled: this.getPreviewEnabled(),
			previewCollapsed: this.getPreviewCollapsed(),
		});
	}

	private notifyDidChangeOnboardingIntegration() {
		// force rechecking
		const isConnected = this.isAnyIntegrationConnected(true);
		if (isConnected) {
			this.onCollapseSection({
				section: 'integrationBanner',
				collapsed: true,
			});
		}
		void this.host.notify(DidChangeIntegrationsConnections, {
			hasAnyIntegrationConnected: isConnected,
		});
	}

	private async notifyDidChangeSubscription(subscription?: Subscription) {
		const subResult = await this.getSubscription(subscription);

		void this.host.notify(DidChangeSubscription, {
			subscription: subResult.subscription,
			avatar: subResult.avatar,
			organizationsCount: subResult.organizationsCount,
		});
	}

	private notifyDidChangeOrgSettings() {
		void this.host.notify(DidChangeOrgSettings, {
			orgSettings: this.getOrgSettings(),
		});
	}

	private async pullRequestCompare(refs: BranchRef) {
		const pr = await this.findPullRequest(refs);
		if (pr?.refs?.base == null || pr.refs.head == null) return;

		const comparisonRefs = getComparisonRefsForPullRequest(refs.repoPath, pr.refs);
		return this.container.views.searchAndCompare
			.compare(comparisonRefs.repoPath, comparisonRefs.head, comparisonRefs.base)
			.then(compareNode => {
				executeCommand(Commands.ViewsOpenAllChangedFileDiffs, compareNode);
			});
	}

	private async pullRequestViewOnRemote(refs: BranchRef, clipboard?: boolean) {
		const pr = await this.findPullRequest(refs);
		if (pr == null) return;

		void executeCommand<OpenPullRequestOnRemoteCommandArgs>(Commands.OpenPullRequestOnRemote, {
			pr: { url: pr.url },
			clipboard: clipboard,
		});
	}

	private async pullRequestCreate(refs: BranchRef) {
		const repo = this._repositoryBranches.get(refs.repoPath);
		const branch = repo?.branches.find(b => b.id === refs.branchId);
		if (branch == null) return;
		const remote = await branch.getRemote();
		if (remote == null) return;

		executeActionCommand<CreatePullRequestActionContext>('createPullRequest', {
			repoPath: refs.repoPath,
			remote:
				remote != null
					? {
							name: remote.name,
							provider:
								remote.provider != null
									? {
											id: remote.provider.id,
											name: remote.provider.name,
											domain: remote.provider.domain,
									  }
									: undefined,
							url: remote.url,
					  }
					: undefined,
			branch: {
				name: branch.name,
				upstream: branch.upstream?.name,
				isRemote: branch.remote,
			},
		});
	}

	private worktreeOpen(refs: BranchRef) {
		const worktree = this.findWorktree(refs);
		if (worktree == null) return;

		openWorkspace(worktree.uri);
	}

	private switchToBranch(refs: BranchRef) {
		const repo = this._repositoryBranches.get(refs.repoPath);
		const branch = repo?.branches.find(b => b.id === refs.branchId);
		if (branch == null) return;

		void RepoActions.switchTo(repo!.repo, getReferenceFromBranch(branch));
	}

	private fetch(refs?: BranchRef) {
		if (refs == null) {
			const repo = this.getSelectedRepository();
			void RepoActions.fetch(repo);
			return;
		}

		const repo = this._repositoryBranches.get(refs.repoPath);
		const branch = repo?.branches.find(b => b.id === refs.branchId);
		if (branch == null) return;

		void RepoActions.fetch(repo!.repo, getReferenceFromBranch(branch));
	}

	private findBranch(refs: BranchRef): GitBranch | undefined {
		const branches = this._repositoryBranches.get(refs.repoPath)?.branches;
		return branches?.find(b => b.id === refs.branchId);
	}

	private findWorktree(refs: BranchRef): GitWorktree | undefined {
		const repo = this._repositoryBranches.get(refs.repoPath);
		if (repo == null) return undefined;

		const branch = repo.branches.find(b => b.id === refs.branchId);
		if (branch == null) return undefined;

		return repo.worktreesByBranch.get(branch.id);
	}

	private async findPullRequest(refs: BranchRef): Promise<PullRequest | undefined> {
		const branches = this.findBranch(refs);
		if (branches == null) return undefined;
		return branches.getAssociatedPullRequest();
	}
}

const thresholdValues: Record<OverviewStaleThreshold | OverviewRecentThreshold, number> = {
	OneDay: 1000 * 60 * 60 * 24 * 1,
	OneWeek: 1000 * 60 * 60 * 24 * 7,
	OneMonth: 1000 * 60 * 60 * 24 * 30,
	OneYear: 1000 * 60 * 60 * 24 * 365,
};

async function getOverviewBranches(
	branchesData: RepositoryBranchData,
	container: Container,
	filters: OverviewFilters,
	options?: { forceActive?: boolean },
): Promise<GetOverviewBranches | undefined> {
	const { branches, worktreesByBranch } = branchesData;
	if (branches.length === 0) return undefined;

	const overviewBranches: GetOverviewBranches = {
		active: [],
		recent: [],
		stale: [],
	};

	let repoStatusPromise: Promise<GitStatus | undefined> | undefined;
	const prPromises = new Map<string, Promise<PullRequest | undefined>>();
	const statusPromises = new Map<string, Promise<GitStatus | undefined>>();
	const contributorPromises = new Map<string, Promise<BranchContributorOverview | undefined>>();

	const now = Date.now();
	const recentThreshold = now - thresholdValues[filters.recent.threshold];

	for (const branch of branches) {
		const wt = worktreesByBranch.get(branch.id);
		const worktree: GetOverviewBranch['worktree'] = wt ? { name: wt.name, uri: wt.uri.toString() } : undefined;

		const timestamp = branch.date?.getTime();
		if (branch.current || wt?.opened) {
			const forceOptions = options?.forceActive ? { force: true } : undefined;
			prPromises.set(branch.id, branch.getAssociatedPullRequest({ avatarSize: 16 }));
			if (wt != null) {
				statusPromises.set(branch.id, wt.getStatus(forceOptions));
			} else {
				if (repoStatusPromise === undefined) {
					repoStatusPromise = container.git.getStatus(branch.repoPath);
				}
				statusPromises.set(branch.id, repoStatusPromise);
			}
			contributorPromises.set(branch.id, container.git.getBranchContributorOverview(branch.repoPath, branch.ref));

			overviewBranches.active.push({
				id: branch.id,
				name: branch.name,
				opened: true,
				timestamp: timestamp,
				state: branch.state,
				status: branch.status,
				upstream: branch.upstream,
				worktree: worktree,
			});

			continue;
		}

		if (timestamp != null && timestamp > recentThreshold) {
			prPromises.set(branch.id, branch.getAssociatedPullRequest());
			if (wt != null) {
				statusPromises.set(branch.id, wt.getStatus());
			}
			contributorPromises.set(branch.id, container.git.getBranchContributorOverview(branch.repoPath, branch.ref));

			overviewBranches.recent.push({
				id: branch.id,
				name: branch.name,
				opened: false,
				timestamp: timestamp,
				state: branch.state,
				status: branch.status,
				upstream: branch.upstream,
				worktree: worktree,
			});

			continue;
		}
	}

	if (filters?.stale?.show === true) {
		const staleThreshold = now - thresholdValues[filters.stale.threshold];
		sortBranches(branches, {
			missingUpstream: true,
			orderBy: 'date:asc',
		});
		for (const branch of branches) {
			if (overviewBranches.stale.length > 9) break;

			if (
				overviewBranches.active.some(b => b.id === branch.id) ||
				overviewBranches.recent.some(b => b.id === branch.id)
			) {
				continue;
			}

			const timestamp = branch.date?.getTime();
			if (branch.upstream?.missing || (timestamp != null && timestamp < staleThreshold)) {
				const wt = worktreesByBranch.get(branch.id);
				const worktree: GetOverviewBranch['worktree'] = wt
					? { name: wt.name, uri: wt.uri.toString() }
					: undefined;

				if (!branch.upstream?.missing) {
					prPromises.set(branch.id, branch.getAssociatedPullRequest());
				}
				if (wt != null) {
					statusPromises.set(branch.id, wt.getStatus());
				}
				contributorPromises.set(
					branch.id,
					container.git.getBranchContributorOverview(branch.repoPath, branch.ref),
				);

				overviewBranches.stale.push({
					id: branch.id,
					name: branch.name,
					opened: false,
					timestamp: timestamp,
					state: branch.state,
					status: branch.status,
					upstream: branch.upstream,
					worktree: worktree,
				});

				continue;
			}
		}
	}

	await enrichOverviewBranches(overviewBranches, prPromises, statusPromises, contributorPromises);

	return overviewBranches;
}

// FIXME: support partial enrichment
async function enrichOverviewBranches(
	overviewBranches: GetOverviewBranches,
	prPromises: Map<string, Promise<PullRequest | undefined>>,
	statusPromises: Map<string, Promise<GitStatus | undefined>>,
	contributorPromises: Map<string, Promise<BranchContributorOverview | undefined>>,
) {
	const [prResults, statusResults, contributorResults] = await Promise.allSettled([
		Promise.allSettled(map(prPromises, ([id, pr]) => pr.then<[string, PullRequest | undefined]>(pr => [id, pr]))),
		Promise.allSettled(
			map(statusPromises, ([id, status]) => status.then<[string, GitStatus | undefined]>(status => [id, status])),
		),
		Promise.allSettled(
			map(contributorPromises, ([id, overview]) =>
				overview.then<[string, BranchContributorOverview | undefined]>(overview => [id, overview]),
			),
		),
	]);

	const prs = new Map(
		getSettledValue(prResults)
			?.filter(r => r.status === 'fulfilled')
			.map(({ value: [prId, pr] }) => [
				prId,
				pr
					? ({
							id: pr.id,
							title: pr.title,
							state: pr.state,
							url: pr.url,
					  } satisfies GetOverviewBranch['pr'])
					: undefined,
			]),
	);

	const statuses = new Map(
		getSettledValue(statusResults)
			?.filter(r => r.status === 'fulfilled')
			.map(r => [r.value[0], r.value[1]]),
	);

	const contributors = new Map(
		getSettledValue(contributorResults)
			?.filter(r => r.status === 'fulfilled')
			.map(r => [r.value[0], r.value[1]]),
	);

	for (const branch of [...overviewBranches.active, ...overviewBranches.recent, ...overviewBranches.stale]) {
		const pr = prs.get(branch.id);
		branch.pr = pr;

		const status = statuses.get(branch.id);
		if (status != null) {
			branch.workingTreeState = status.getDiffStatus();
		}

		const contributor = contributors.get(branch.id);
		if (contributor != null) {
			const rawContributors = contributor.contributors != null ? [...contributor.contributors] : undefined;
			const owner = contributor.owner ?? rawContributors?.shift();
			if (owner != null) {
				branch.owner = {
					name: owner.name ?? '',
					email: owner.email ?? '',
					current: owner.current,
					timestamp: owner.date?.getTime(),
					count: owner.count,
					stats: owner.stats,
					avatarUrl: (await owner.getAvatarUri())?.toString(),
				};
			}
			const contributors = rawContributors
				? await Promise.all(
						rawContributors.map(async c => ({
							name: c.name ?? '',
							email: c.email ?? '',
							current: c.current,
							timestamp: c.date?.getTime(),
							count: c.count,
							stats: c.stats,
							avatarUrl: (await c.getAvatarUri())?.toString(),
						})),
				  )
				: undefined;
			branch.contributors = contributors;
		}
	}
}
