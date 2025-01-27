import type { ConfigurationChangeEvent } from 'vscode';
import { Disposable, Uri, window, workspace } from 'vscode';
import type { CreatePullRequestActionContext } from '../../api/gitlens';
import type { EnrichedAutolink } from '../../autolinks';
import { getAvatarUriFromGravatarEmail } from '../../avatars';
import type { BranchGitCommandArgs } from '../../commands/git/branch';
import type { OpenPullRequestOnRemoteCommandArgs } from '../../commands/openPullRequestOnRemote';
import { GlyphChars, urls } from '../../constants';
import { GlCommand } from '../../constants.commands';
import type { ContextKeys } from '../../constants.context';
import {
	isSupportedCloudIntegrationId,
	supportedCloudIntegrationDescriptors,
	supportedOrderedCloudIntegrationIds,
} from '../../constants.integrations';
import type { HomeTelemetryContext, Source } from '../../constants.telemetry';
import type { Container } from '../../container';
import { executeGitCommand } from '../../git/actions';
import { openComparisonChanges } from '../../git/actions/commit';
import * as RepoActions from '../../git/actions/repository';
import type { BranchContributionsOverview } from '../../git/gitProvider';
import type { GitBranch } from '../../git/models/branch';
import type { GitFileChangeShape } from '../../git/models/fileChange';
import type { Issue } from '../../git/models/issue';
import type { GitPausedOperationStatus } from '../../git/models/pausedOperationStatus';
import type { PullRequest } from '../../git/models/pullRequest';
import { RemoteResourceType } from '../../git/models/remoteResource';
import type { Repository } from '../../git/models/repository';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../../git/models/repository';
import { uncommitted } from '../../git/models/revision';
import type { GitStatus } from '../../git/models/status';
import type { GitWorktree } from '../../git/models/worktree';
import { getAssociatedIssuesForBranch } from '../../git/utils/-webview/branch.issue.utils';
import { getBranchTargetInfo } from '../../git/utils/-webview/branch.utils';
import { getReferenceFromBranch } from '../../git/utils/-webview/reference.utils';
import { sortBranches } from '../../git/utils/-webview/sorting';
import { getOpenedWorktreesByBranch, groupWorktreesByBranch } from '../../git/utils/-webview/worktree.utils';
import { getComparisonRefsForPullRequest } from '../../git/utils/pullRequest.utils';
import { createRevisionRange } from '../../git/utils/revision.utils';
import { showPatchesView } from '../../plus/drafts/actions';
import type { Subscription } from '../../plus/gk/models/subscription';
import type { SubscriptionChangeEvent } from '../../plus/gk/subscriptionService';
import { isSubscriptionStatePaidOrTrial } from '../../plus/gk/utils/subscription.utils';
import { providersMetadata } from '../../plus/integrations/providers/models';
import type { LaunchpadCategorizedResult } from '../../plus/launchpad/launchpadProvider';
import { getLaunchpadItemGroups } from '../../plus/launchpad/launchpadProvider';
import { getLaunchpadSummary } from '../../plus/launchpad/utils/-webview/launchpad.utils';
import type { StartWorkCommandArgs } from '../../plus/startWork/startWork';
import { showRepositoryPicker } from '../../quickpicks/repositoryPicker';
import {
	executeActionCommand,
	executeCommand,
	executeCoreCommand,
	registerCommand,
} from '../../system/-webview/command';
import { configuration } from '../../system/-webview/configuration';
import { getContext, onDidChangeContext } from '../../system/-webview/context';
import { openUrl, openWorkspace } from '../../system/-webview/vscode';
import { debug } from '../../system/decorators/log';
import type { Deferrable } from '../../system/function';
import { debounce } from '../../system/function';
import { filterMap } from '../../system/iterable';
import { getSettledValue } from '../../system/promise';
import type { ShowInCommitGraphCommandArgs } from '../plus/graph/protocol';
import type { Change } from '../plus/patchDetails/protocol';
import type { IpcMessage } from '../protocol';
import type { WebviewHost, WebviewProvider, WebviewShowingArgs } from '../webviewProvider';
import type { WebviewShowOptions } from '../webviewsController';
import type {
	BranchRef,
	CollapseSectionParams,
	DidChangeRepositoriesParams,
	GetActiveOverviewResponse,
	GetInactiveOverviewResponse,
	GetOverviewBranch,
	IntegrationState,
	OpenInGraphParams,
	OverviewFilters,
	OverviewRecentThreshold,
	OverviewStaleThreshold,
	State,
} from './protocol';
import {
	ChangeOverviewRepositoryCommand,
	CollapseSectionCommand,
	DidChangeIntegrationsConnections,
	DidChangeLaunchpad,
	DidChangeOrgSettings,
	DidChangeOverviewFilter,
	DidChangeOverviewRepository,
	DidChangePreviewEnabled,
	DidChangeRepositories,
	DidChangeRepositoryWip,
	DidChangeSubscription,
	DidChangeWalkthroughProgress,
	DidCompleteDiscoveringRepositories,
	DidFocusAccount,
	DismissWalkthroughSection,
	GetActiveOverview,
	GetInactiveOverview,
	GetLaunchpadSummary,
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

interface RepositorySubscription {
	repo: Repository;
	subscription?: Disposable;
}
interface RepositoryBranchData {
	repo: Repository;
	branches: GitBranch[];
	worktreesByBranch: Map<string, GitWorktree>;
}

// type AutolinksInfo = Awaited<GetOverviewBranch['autolinks']>;
type BranchMergeTargetStatusInfo = Awaited<GetOverviewBranch['mergeTarget']>;
type ContributorsInfo = Awaited<GetOverviewBranch['contributors']>;
type IssuesInfo = Awaited<GetOverviewBranch['issues']>;
type LaunchpadItemInfo = Awaited<NonNullable<Awaited<GetOverviewBranch['pr']>>['launchpad']>;
type PullRequestInfo = Awaited<GetOverviewBranch['pr']>;
type WipInfo = Awaited<GetOverviewBranch['wip']>;

const thresholdValues: Record<OverviewStaleThreshold | OverviewRecentThreshold, number> = {
	OneDay: 1000 * 60 * 60 * 24 * 1,
	OneWeek: 1000 * 60 * 60 * 24 * 7,
	OneMonth: 1000 * 60 * 60 * 24 * 30,
	OneYear: 1000 * 60 * 60 * 24 * 365,
};

export class HomeWebviewProvider implements WebviewProvider<State, State, HomeWebviewShowingArgs> {
	private readonly _disposable: Disposable;
	private _discovering: Promise<number | undefined> | undefined;
	private _etag?: number;
	private _etagSubscription?: number;
	private _pendingFocusAccount = false;

	constructor(
		private readonly container: Container,
		private readonly host: WebviewHost<'gitlens.views.home'>,
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
			this.container.launchpad.onDidChange(this.onDidLaunchpadChange, this),
		);
	}

	dispose(): void {
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
			limit: 9,
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
		void this._discovering.finally(() => (this._discovering = undefined));
		this._etag = await this._discovering;
		this.notifyDidCompleteDiscoveringRepositories();
	}

	private onChangeConnectionState() {
		void this.notifyDidChangeIntegrations();
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

		return this.selectRepository(pick.path);
	}

	private onRepositoriesChanged() {
		if (this._discovering != null || this._etag === this.container.git.etag) return;

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

	private onDidLaunchpadChange() {
		this.notifyDidChangeLaunchpad();
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
			registerCommand(`${this.host.id}.enablePreview`, () => this.onTogglePreviewEnabled(true), this),
			registerCommand(
				`${this.host.id}.previewFeedback`,
				() => openUrl('https://github.com/gitkraken/vscode-gitlens/discussions/3721'),
				this,
			),
			registerCommand(`${this.host.id}.whatsNew`, () => openUrl(urls.releaseNotes), this),
			registerCommand(`${this.host.id}.help`, () => openUrl(urls.helpCenter), this),
			registerCommand(`${this.host.id}.issues`, () => openUrl(urls.githubIssues), this),
			registerCommand(`${this.host.id}.info`, () => openUrl(urls.helpCenterHome), this),
			registerCommand(`${this.host.id}.discussions`, () => openUrl(urls.githubDiscussions), this),
			registerCommand(
				`${this.host.id}.account.resync`,
				(src?: Source) => this.container.subscription.validate({ force: true }, src),
				this,
			),
			registerCommand('gitlens.home.openMergeTargetComparison', this.mergeTargetCompare, this),
			registerCommand('gitlens.home.openPullRequestChanges', this.pullRequestChanges, this),
			registerCommand('gitlens.home.openPullRequestComparison', this.pullRequestCompare, this),
			registerCommand('gitlens.home.openPullRequestOnRemote', this.pullRequestViewOnRemote, this),
			registerCommand('gitlens.home.openPullRequestDetails', this.pullRequestDetails, this),
			registerCommand('gitlens.home.createPullRequest', this.pullRequestCreate, this),
			registerCommand('gitlens.home.openWorktree', this.worktreeOpen, this),
			registerCommand('gitlens.home.switchToBranch', this.switchToBranch, this),
			registerCommand('gitlens.home.fetch', this.fetch, this),
			registerCommand('gitlens.home.openInGraph', this.openInGraph, this),
			registerCommand('gitlens.home.createBranch', this.createBranch, this),
			registerCommand('gitlens.home.mergeIntoCurrent', this.mergeIntoCurrent, this),
			registerCommand('gitlens.home.rebaseCurrentOnto', this.rebaseCurrentOnto, this),
			registerCommand('gitlens.home.startWork', this.startWork, this),
			registerCommand('gitlens.home.createCloudPatch', this.createCloudPatch, this),
			registerCommand('gitlens.home.skipPausedOperation', this.skipPausedOperation, this),
			registerCommand('gitlens.home.continuePausedOperation', this.continuePausedOperation, this),
			registerCommand('gitlens.home.abortPausedOperation', this.abortPausedOperation, this),
			registerCommand('gitlens.home.openRebaseEditor', this.openRebaseEditor, this),
		];
	}

	private setOverviewFilter(value: OverviewFilters) {
		this._overviewBranchFilter = value;
		void this.host.notify(DidChangeOverviewFilter, { filter: this._overviewBranchFilter });
	}

	async onMessageReceived(e: IpcMessage): Promise<void> {
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
			case GetOverviewFilterState.is(e):
				void this.host.respond(GetOverviewFilterState, e, this._overviewBranchFilter);
				break;
			case ChangeOverviewRepositoryCommand.is(e):
				if ((await this.onChooseRepository()) == null) return;
				void this.host.notify(DidChangeOverviewRepository, undefined);
				break;
			case TogglePreviewEnabledCommand.is(e):
				this.onTogglePreviewEnabled();
				break;
			case OpenInGraphCommand.is(e):
				this.openInGraph(e.params);
				break;
			case GetActiveOverview.is(e):
				void this.host.respond(GetActiveOverview, e, await this.getActiveBranchOverview());
				break;
			case GetInactiveOverview.is(e):
				void this.host.respond(GetInactiveOverview, e, await this.getInactiveBranchOverview());
				break;
		}
	}

	includeBootstrap(): Promise<State> {
		return this.getState();
	}

	onRefresh(): void {
		this.resetBranchOverview();
		this.notifyDidChangeRepositories();
	}

	onReloaded(): void {
		this.onRefresh();
		this.notifyDidChangeProgress();
	}

	onReady(): void {
		if (this._pendingFocusAccount === true) {
			this._pendingFocusAccount = false;

			void this.host.notify(DidFocusAccount, undefined);
		}
	}

	onVisibilityChanged(visible: boolean): void {
		if (!visible) {
			this.stopRepositorySubscription();

			return;
		}

		this.resumeRepositorySubscription();

		if (this._discovering == null && this._etag !== this.container.git.etag) {
			this.notifyDidChangeRepositories(true);
		}
	}

	private openInGraph(params: OpenInGraphParams) {
		if (params?.type === 'branch') {
			const repo = this._repositoryBranches.get(params.repoPath);
			if (repo == null) return;

			const branch = repo.branches.find(b => b.id === params.branchId);
			if (branch == null) return;

			const ref = getReferenceFromBranch(branch);
			if (ref == null) return;
			void executeCommand<ShowInCommitGraphCommandArgs>(GlCommand.ShowInCommitGraph, { ref: ref });
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
		void executeCommand(GlCommand.ShowGraph, repo);
	}

	private createBranch() {
		this.container.telemetry.sendEvent('home/createBranch');
		void executeCommand<BranchGitCommandArgs>(GlCommand.GitCommands, {
			command: 'branch',
			state: {
				subcommand: 'create',
				suggestNameOnly: true,
				suggestRepoOnly: true,
				confirmOptions: ['--switch', '--worktree'],
			},
		});
	}

	private async mergeIntoCurrent(ref: BranchRef) {
		const repoInfo = this._repositoryBranches.get(ref.repoPath);
		let branch = repoInfo?.branches.find(b => b.id === ref.branchId);
		if (branch == null) {
			branch = await repoInfo?.repo?.git.branches().getBranch(ref.branchName);
			if (branch == null) return;
		}

		void RepoActions.merge(repoInfo!.repo, getReferenceFromBranch(branch));
	}

	private async rebaseCurrentOnto(ref: BranchRef) {
		const repoInfo = this._repositoryBranches.get(ref.repoPath);
		let branch = repoInfo?.branches.find(b => b.id === ref.branchId);
		if (branch == null) {
			branch = await repoInfo?.repo?.git.branches().getBranch(ref.branchName);
			if (branch == null) return;
		}

		void RepoActions.rebase(repoInfo!.repo, getReferenceFromBranch(branch));
	}

	private startWork() {
		this.container.telemetry.sendEvent('home/startWork');
		void executeCommand<StartWorkCommandArgs>(GlCommand.StartWork, {
			command: 'startWork',
			source: 'home',
		});
	}

	private async abortPausedOperation(pausedOpArgs: GitPausedOperationStatus) {
		const abortPausedOperation = this.container.git.status(pausedOpArgs.repoPath).abortPausedOperation;
		if (abortPausedOperation == null) return;

		try {
			await abortPausedOperation();
		} catch (ex) {
			void window.showErrorMessage(ex.message);
		}
	}

	private async continuePausedOperation(pausedOpArgs: GitPausedOperationStatus) {
		if (pausedOpArgs.type === 'revert') return;

		const continuePausedOperation = this.container.git.status(pausedOpArgs.repoPath).continuePausedOperation;
		if (continuePausedOperation == null) return;

		try {
			await continuePausedOperation();
		} catch (ex) {
			void window.showErrorMessage(ex.message);
		}
	}

	private async skipPausedOperation(pausedOpArgs: GitPausedOperationStatus) {
		const continuePausedOperation = this.container.git.status(pausedOpArgs.repoPath).continuePausedOperation;
		if (continuePausedOperation == null) return;

		try {
			await continuePausedOperation({ skip: true });
		} catch (ex) {
			void window.showErrorMessage(ex.message);
		}
	}

	private async openRebaseEditor(pausedOpArgs: GitPausedOperationStatus) {
		if (pausedOpArgs.type !== 'rebase') return;

		const gitDir = await this.container.git.getGitDir(pausedOpArgs.repoPath);
		if (gitDir == null) return;

		const rebaseTodoUri = Uri.joinPath(gitDir.uri, 'rebase-merge', 'git-rebase-todo');
		void executeCoreCommand('vscode.openWith', rebaseTodoUri, 'gitlens.rebase', {
			preview: false,
		});
	}

	private async createCloudPatch(ref: BranchRef) {
		const status = await this.container.git.status(ref.repoPath).getStatus();
		if (status == null) return;

		const files: GitFileChangeShape[] = [];
		for (const file of status.files) {
			const change = {
				repoPath: file.repoPath,
				path: file.path,
				status: file.status,
				originalPath: file.originalPath,
				staged: file.staged,
			};

			files.push(change);
			if (file.staged && file.wip) {
				files.push({ ...change, staged: false });
			}
		}

		const { repo } = this._repositoryBranches.get(ref.repoPath)!;
		const change: Change = {
			type: 'wip',
			repository: {
				name: repo.name,
				path: repo.path,
				uri: repo.uri.toString(),
			},
			files: files,
			revision: { to: uncommitted, from: 'HEAD' },
		};

		void showPatchesView({ mode: 'create', create: { changes: [change] } });
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
				void this.container.storage.store('home:sections:collapsed', [params.section]).catch();
			}
			return;
		}

		const idx = collapsed.indexOf(params.section);
		if (params.collapsed === true) {
			if (idx === -1) {
				void this.container.storage.store('home:sections:collapsed', [...collapsed, params.section]).catch();
			}

			return;
		}

		if (idx !== -1) {
			collapsed.splice(idx, 1);
			void this.container.storage.store('home:sections:collapsed', collapsed).catch();
		}
	}

	private dismissWalkthrough() {
		const dismissed = this.container.storage.get('home:walkthrough:dismissed');
		if (!dismissed) {
			void this.container.storage.store('home:walkthrough:dismissed', true).catch();
			void this.container.usage.track('home:walkthrough:dismissed').catch();
		}
	}

	private getWalkthroughDismissed() {
		return this.container.storage.get('home:walkthrough:dismissed') ?? false;
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

	private async onSubscriptionChanged(e: SubscriptionChangeEvent) {
		if (e.etag === this._etagSubscription) return;

		await this.notifyDidChangeSubscription(e.current);

		if (isSubscriptionStatePaidOrTrial(e.current.state) !== isSubscriptionStatePaidOrTrial(e.previous.state)) {
			this.onOverviewRepoChanged('repo');
		}
	}

	private async getState(subscription?: Subscription): Promise<State> {
		const [subResult, integrationResult] = await Promise.allSettled([
			this.getSubscriptionState(subscription),
			this.getIntegrationStates(true),
		]);

		if (subResult.status === 'rejected') {
			throw subResult.reason;
		}

		const integrations = getSettledValue(integrationResult) ?? [];
		const anyConnected = integrations.some(i => i.connected);

		return {
			...this.host.baseWebviewState,
			discovering: this._discovering != null,
			repositories: this.getRepositoriesState(),
			webroot: this.host.getWebRoot(),
			subscription: subResult.value.subscription,
			avatar: subResult.value.avatar,
			organizationsCount: subResult.value.organizationsCount,
			orgSettings: this.getOrgSettings(),
			previewCollapsed: this.getPreviewCollapsed(),
			integrationBannerCollapsed: this.getIntegrationBannerCollapsed(),
			integrations: integrations,
			hasAnyIntegrationConnected: anyConnected,
			walkthroughProgress: !this.getWalkthroughDismissed()
				? {
						allCount: this.container.walkthrough.walkthroughSize,
						doneCount: this.container.walkthrough.doneCount,
						progress: this.container.walkthrough.progress,
				  }
				: undefined,
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

	private async getActiveBranchOverview(): Promise<GetActiveOverviewResponse | undefined> {
		if (this._discovering != null) {
			await this._discovering;
		}

		const repo = this.getSelectedRepository();
		if (repo == null) return undefined;

		const forceRepo = this._invalidateOverview === 'repo';
		const forceWip = this._invalidateOverview !== undefined;
		const branchesAndWorktrees = await this.getBranchesData(repo, forceRepo);

		const { branches, worktreesByBranch } = branchesAndWorktrees;
		const activeBranch = branches.find(
			branch => this.getBranchOverviewType(branch, worktreesByBranch) === 'active',
		)!;

		const isPro = await this.isSubscriptionPro();
		const [activeOverviewBranch] = getOverviewBranchesCore(
			[activeBranch],
			branchesAndWorktrees.worktreesByBranch,
			isPro,
			this.container,
			{
				isActive: true,
				forceStatus: forceWip ? true : undefined,
			},
		);

		// TODO: revisit invalidation
		if (!forceRepo && forceWip) {
			this._invalidateOverview = undefined;
		}

		return {
			repository: await this.formatRepository(repo),
			active: activeOverviewBranch,
		};
	}

	private async getInactiveBranchOverview(): Promise<GetInactiveOverviewResponse | undefined> {
		if (this._discovering != null) {
			await this._discovering;
		}

		const repo = this.getSelectedRepository();
		if (repo == null) return undefined;

		const forceRepo = this._invalidateOverview === 'repo';
		const branchesAndWorktrees = await this.getBranchesData(repo, forceRepo);

		const recentBranches = branchesAndWorktrees.branches.filter(
			branch => this.getBranchOverviewType(branch, branchesAndWorktrees.worktreesByBranch) === 'recent',
		);

		let staleBranches: GitBranch[] | undefined;
		if (this._overviewBranchFilter.stale.show) {
			sortBranches(branchesAndWorktrees.branches, {
				missingUpstream: true,
				orderBy: 'date:asc',
			});

			for (const branch of branchesAndWorktrees.branches) {
				if (staleBranches != null && staleBranches.length > this._overviewBranchFilter.stale.limit) {
					break;
				}
				if (recentBranches.some(b => b.id === branch.id)) {
					continue;
				}

				if (this.getBranchOverviewType(branch, branchesAndWorktrees.worktreesByBranch) !== 'stale') {
					continue;
				}

				staleBranches ??= [];
				staleBranches.push(branch);
			}
		}

		const isPro = await this.isSubscriptionPro();
		const recentOverviewBranches = getOverviewBranchesCore(
			recentBranches,
			branchesAndWorktrees.worktreesByBranch,
			isPro,
			this.container,
		);
		const staleOverviewBranches =
			staleBranches == null
				? undefined
				: getOverviewBranchesCore(staleBranches, branchesAndWorktrees.worktreesByBranch, isPro, this.container);

		// TODO: revisit invalidation
		if (!forceRepo) {
			this._invalidateOverview = undefined;
		}

		return {
			repository: await this.formatRepository(repo),
			recent: recentOverviewBranches,
			stale: staleOverviewBranches,
		};
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
		const remotes = await repo.git.remotes().getBestRemotesWithProviders();
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
			// TODO: advanced configuration for the watchFileSystem timing
			repo.watchFileSystem(1000),
			repo.onDidChangeFileSystem(() => this.onOverviewRepoChanged('wip')),
			repo.onDidChange(e => {
				if (
					e.changed(
						RepositoryChange.Config,
						RepositoryChange.Head,
						RepositoryChange.Heads,
						// RepositoryChange.Index,
						RepositoryChange.Remotes,
						RepositoryChange.PausedOperationStatus,
						RepositoryChange.Unknown,
						RepositoryChangeComparisonMode.Any,
					)
				) {
					this.onOverviewRepoChanged('repo');
				}
			}),
		);
	}

	@debug()
	private onOverviewRepoChanged(scope: 'repo' | 'wip') {
		if (this._etag === this.container.git.etag) return;

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
			const worktrees = (await repo.git.worktrees()?.getWorktrees()) ?? [];
			const worktreesByBranch = groupWorktreesByBranch(worktrees, { includeDefault: true });
			const [branchesResult] = await Promise.allSettled([
				repo.git.branches().getBranches({
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

	private _integrationStates: IntegrationState[] | undefined;
	private _defaultSupportedCloudIntegrations: IntegrationState[] | undefined;

	private async getIntegrationStates(force = false) {
		if (force || this._integrationStates == null) {
			const promises = filterMap(await this.container.integrations.getConfigured(), i =>
				isSupportedCloudIntegrationId(i.integrationId)
					? ({
							id: i.integrationId,
							name: providersMetadata[i.integrationId].name,
							icon: `gl-provider-${providersMetadata[i.integrationId].iconKey}`,
							connected: true,
							supports:
								providersMetadata[i.integrationId].type === 'hosting'
									? ['prs', 'issues']
									: providersMetadata[i.integrationId].type === 'issues'
									  ? ['issues']
									  : [],
					  } satisfies IntegrationState)
					: undefined,
			);

			const integrationsResults = await Promise.allSettled(promises);
			const integrations: IntegrationState[] = [...filterMap(integrationsResults, r => getSettledValue(r))];

			this._defaultSupportedCloudIntegrations ??= supportedCloudIntegrationDescriptors.map(d => ({
				...d,
				connected: false,
			}));

			// union (uniquely by id) with supportedCloudIntegrationDescriptors
			this._defaultSupportedCloudIntegrations.forEach(d => {
				const i = integrations.find(i => i.id === d.id);
				if (i == null) {
					integrations.push(d);
				} else if (i.icon !== d.icon) {
					i.icon = d.icon;
				}
			});

			integrations.sort(
				(a, b) =>
					supportedOrderedCloudIntegrationIds.indexOf(a.id) -
					supportedOrderedCloudIntegrationIds.indexOf(b.id),
			);

			this._integrationStates = integrations;
		}

		return this._integrationStates;
	}

	private _subscription: Subscription | undefined;
	private async getSubscription(subscription?: Subscription) {
		if (subscription != null) {
			this._subscription = subscription;
		} else if (this._subscription != null) {
			subscription = this._subscription;
		} else {
			this._subscription = subscription = await this.container.subscription.getSubscription(true);
		}

		return this._subscription;
	}

	private async isSubscriptionPro() {
		const subscription = await this.getSubscription();
		if (subscription == null) return false;

		return isSubscriptionStatePaidOrTrial(subscription.state);
	}

	private async getSubscriptionState(subscription?: Subscription) {
		subscription = await this.getSubscription(subscription);
		this._etagSubscription = this.container.subscription.etag;

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
		if (this._discovering != null) return;

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

	private notifyDidChangeLaunchpad() {
		void this.host.notify(DidChangeLaunchpad, undefined);
	}

	private async notifyDidChangeIntegrations() {
		// force rechecking
		const integrations = await this.getIntegrationStates(true);
		const anyConnected = integrations.some(i => i.connected);
		if (anyConnected) {
			this.onCollapseSection({
				section: 'integrationBanner',
				collapsed: true,
			});
		}
		void this.host.notify(DidChangeIntegrationsConnections, {
			hasAnyIntegrationConnected: anyConnected,
			integrations: integrations,
		});
	}

	private async notifyDidChangeSubscription(subscription?: Subscription) {
		const subResult = await this.getSubscriptionState(subscription);

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

	private mergeTargetCompare(ref: BranchRef & { mergeTargetId: string }) {
		return this.container.views.searchAndCompare.compare(ref.repoPath, ref.branchId, ref.mergeTargetId);
	}

	private async pullRequestCompare(ref: BranchRef) {
		const pr = await this.findPullRequest(ref);
		if (pr?.refs?.base == null || pr.refs.head == null) return;

		const comparisonRefs = getComparisonRefsForPullRequest(ref.repoPath, pr.refs);
		return this.container.views.searchAndCompare.compare(
			comparisonRefs.repoPath,
			comparisonRefs.head,
			comparisonRefs.base,
		);
	}

	private async pullRequestChanges(ref: BranchRef) {
		const pr = await this.findPullRequest(ref);
		if (pr?.refs?.base == null || pr.refs.head == null) return;

		const comparisonRefs = getComparisonRefsForPullRequest(ref.repoPath, pr.refs);
		return openComparisonChanges(
			this.container,
			{
				repoPath: comparisonRefs.repoPath,
				lhs: comparisonRefs.base.ref,
				rhs: comparisonRefs.head.ref,
			},
			{ title: `Changes in Pull Request #${pr.id}` },
		);
	}

	private async pullRequestViewOnRemote(ref: BranchRef, clipboard?: boolean) {
		const pr = await this.findPullRequest(ref);
		if (pr == null) return;

		void executeCommand<OpenPullRequestOnRemoteCommandArgs>(GlCommand.OpenPullRequestOnRemote, {
			pr: { url: pr.url },
			clipboard: clipboard,
		});
	}

	private async pullRequestDetails(ref: BranchRef) {
		const pr = await this.findPullRequest(ref);
		if (pr == null) return;

		void this.container.views.pullRequest.showPullRequest(pr, ref.repoPath);
	}

	private async pullRequestCreate(ref: BranchRef) {
		const repo = this._repositoryBranches.get(ref.repoPath);
		const branch = repo?.branches.find(b => b.id === ref.branchId);
		if (branch == null) return;

		const remote = await branch.getRemote();
		if (remote == null) return;

		executeActionCommand<CreatePullRequestActionContext>('createPullRequest', {
			repoPath: ref.repoPath,
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

	private worktreeOpen(ref: BranchRef) {
		const worktree = this.findWorktree(ref);
		if (worktree == null) return;

		openWorkspace(worktree.uri);
	}

	private switchToBranch(ref: BranchRef) {
		const repo = this._repositoryBranches.get(ref.repoPath);
		const branch = repo?.branches.find(b => b.id === ref.branchId);
		if (branch == null) return;

		void RepoActions.switchTo(repo!.repo, getReferenceFromBranch(branch));
	}

	private async fetch(ref?: BranchRef) {
		if (ref == null) {
			const repo = this.getSelectedRepository();
			void RepoActions.fetch(repo);
			return;
		}

		const repoInfo = this._repositoryBranches.get(ref.repoPath);
		if (repoInfo == null) return;

		let branch = repoInfo.branches.find(b => b.id === ref.branchId);
		if (branch == null) {
			branch = await repoInfo.repo.git.branches().getBranch(ref.branchId);
		}
		if (branch == null) return;

		void RepoActions.fetch(repoInfo.repo, getReferenceFromBranch(branch));
	}

	private findBranch(ref: BranchRef): GitBranch | undefined {
		const branches = this._repositoryBranches.get(ref.repoPath)?.branches;
		return branches?.find(b => b.id === ref.branchId);
	}

	private findWorktree(ref: BranchRef): GitWorktree | undefined {
		const repo = this._repositoryBranches.get(ref.repoPath);
		if (repo == null) return undefined;

		const branch = repo.branches.find(b => b.id === ref.branchId);
		if (branch == null) return undefined;

		return repo.worktreesByBranch.get(branch.id);
	}

	private async findPullRequest(ref: BranchRef): Promise<PullRequest | undefined> {
		const branch = this.findBranch(ref);
		if (branch == null) return undefined;

		return branch.getAssociatedPullRequest();
	}

	private getBranchOverviewType(
		branch: GitBranch,
		worktreesByBranch: Map<string, GitWorktree>,
	): 'active' | 'recent' | 'stale' | undefined {
		if (branch.current || worktreesByBranch.get(branch.id)?.opened) {
			return 'active';
		}

		const timestamp = branch.date?.getTime();
		if (timestamp != null) {
			const now = Date.now();

			const recentThreshold = now - thresholdValues[this._overviewBranchFilter.recent.threshold];
			if (timestamp > recentThreshold) {
				return 'recent';
			}

			const staleThreshold = now - thresholdValues[this._overviewBranchFilter.stale.threshold];
			if (timestamp < staleThreshold) {
				return 'stale';
			}
		}

		if (branch.upstream?.missing) {
			return 'stale';
		}

		return undefined;
	}
}

function getOverviewBranchesCore(
	branches: GitBranch[],
	worktreesByBranch: Map<string, GitWorktree>,
	isPro: boolean,
	container: Container,
	options?: {
		forceStatus?: boolean;
		isActive?: boolean;
		includeMergeTarget?: boolean;
	},
): GetOverviewBranch[] {
	if (branches.length === 0) return [];

	const isActive = options?.isActive ?? false;
	const forceOptions = options?.forceStatus ? { force: true } : undefined;

	let launchpadPromise: Promise<LaunchpadCategorizedResult> | undefined;
	let repoStatusPromise: Promise<GitStatus | undefined> | undefined;
	const prPromises = new Map<string, Promise<PullRequestInfo | undefined>>();
	const autolinkPromises = new Map<string, Promise<Map<string, EnrichedAutolink> | undefined>>();
	const issuePromises = new Map<string, Promise<Issue[] | undefined>>();
	const statusPromises = new Map<string, Promise<GitStatus | undefined>>();
	const contributorsPromises = new Map<string, Promise<BranchContributionsOverview | undefined>>();
	const mergeTargetPromises = new Map<string, Promise<BranchMergeTargetStatusInfo>>();

	const overviewBranches: GetOverviewBranch[] = [];
	for (const branch of branches) {
		const wt = worktreesByBranch.get(branch.id);

		const timestamp = branch.date?.getTime();

		if (isPro === true) {
			prPromises.set(branch.id, getPullRequestInfo(container, branch, launchpadPromise));
			autolinkPromises.set(branch.id, branch.getEnrichedAutolinks());
			issuePromises.set(
				branch.id,
				getAssociatedIssuesForBranch(container, branch).then(issues => issues.value),
			);
			contributorsPromises.set(
				branch.id,
				container.git.branches(branch.repoPath).getBranchContributionsOverview(branch.ref),
			);
			if (branch.current) {
				mergeTargetPromises.set(branch.id, getBranchMergeTargetStatusInfo(container, branch));
			}
		}

		if (wt != null) {
			statusPromises.set(branch.id, wt.getStatus(forceOptions));
		} else if (isActive === true) {
			if (repoStatusPromise === undefined) {
				repoStatusPromise = container.git.status(branch.repoPath).getStatus();
			}
			statusPromises.set(branch.id, repoStatusPromise);
		}

		overviewBranches.push({
			reference: getReferenceFromBranch(branch),
			repoPath: branch.repoPath,
			id: branch.id,
			name: branch.name,
			opened: isActive,
			timestamp: timestamp,
			state: branch.state,
			status: branch.status,
			upstream: branch.upstream,
			worktree: wt ? { name: wt.name, uri: wt.uri.toString() } : undefined,
		});
	}

	if (overviewBranches.length > 0) {
		enrichOverviewBranchesCore(
			overviewBranches,
			isActive,
			prPromises,
			autolinkPromises,
			issuePromises,
			statusPromises,
			contributorsPromises,
			mergeTargetPromises,
			container,
		);
	}

	return overviewBranches;
}

// FIXME: support partial enrichment
function enrichOverviewBranchesCore(
	overviewBranches: GetOverviewBranch[],
	isActive: boolean,
	prPromises: Map<string, Promise<PullRequestInfo | undefined>>,
	autolinkPromises: Map<string, Promise<Map<string, EnrichedAutolink> | undefined>>,
	issuePromises: Map<string, Promise<Issue[] | undefined>>,
	statusPromises: Map<string, Promise<GitStatus | undefined>>,
	contributorsPromises: Map<string, Promise<BranchContributionsOverview | undefined>>,
	mergeTargetPromises: Map<string, Promise<BranchMergeTargetStatusInfo>>,
	container: Container,
) {
	for (const branch of overviewBranches) {
		branch.pr = prPromises.get(branch.id);

		const autolinks = autolinkPromises.get(branch.id);
		branch.autolinks = autolinks?.then(a => getAutolinkIssuesInfo(a));

		const issues = issuePromises.get(branch.id);
		branch.issues = issues?.then(
			issues =>
				issues?.map(
					i =>
						({
							id: i.id,
							title: i.title,
							state: i.state,
							url: i.url,
						}) satisfies NonNullable<IssuesInfo>[0],
				) ?? [],
		);

		branch.wip = getWipInfo(container, branch, statusPromises.get(branch.id), isActive);

		const contributors = contributorsPromises.get(branch.id);
		branch.contributors = getContributorsInfo(container, contributors);

		branch.mergeTarget = mergeTargetPromises.get(branch.id);
	}
}

async function getAutolinkIssuesInfo(links: Map<string, EnrichedAutolink> | undefined) {
	if (links == null) return [];

	const results = await Promise.allSettled(
		filterMap([...links.values()], async autolink => {
			const issueOrPullRequest = autolink?.[0];
			if (issueOrPullRequest == null) return undefined;

			const issue = await issueOrPullRequest;
			if (issue == null) return undefined;

			return {
				id: issue.id,
				title: issue.title,
				url: issue.url,
				state: issue.state,
			};
		}),
	);

	return results.map(r => (r.status === 'fulfilled' ? r.value : undefined)).filter(r => r != null);
}

async function getContributorsInfo(
	_container: Container,
	contributorsPromise: Promise<BranchContributionsOverview | undefined> | undefined,
) {
	if (contributorsPromise == null) return [];

	const contributors = await contributorsPromise;
	if (contributors?.contributors == null) return [];

	const result = await Promise.allSettled(
		contributors.contributors.map(
			async c =>
				({
					name: c.name ?? '',
					email: c.email ?? '',
					current: c.current,
					timestamp: c.latestCommitDate?.getTime(),
					count: c.commits,
					stats: c.stats,
					avatarUrl: (await c.getAvatarUri())?.toString(),
				}) satisfies NonNullable<ContributorsInfo>[0],
		),
	);
	return result.map(r => (r.status === 'fulfilled' ? r.value : undefined)).filter(r => r != null);
}

async function getBranchMergeTargetStatusInfo(
	container: Container,
	branch: GitBranch,
): Promise<BranchMergeTargetStatusInfo> {
	const info = await getBranchTargetInfo(container, branch, {
		associatedPullRequest: branch.getAssociatedPullRequest(),
	});

	let targetResult;
	if (!info.targetBranch.paused && info.targetBranch.value) {
		targetResult = info.targetBranch.value;
	}

	const target = targetResult ?? info.baseBranch ?? info.defaultBranch;
	if (target == null) return undefined;

	const branchProvider = container.git.branches(branch.repoPath);
	const targetBranch = await branchProvider.getBranch(target);
	if (targetBranch == null) return undefined;

	const [countsResult, conflictResult, mergedStatusResult] = await Promise.allSettled([
		container.git
			.commits(branch.repoPath)
			.getLeftRightCommitCount(createRevisionRange(targetBranch.name, branch.ref, '...'), {
				excludeMerges: true,
			}),
		branchProvider.getPotentialMergeOrRebaseConflict?.(branch.name, targetBranch.name),
		branchProvider.getBranchMergedStatus?.(branch, targetBranch),
	]);

	const counts = getSettledValue(countsResult);
	const status = counts != null ? { ahead: counts.right, behind: counts.left } : undefined;
	const mergedStatus = getSettledValue(mergedStatusResult);

	return {
		repoPath: branch.repoPath,
		id: targetBranch.id,
		name: targetBranch.name,
		status: status,
		mergedStatus: mergedStatus,
		potentialConflicts: getSettledValue(conflictResult),
		targetBranch: targetBranch.name,
		baseBranch: info.baseBranch,
		defaultBranch: info.defaultBranch,
	};
}

async function getLaunchpadItemInfo(
	container: Container,
	pr: PullRequest,
	launchpadPromise: Promise<LaunchpadCategorizedResult> | undefined,
): Promise<LaunchpadItemInfo> {
	launchpadPromise ??= container.launchpad.getCategorizedItems();
	let result = await launchpadPromise;
	if (result.error != null) return undefined;

	let lpi = result.items.find(i => i.url === pr.url);
	if (lpi == null) {
		// result = await container.launchpad.getCategorizedItems({ search: pr.url });
		result = await container.launchpad.getCategorizedItems({ search: [{ pullRequest: pr, reasons: [] }] });
		if (result.error != null) return undefined;

		lpi = result.items.find(i => i.url === pr.url);
	}

	if (lpi == null) return undefined;

	return {
		uuid: lpi.uuid,
		category: lpi.actionableCategory,
		groups: getLaunchpadItemGroups(lpi),
		suggestedActions: lpi.suggestedActions,

		failingCI: lpi.failingCI,
		hasConflicts: lpi.hasConflicts,

		review: {
			decision: lpi.reviewDecision,
			reviews: lpi.reviews ?? [],
			counts: {
				approval: lpi.approvalReviewCount,
				changeRequest: lpi.changeRequestReviewCount,
				comment: lpi.commentReviewCount,
				codeSuggest: lpi.codeSuggestionsCount,
			},
		},

		author: lpi.author,
		createdDate: lpi.createdDate,

		viewer: { ...lpi.viewer, enrichedItems: undefined },
	};
}

async function getPullRequestInfo(
	container: Container,
	branch: GitBranch,
	launchpadPromise: Promise<LaunchpadCategorizedResult> | undefined,
): Promise<PullRequestInfo> {
	const pr = await branch.getAssociatedPullRequest({ avatarSize: 64 });
	if (pr == null) return undefined;

	return {
		id: pr.id,
		url: pr.url,
		state: pr.state,
		title: pr.title,
		draft: pr.isDraft,
		launchpad: getLaunchpadItemInfo(container, pr, launchpadPromise),
	};
}

async function getWipInfo(
	container: Container,
	branch: GetOverviewBranch,
	statusPromise: Promise<GitStatus | undefined> | undefined,
	active: boolean,
) {
	if (statusPromise == null) return undefined;

	const [statusResult, pausedOpStatusResult] = await Promise.allSettled([
		statusPromise,
		active ? container.git.status(branch.repoPath).getPausedOperationStatus?.() : undefined,
	]);

	const status = getSettledValue(statusResult);
	const pausedOpStatus = getSettledValue(pausedOpStatusResult);

	return {
		workingTreeState: status?.getDiffStatus(),
		hasConflicts: status?.hasConflicts,
		conflictsCount: status?.conflicts.length,
		pausedOpStatus: pausedOpStatus,
	} satisfies WipInfo;
}
