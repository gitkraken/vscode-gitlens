import type { ConfigurationChangeEvent } from 'vscode';
import { Disposable, env, Uri, window, workspace } from 'vscode';
import { ActionRunnerType } from '../../api/actionRunners';
import type { CreatePullRequestActionContext } from '../../api/gitlens';
import type { EnrichedAutolink } from '../../autolinks/models/autolinks';
import { getAvatarUriFromGravatarEmail } from '../../avatars';
import type { ChangeBranchMergeTargetCommandArgs } from '../../commands/changeBranchMergeTarget';
import type { ComposeCommandArgs } from '../../commands/composer';
import type { ExplainBranchCommandArgs } from '../../commands/explainBranch';
import type { ExplainWipCommandArgs } from '../../commands/explainWip';
import type { GenerateCommitsCommandArgs } from '../../commands/generateRebase';
import type { BranchGitCommandArgs } from '../../commands/git/branch';
import type { OpenPullRequestOnRemoteCommandArgs } from '../../commands/openPullRequestOnRemote';
import { GlyphChars, urls } from '../../constants';
import type { ContextKeys } from '../../constants.context';
import {
	isSupportedCloudIntegrationId,
	supportedCloudIntegrationDescriptors,
	supportedOrderedCloudIntegrationIds,
} from '../../constants.integrations';
import type { HomeTelemetryContext, Source } from '../../constants.telemetry';
import type { Container } from '../../container';
import { executeGitCommand } from '../../git/actions';
import { revealBranch } from '../../git/actions/branch';
import { openComparisonChanges } from '../../git/actions/commit';
import { abortPausedOperation, continuePausedOperation, skipPausedOperation } from '../../git/actions/pausedOperation';
import * as RepoActions from '../../git/actions/repository';
import { revealWorktree } from '../../git/actions/worktree';
import type { BranchContributionsOverview } from '../../git/gitProvider';
import type { GitBranch } from '../../git/models/branch';
import type { GitFileChangeShape } from '../../git/models/fileChange';
import type { Issue } from '../../git/models/issue';
import type { GitPausedOperationStatus } from '../../git/models/pausedOperationStatus';
import type { PullRequest } from '../../git/models/pullRequest';
import type { GitRemote } from '../../git/models/remote';
import { RemoteResourceType } from '../../git/models/remoteResource';
import type { Repository, RepositoryFileSystemChangeEvent } from '../../git/models/repository';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../../git/models/repository';
import { uncommitted } from '../../git/models/revision';
import type { GitStatus } from '../../git/models/status';
import type { GitWorktree } from '../../git/models/worktree';
import { getAssociatedIssuesForBranch } from '../../git/utils/-webview/branch.issue.utils';
import { getBranchMergeTargetInfo } from '../../git/utils/-webview/branch.utils';
import { getReferenceFromBranch } from '../../git/utils/-webview/reference.utils';
import { toRepositoryShapeWithProvider } from '../../git/utils/-webview/repository.utils';
import { sortBranches } from '../../git/utils/-webview/sorting';
import { getOpenedWorktreesByBranch, groupWorktreesByBranch } from '../../git/utils/-webview/worktree.utils';
import { getBranchNameWithoutRemote } from '../../git/utils/branch.utils';
import { getComparisonRefsForPullRequest } from '../../git/utils/pullRequest.utils';
import { createRevisionRange } from '../../git/utils/revision.utils';
import type { AIModelChangeEvent } from '../../plus/ai/aiProviderService';
import { showPatchesView } from '../../plus/drafts/actions';
import type { Subscription } from '../../plus/gk/models/subscription';
import type { SubscriptionChangeEvent } from '../../plus/gk/subscriptionService';
import { isAiAllAccessPromotionActive } from '../../plus/gk/utils/-webview/promo.utils';
import { isSubscriptionTrialOrPaidFromState } from '../../plus/gk/utils/subscription.utils';
import type { ConfiguredIntegrationsChangeEvent } from '../../plus/integrations/authentication/configuredIntegrationService';
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
import { openUrl } from '../../system/-webview/vscode/uris';
import { openWorkspace } from '../../system/-webview/vscode/workspaces';
import { debug, log } from '../../system/decorators/log';
import type { Deferrable } from '../../system/function/debounce';
import { debounce } from '../../system/function/debounce';
import { filterMap } from '../../system/iterable';
import { getSettledValue } from '../../system/promise';
import { SubscriptionManager } from '../../system/subscriptionManager';
import type { UriTypes } from '../../uris/deepLinks/deepLink';
import { DeepLinkServiceState, DeepLinkType } from '../../uris/deepLinks/deepLink';
import type { ShowInCommitGraphCommandArgs } from '../plus/graph/registration';
import type { Change } from '../plus/patchDetails/protocol';
import type { TimelineCommandArgs } from '../plus/timeline/registration';
import type { IpcMessage } from '../protocol';
import type { WebviewHost, WebviewProvider, WebviewShowingArgs } from '../webviewProvider';
import type { WebviewShowOptions } from '../webviewsController';
import type {
	BranchAndTargetRefs,
	BranchRef,
	CollapseSectionParams,
	CreatePullRequestCommandArgs,
	DidChangeRepositoriesParams,
	GetActiveOverviewResponse,
	GetInactiveOverviewResponse,
	GetOverviewBranch,
	IntegrationState,
	OpenInGraphParams,
	OpenInTimelineParams,
	OpenWorktreeCommandArgs,
	OverviewFilters,
	OverviewRecentThreshold,
	OverviewRepository,
	OverviewStaleThreshold,
	State,
} from './protocol';
import {
	ChangeOverviewRepositoryCommand,
	CollapseSectionCommand,
	DidChangeAiAllAccessBanner,
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
	DismissAiAllAccessBannerCommand,
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

const emptyDisposable: Disposable = Object.freeze({ dispose: () => {} });

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
	private _etagFileSystem?: number;
	private _etagRepository?: number;
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
			this.container.integrations.onDidChange(this.onIntegrationsChanged, this),
			this.container.walkthrough?.onDidChangeProgress(this.onWalkthroughProgressChanged, this) ?? emptyDisposable,
			configuration.onDidChange(this.onDidChangeConfig, this),
			this.container.launchpad.onDidChange(this.onLaunchpadChanged, this),
			this.container.ai.onDidChangeModel(this.onAIModelChanged, this),
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

	private onAIModelChanged(_e: AIModelChangeEvent) {
		void this.notifyDidChangeIntegrations();
	}

	private onIntegrationsChanged(_e: ConfiguredIntegrationsChangeEvent) {
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

	private onWalkthroughProgressChanged() {
		this.notifyDidChangeProgress();
	}

	private onDidChangeConfig(e?: ConfigurationChangeEvent) {
		if (configuration.changed(e, ['home.preview.enabled', 'ai.enabled'])) {
			this.notifyDidChangeConfig();
		}
	}

	private onLaunchpadChanged() {
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

	private async publishBranch(ref: BranchRef) {
		const { repo, branch } = await this.getRepoInfoFromRef(ref);
		if (branch == null) return;

		return RepoActions.push(repo, undefined, getReferenceFromBranch(branch));
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
			registerCommand(`${this.host.id}.publishBranch`, this.publishBranch, this),
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

			registerCommand(
				`${this.host.id}.ai.allAccess.dismiss`,
				() => {
					void this.dismissAiAllAccessBanner();
				},
				this,
			),
			registerCommand('gitlens.home.changeBranchMergeTarget', this.changeBranchMergeTarget, this),
			registerCommand('gitlens.home.deleteBranchOrWorktree', this.deleteBranchOrWorktree, this),
			registerCommand('gitlens.home.pushBranch', this.pushBranch, this),
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
			registerCommand('gitlens.visualizeHistory.repo:home', this.openInTimeline, this),
			registerCommand('gitlens.visualizeHistory.branch:home', this.openInTimeline, this),
			registerCommand('gitlens.openInView.branch:home', this.openInView, this),
			registerCommand('gitlens.home.createBranch', this.createBranch, this),
			registerCommand('gitlens.home.mergeIntoCurrent', this.mergeIntoCurrent, this),
			registerCommand('gitlens.home.rebaseCurrentOnto', this.rebaseCurrentOnto, this),
			registerCommand('gitlens.home.startWork', this.startWork, this),
			registerCommand('gitlens.home.createCloudPatch', this.createCloudPatch, this),
			registerCommand('gitlens.home.skipPausedOperation', this.skipPausedOperation, this),
			registerCommand('gitlens.home.continuePausedOperation', this.continuePausedOperation, this),
			registerCommand('gitlens.home.abortPausedOperation', this.abortPausedOperation, this),
			registerCommand('gitlens.home.openRebaseEditor', this.openRebaseEditor, this),
			registerCommand('gitlens.home.enableAi', this.enableAi, this),
			registerCommand('gitlens.ai.explainWip:home', this.explainWip, this),
			registerCommand('gitlens.ai.explainBranch:home', this.explainBranch, this),
			registerCommand('gitlens.ai.generateCommits:home', this.generateCommits, this),
			registerCommand('gitlens.ai.composeCommits:home', this.composeCommits, this),
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

			case DismissAiAllAccessBannerCommand.is(e):
				void this.dismissAiAllAccessBanner();
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

	private hasRepositoryChanged(): boolean {
		if (this._repositorySubscription?.source != null) {
			if (
				this._repositorySubscription.source.etag !== this._etagRepository ||
				this._repositorySubscription.source.etagFileSystem !== this._etagFileSystem
			) {
				return true;
			}
		} else if (this._etag !== this.container.git.etag) {
			return true;
		}

		return false;
	}

	onVisibilityChanged(visible: boolean): void {
		if (!visible) {
			this._repositorySubscription?.pause();

			return;
		}

		this._repositorySubscription?.resume();

		if (
			this._discovering == null &&
			(this.container.subscription.etag !== this._etagSubscription || this.hasRepositoryChanged())
		) {
			this.notifyDidChangeRepositories(true);
		}
	}

	@log<HomeWebviewProvider['openInGraph']>({
		args: { 0: p => `${p?.type}, repoPath=${p?.repoPath}, branchId=${p?.branchId}` },
	})
	private openInGraph(params: OpenInGraphParams) {
		const repoInfo = params != null ? this._repositoryBranches.get(params.repoPath) : undefined;
		if (repoInfo == null) {
			void executeCommand('gitlens.showGraph', this.getSelectedRepository());
			return;
		}

		if (params!.type === 'branch') {
			const branch = repoInfo.branches.find(b => b.id === params!.branchId);
			if (branch != null) {
				void executeCommand<ShowInCommitGraphCommandArgs>('gitlens.showInCommitGraph', {
					ref: getReferenceFromBranch(branch),
				});
				return;
			}
		}

		void executeCommand('gitlens.showGraph', repoInfo.repo);
	}

	@log<HomeWebviewProvider['openInTimeline']>({
		args: { 0: p => `${p?.type}, repoPath=${p?.repoPath}, branchId=${p?.branchId}` },
	})
	private openInTimeline(params: OpenInTimelineParams) {
		const repo = params == null ? this.getSelectedRepository() : this.container.git.getRepository(params.repoPath);
		if (repo == null) return;

		if (params?.type === 'repo') {
			void executeCommand<TimelineCommandArgs>('gitlens.visualizeHistory', { type: 'repo', uri: repo.uri });
			return;
		}

		if (params?.type === 'branch') {
			const repoInfo = this._repositoryBranches.get(repo.path);

			const branch = repoInfo?.branches.find(b => b.id === params.branchId);
			if (branch != null) {
				void executeCommand<TimelineCommandArgs>('gitlens.visualizeHistory', {
					type: 'repo',
					uri: repo.uri,
					head: getReferenceFromBranch(branch),
				});
			}
		}
	}

	@log<HomeWebviewProvider['openInView']>({
		args: { 0: p => `repoPath=${p?.repoPath}, branchId=${p?.branchId}` },
	})
	private async openInView(params: BranchRef) {
		const { repo, branch } = await this.getRepoInfoFromRef(params);
		if (repo == null || branch == null) return;

		// Show in the Worktrees or Branches view depending
		const worktree = await branch.getWorktree();
		if (worktree != null && !worktree.isDefault) {
			await revealWorktree(worktree, { select: true, focus: true, expand: true });
		} else {
			await revealBranch(branch, { select: true, focus: true, expand: true });
		}
	}

	@log()
	private createBranch() {
		this.container.telemetry.sendEvent('home/createBranch');
		void executeCommand<BranchGitCommandArgs>('gitlens.gitCommands', {
			command: 'branch',
			state: {
				subcommand: 'create',
				repo: this.getSelectedRepository(), // TODO: Needs to move to be an arg
				suggestNameOnly: true,
				suggestRepoOnly: true,
				confirmOptions: ['--switch', '--worktree'],
			},
		});
	}

	@log<HomeWebviewProvider['changeBranchMergeTarget']>()
	private changeBranchMergeTarget(ref: BranchAndTargetRefs) {
		this.container.telemetry.sendEvent('home/changeBranchMergeTarget');
		void executeCommand<ChangeBranchMergeTargetCommandArgs>('gitlens.changeBranchMergeTarget', {
			command: 'changeBranchMergeTarget',
			state: {
				repo: ref.repoPath,
				branch: ref.branchName,
				mergeBranch: ref.mergeTargetName,
			},
		});
	}

	@log<HomeWebviewProvider['mergeIntoCurrent']>({ args: { 0: r => r.branchId } })
	private async mergeIntoCurrent(ref: BranchRef) {
		const { repo, branch } = await this.getRepoInfoFromRef(ref);
		if (branch == null) return;

		void RepoActions.merge(repo, getReferenceFromBranch(branch));
	}

	@log<HomeWebviewProvider['rebaseCurrentOnto']>({ args: { 0: r => r.branchId } })
	private async rebaseCurrentOnto(ref: BranchRef) {
		const { repo, branch } = await this.getRepoInfoFromRef(ref);
		if (branch == null) return;

		void RepoActions.rebase(repo, getReferenceFromBranch(branch));
	}

	@log<HomeWebviewProvider['explainBranch']>({ args: { 0: r => r.branchId } })
	private async explainBranch(ref: BranchRef) {
		const { repo, branch } = await this.getRepoInfoFromRef(ref);
		if (repo == null) return;

		void executeCommand<ExplainBranchCommandArgs>('gitlens.ai.explainBranch', {
			repoPath: repo.path,
			ref: branch?.ref,
			source: { source: 'home', type: 'branch' },
		});
	}

	@log<HomeWebviewProvider['explainWip']>({ args: { 0: r => r.branchId } })
	private async explainWip(ref: BranchRef) {
		const { repo, branch } = await this.getRepoInfoFromRef(ref);
		if (repo == null) return;

		const worktree = await branch?.getWorktree();

		void executeCommand<ExplainWipCommandArgs>('gitlens.ai.explainWip', {
			repoPath: repo.path,
			worktreePath: worktree?.path,
			source: { source: 'home', type: 'wip' },
		});
	}

	@log<HomeWebviewProvider['generateCommits']>({ args: { 0: r => r.branchId } })
	private async generateCommits(ref: BranchRef) {
		const { repo } = await this.getRepoInfoFromRef(ref);
		if (repo == null) return;

		void executeCommand<GenerateCommitsCommandArgs>('gitlens.ai.generateCommits', {
			repoPath: repo.path,
			source: { source: 'home' },
		});
	}

	@log<HomeWebviewProvider['composeCommits']>({ args: { 0: r => r.branchId } })
	private async composeCommits(ref: BranchRef) {
		const { repo } = await this.getRepoInfoFromRef(ref);
		if (repo == null) return;

		void executeCommand<ComposeCommandArgs>('gitlens.ai.composeCommits', {
			repoPath: repo.path,
			source: 'home',
		});
	}

	@log()
	private enableAi() {
		this.container.telemetry.sendEvent('home/enableAi');
		configuration.updateEffective('ai.enabled', true);
	}

	@log()
	private startWork() {
		this.container.telemetry.sendEvent('home/startWork');
		void executeCommand<StartWorkCommandArgs>('gitlens.startWork', {
			command: 'startWork',
			source: 'home',
		});
	}

	@log<HomeWebviewProvider['abortPausedOperation']>({ args: { 0: op => op.type } })
	private async abortPausedOperation(pausedOpArgs: GitPausedOperationStatus) {
		await abortPausedOperation(this.container.git.getRepositoryService(pausedOpArgs.repoPath));
	}

	@log<HomeWebviewProvider['continuePausedOperation']>({ args: { 0: op => op.type } })
	private async continuePausedOperation(pausedOpArgs: GitPausedOperationStatus) {
		if (pausedOpArgs.type === 'revert') return;

		await continuePausedOperation(this.container.git.getRepositoryService(pausedOpArgs.repoPath));
	}

	@log<HomeWebviewProvider['skipPausedOperation']>({ args: { 0: op => op.type } })
	private async skipPausedOperation(pausedOpArgs: GitPausedOperationStatus) {
		await skipPausedOperation(this.container.git.getRepositoryService(pausedOpArgs.repoPath));
	}

	@log<HomeWebviewProvider['openRebaseEditor']>({ args: { 0: op => op.type } })
	private async openRebaseEditor(pausedOpArgs: GitPausedOperationStatus) {
		if (pausedOpArgs.type !== 'rebase') return;

		const gitDir = await this.container.git.getRepositoryService(pausedOpArgs.repoPath).config.getGitDir?.();
		if (gitDir == null) return;

		const rebaseTodoUri = Uri.joinPath(gitDir.uri, 'rebase-merge', 'git-rebase-todo');
		void executeCoreCommand('vscode.openWith', rebaseTodoUri, 'gitlens.rebase', {
			preview: false,
		});
	}

	@log<HomeWebviewProvider['createCloudPatch']>({ args: { 0: r => r.branchId } })
	private async createCloudPatch(ref: BranchRef) {
		const { repo } = await this.getRepoInfoFromRef(ref);
		if (repo == null) return;

		const status = await repo.git.status.getStatus();
		if (status == null) {
			void window.showErrorMessage('Unable to create cloud patch');
			return;
		}

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

	@log()
	private dismissWalkthrough() {
		const dismissed = this.container.storage.get('home:walkthrough:dismissed');
		if (!dismissed) {
			void this.container.storage.store('home:walkthrough:dismissed', true).catch();
			void this.container.usage.track('home:walkthrough:dismissed').catch();
		}
	}

	private getWalkthroughDismissed() {
		return (
			this.container.walkthrough == null || (this.container.storage.get('home:walkthrough:dismissed') ?? false)
		);
	}

	private getPreviewCollapsed() {
		return this.container.storage.get('home:sections:collapsed')?.includes('newHomePreview') ?? false;
	}

	private getAiEnabled() {
		return configuration.get('ai.enabled');
	}

	private getAmaBannerCollapsed() {
		if (Date.now() >= new Date('2025-02-13T13:00:00-05:00').getTime()) return true;

		return this.container.storage.get('home:sections:collapsed')?.includes('feb2025AmaBanner') ?? false;
	}

	private getIntegrationBannerCollapsed() {
		return this.container.storage.get('home:sections:collapsed')?.includes('integrationBanner') ?? false;
	}

	private async getAiAllAccessBannerCollapsed() {
		// Hide banner if outside the promotion period
		if (!isAiAllAccessPromotionActive()) return true;
		const userId = await this.getAiAllAccessUserId();
		return this.container.storage.get(`gk:promo:${userId}:ai:allAccess:dismissed`, false);
	}

	private async getAiAllAccessUserId(): Promise<string> {
		const subscription = await this.container.subscription.getSubscription();
		return subscription.account?.id ?? '00000000';
	}

	@log()
	private async dismissAiAllAccessBanner() {
		this.container.telemetry.sendEvent('aiAllAccess/bannerDismissed', undefined, { source: 'home' });
		const userId = await this.getAiAllAccessUserId();
		void this.container.storage.store(`gk:promo:${userId}:ai:allAccess:dismissed`, true).catch();
		// TODO: Add telemetry tracking for AI All Access banner dismiss
		await this.onAiAllAccessBannerChanged();
	}

	private getOrgSettings(): State['orgSettings'] {
		return {
			drafts: getContext('gitlens:gk:organization:drafts:enabled', false),
			ai: getContext('gitlens:gk:organization:ai:enabled', true),
		};
	}

	private onContextChanged(key: keyof ContextKeys) {
		if (['gitlens:gk:organization:ai:enabled', 'gitlens:gk:organization:drafts:enabled'].includes(key)) {
			this.notifyDidChangeOrgSettings();
		}
	}

	@debug({ args: false })
	private async onSubscriptionChanged(e: SubscriptionChangeEvent) {
		if (e.etag === this._etagSubscription) return;

		await this.notifyDidChangeSubscription(e.current);

		if (
			isSubscriptionTrialOrPaidFromState(e.current.state) !== isSubscriptionTrialOrPaidFromState(e.previous.state)
		) {
			this.onOverviewRepoChanged();
		}

		await this.onAiAllAccessBannerChanged();
	}

	private async getState(subscription?: Subscription): Promise<State> {
		const [subResult, integrationResult, aiModelResult, aiAllAccessBannerCollapsed] = await Promise.allSettled([
			this.getSubscriptionState(subscription),
			this.getIntegrationStates(true),
			this.container.ai.getModel({ silent: true }, { source: 'home' }),
			this.getAiAllAccessBannerCollapsed(),
		]);

		if (subResult.status === 'rejected') {
			throw subResult.reason;
		}

		const integrations = getSettledValue(integrationResult) ?? [];
		const anyConnected = integrations.some(i => i.connected);
		const ai = { model: getSettledValue(aiModelResult) };

		return {
			...this.host.baseWebviewState,
			discovering: this._discovering != null,
			repositories: this.getRepositoriesState(),
			webroot: this.host.getWebRoot(),
			subscription: subResult.value.subscription,
			avatar: subResult.value.avatar,
			organizationsCount: subResult.value.organizationsCount,
			orgSettings: this.getOrgSettings(),
			aiEnabled: this.getAiEnabled(),
			previewCollapsed: this.getPreviewCollapsed(),
			integrationBannerCollapsed: this.getIntegrationBannerCollapsed(),
			aiAllAccessBannerCollapsed: getSettledValue(aiAllAccessBannerCollapsed, false),
			integrations: integrations,
			ai: ai,
			hasAnyIntegrationConnected: anyConnected,
			walkthroughSupported: this.container.walkthrough != null,
			walkthroughProgress:
				!this.getWalkthroughDismissed() && this.container.walkthrough != null
					? {
							allCount: this.container.walkthrough.walkthroughSize,
							doneCount: this.container.walkthrough.doneCount,
							progress: this.container.walkthrough.progress,
						}
					: undefined,
			previewEnabled: this.getPreviewEnabled(),
			newInstall: getContext('gitlens:install:new', false),
			amaBannerCollapsed: this.getAmaBannerCollapsed(),
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
		const forceWip = this._invalidateOverview === 'wip';

		const [branchesAndWorktreesResult, proSubscriptionResult, formatRepositoryResult] = await Promise.allSettled([
			this.getBranchesData(repo, forceRepo),
			this.isSubscriptionPro(),
			this.formatRepository(repo),
		]);

		const { branches, worktreesByBranch } = getSettledValue(branchesAndWorktreesResult)!;
		const activeBranch = branches.find(
			branch => this.getBranchOverviewType(branch, worktreesByBranch) === 'active',
		)!;
		const isPro = getSettledValue(proSubscriptionResult)!;

		const [activeOverviewBranch] = getOverviewBranchesCore(
			this.container,
			[activeBranch],
			worktreesByBranch,
			isPro,
			{
				isActive: true,
				forceStatus: forceRepo || forceWip ? true : undefined,
			},
		);

		if (forceWip) {
			this._invalidateOverview = undefined;
		}

		this._etagFileSystem = repo.etagFileSystem;

		return {
			repository: getSettledValue(formatRepositoryResult)!,
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

		const [branchesAndWorktreesResult, proSubscriptionResult, formatRepositoryResult] = await Promise.allSettled([
			this.getBranchesData(repo, forceRepo),
			this.isSubscriptionPro(),
			this.formatRepository(repo),
		]);

		const { branches, worktreesByBranch } = getSettledValue(branchesAndWorktreesResult)!;
		const recentBranches = branches.filter(
			branch => this.getBranchOverviewType(branch, worktreesByBranch) === 'recent',
		);
		const isPro = getSettledValue(proSubscriptionResult)!;

		let staleBranches: GitBranch[] | undefined;
		if (this._overviewBranchFilter.stale.show) {
			sortBranches(branches, {
				missingUpstream: true,
				orderBy: 'date:asc',
			});

			for (const branch of branches) {
				if (staleBranches != null && staleBranches.length > this._overviewBranchFilter.stale.limit) {
					break;
				}
				if (recentBranches.some(b => b.id === branch.id)) {
					continue;
				}

				if (this.getBranchOverviewType(branch, worktreesByBranch) !== 'stale') {
					continue;
				}

				staleBranches ??= [];
				staleBranches.push(branch);
			}
		}

		const recentOverviewBranches = getOverviewBranchesCore(
			this.container,
			recentBranches,
			worktreesByBranch,
			isPro,
		);
		const staleOverviewBranches =
			staleBranches == null
				? undefined
				: getOverviewBranchesCore(this.container, staleBranches, worktreesByBranch, isPro);

		// TODO: revisit invalidation
		if (!forceRepo) {
			this._invalidateOverview = undefined;
		}

		return {
			repository: getSettledValue(formatRepositoryResult)!,
			recent: recentOverviewBranches,
			stale: staleOverviewBranches,
		};
	}

	private async formatRepository(repo: Repository): Promise<OverviewRepository> {
		const remotes = await repo.git.remotes.getBestRemotesWithProviders();
		const remote = remotes.find(r => r.supportsIntegration()) ?? remotes[0];
		return toRepositoryShapeWithProvider(repo, remote);
	}

	private _repositorySubscription: SubscriptionManager<Repository> | undefined;
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

		this._repositorySubscription?.dispose();
		this._repositorySubscription = undefined;

		if (repo != null) {
			this._repositorySubscription = new SubscriptionManager(repo, r => this.subscribeToRepository(r));
			// Start the subscription immediately if webview is visible
			if (this.host.visible) {
				this._repositorySubscription.start();
			}
		}

		return repo;
	}

	private resetBranchOverview() {
		this._repositoryBranches.clear();

		if (!this.host.visible) {
			this._repositorySubscription?.pause();
			return;
		}

		this._repositorySubscription?.resume();
	}

	private subscribeToRepository(repo: Repository): Disposable {
		return Disposable.from(
			// TODO: advanced configuration for the watchFileSystem timing
			repo.watchFileSystem(1000),
			repo.onDidChangeFileSystem(e => this.onOverviewWipChanged(e, repo)),
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
					this.onOverviewRepoChanged(repo);
				}
			}),
		);
	}

	@debug({ args: { 0: false } })
	private onOverviewWipChanged(e: RepositoryFileSystemChangeEvent, repository: Repository) {
		if (e.repository.id !== repository.id) return;
		if (this._etagFileSystem === repository.etagFileSystem) return;

		// if the repo is already marked invalid, we already need to recompute the whole overview
		if (this._invalidateOverview !== 'repo') {
			this._invalidateOverview = 'wip';
		}

		if (!this.host.visible) return;

		void this.host.notify(DidChangeRepositoryWip, undefined);
	}

	@debug()
	private onOverviewRepoChanged(repo?: Repository) {
		if (repo != null) {
			if (this._etagRepository === repo.etag) {
				return;
			}
		} else if (this._etag === this.container.git.etag) {
			return;
		}

		this._invalidateOverview = 'repo';

		if (!this.host.visible) return;

		this.notifyDidChangeRepositories();
	}

	private async onAiAllAccessBannerChanged() {
		if (!this.host.visible) return;

		void this.host.notify(DidChangeAiAllAccessBanner, await this.getAiAllAccessBannerCollapsed());
	}

	private getSelectedRepository() {
		if (this._repositorySubscription == null) {
			this.selectRepository();
		}

		return this._repositorySubscription?.source;
	}

	private _invalidateOverview: 'repo' | 'wip' | undefined;
	private readonly _repositoryBranches: Map<string, RepositoryBranchData> = new Map();
	private async getBranchesData(repo: Repository, force = false) {
		if (force || !this._repositoryBranches.has(repo.path) || repo.etag !== this._etagRepository) {
			const worktrees = (await repo.git.worktrees?.getWorktrees()) ?? [];
			const worktreesByBranch = groupWorktreesByBranch(worktrees, { includeDefault: true });
			const [branchesResult] = await Promise.allSettled([
				repo.git.branches.getBranches({
					filter: b => !b.remote,
					sort: { current: true, openedWorktreesByBranch: getOpenedWorktreesByBranch(worktreesByBranch) },
				}),
			]);

			const branches = getSettledValue(branchesResult)?.values ?? [];
			this._etagRepository = repo.etag;

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
			const promises = filterMap(await this.container.integrations.getConfigured(), i => {
				if (!isSupportedCloudIntegrationId(i.integrationId)) {
					return undefined;
				}
				const supportedCloudDescriptor = supportedCloudIntegrationDescriptors.find(
					item => item.id === i.integrationId,
				);
				return {
					id: i.integrationId,
					name: providersMetadata[i.integrationId].name,
					icon: `gl-provider-${providersMetadata[i.integrationId].iconKey}`,
					connected: true,
					supports:
						supportedCloudDescriptor?.supports != null
							? supportedCloudDescriptor.supports
							: providersMetadata[i.integrationId].type === 'git'
								? ['prs', 'issues']
								: providersMetadata[i.integrationId].type === 'issues'
									? ['issues']
									: [],
					requiresPro: supportedCloudDescriptor?.requiresPro ?? false,
				} satisfies IntegrationState;
			});

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

		return isSubscriptionTrialOrPaidFromState(subscription.state);
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
		if (this.container.walkthrough == null) return;

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
			aiEnabled: this.getAiEnabled(),
		});
	}

	private notifyDidChangeLaunchpad() {
		void this.host.notify(DidChangeLaunchpad, undefined);
	}

	private async notifyDidChangeIntegrations() {
		// force rechecking
		const [integrationResult, aiModelResult] = await Promise.allSettled([
			this.getIntegrationStates(true),
			this.container.ai.getModel({ silent: true }, { source: 'home' }),
		]);

		const integrations = getSettledValue(integrationResult) ?? [];
		const anyConnected = integrations.some(i => i.connected);
		const ai = { model: getSettledValue(aiModelResult) };

		if (anyConnected) {
			this.onCollapseSection({
				section: 'integrationBanner',
				collapsed: true,
			});
		}
		void this.host.notify(DidChangeIntegrationsConnections, {
			hasAnyIntegrationConnected: anyConnected,
			integrations: integrations,
			ai: ai,
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

	@log<HomeWebviewProvider['deleteBranchOrWorktree']>({
		args: { 0: r => `${r.branchId}, upstream: ${r.branchUpstreamName}`, 1: mt => mt?.branchId },
	})
	private async deleteBranchOrWorktree(ref: BranchRef, mergeTarget?: BranchRef) {
		const { repo, branch } = await this.getRepoInfoFromRef(ref);
		if (branch == null) return;

		const worktree = branch.worktree === false ? undefined : (branch.worktree ?? (await branch.getWorktree()));

		if (branch.current && mergeTarget != null && (!worktree || worktree.isDefault)) {
			const mergeTargetLocalBranchName = getBranchNameWithoutRemote(mergeTarget.branchName);
			const confirm = await window.showWarningMessage(
				`Before deleting the current branch '${branch.name}', you will be switched to '${mergeTargetLocalBranchName}'.`,
				{ modal: true },
				{ title: 'Continue' },
			);

			if (confirm == null || confirm.title !== 'Continue') return;

			await this.container.git.getRepositoryService(ref.repoPath).checkout(mergeTargetLocalBranchName);

			void executeGitCommand({
				command: 'branch',
				state: {
					subcommand: 'delete',
					repo: ref.repoPath,
					references: branch,
				},
			});
		} else if (repo != null && worktree != null && !worktree.isDefault) {
			const commonRepo = await repo.getCommonRepository();
			const defaultWorktree = await repo.git.worktrees?.getWorktree(w => w.isDefault);
			if (defaultWorktree == null || commonRepo == null) return;

			const confirm = await window.showWarningMessage(
				`Before deleting the worktree for '${branch.name}', you will be switched to the default worktree.`,
				{ modal: true },
				{ title: 'Continue' },
			);

			if (confirm == null || confirm.title !== 'Continue') return;

			const schemeOverride = configuration.get('deepLinks.schemeOverride');
			const scheme = typeof schemeOverride === 'string' ? schemeOverride : env.uriScheme;
			const deleteBranchDeepLink = {
				url: `${scheme}://${this.container.context.extension.id}/${'link' satisfies UriTypes}/${
					DeepLinkType.Repository
				}/-/${DeepLinkType.Branch}/${encodeURIComponent(branch.name)}?path=${encodeURIComponent(
					commonRepo.path,
				)}&action=delete-branch`,
				repoPath: commonRepo.path,
				useProgress: false,
				state: DeepLinkServiceState.GoToTarget,
			};

			void executeGitCommand({
				command: 'worktree',
				state: {
					subcommand: 'open',
					repo: defaultWorktree.repoPath,
					worktree: defaultWorktree,
					onWorkspaceChanging: async (_isNewWorktree?: boolean) => {
						await this.container.storage.storeSecret(
							'deepLinks:pending',
							JSON.stringify(deleteBranchDeepLink),
						);
						// Close the current window. This should only occur if there was already a different
						// window open for the default worktree.
						setTimeout(() => {
							void executeCoreCommand('workbench.action.closeWindow');
						}, 2000);
					},
					worktreeDefaultOpen: 'current',
				},
			});
		}
	}

	@log<HomeWebviewProvider['pushBranch']>({
		args: { 0: r => `${r.branchId}, upstream: ${r.branchUpstreamName}` },
	})
	private pushBranch(ref: BranchRef) {
		void this.container.git.getRepositoryService(ref.repoPath).push({
			reference: {
				name: ref.branchName,
				ref: ref.branchId,
				refType: 'branch',
				remote: false,
				repoPath: ref.repoPath,
				upstream: ref.branchUpstreamName
					? {
							name: ref.branchUpstreamName,
							missing: false,
						}
					: undefined,
			},
		});
	}

	@log<HomeWebviewProvider['mergeTargetCompare']>({
		args: { 0: r => `${r.branchId}, upstream: ${r.branchUpstreamName}, mergeTargetId: ${r.mergeTargetId}` },
	})
	private mergeTargetCompare(ref: BranchAndTargetRefs) {
		return this.container.views.searchAndCompare.compare(ref.repoPath, ref.branchName, ref.mergeTargetName);
	}

	@log<HomeWebviewProvider['pullRequestCompare']>({
		args: { 0: r => `${r.branchId}, upstream: ${r.branchUpstreamName}` },
	})
	private async pullRequestCompare(ref: BranchRef) {
		const pr = await this.getPullRequestFromRef(ref);
		if (pr?.refs?.base == null || pr.refs.head == null) {
			void window.showErrorMessage('Unable to find pull request to compare');
			return;
		}

		const comparisonRefs = getComparisonRefsForPullRequest(ref.repoPath, pr.refs);
		return this.container.views.searchAndCompare.compare(
			comparisonRefs.repoPath,
			comparisonRefs.head,
			comparisonRefs.base,
		);
	}

	@log<HomeWebviewProvider['pullRequestChanges']>({
		args: { 0: r => `${r.branchId}, upstream: ${r.branchUpstreamName}` },
	})
	private async pullRequestChanges(ref: BranchRef) {
		const pr = await this.getPullRequestFromRef(ref);
		if (pr?.refs?.base == null || pr.refs.head == null) {
			void window.showErrorMessage('Unable to find pull request to open changes');
			return;
		}

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

	@log<HomeWebviewProvider['pullRequestViewOnRemote']>({
		args: { 0: r => `${r.branchId}, upstream: ${r.branchUpstreamName}` },
	})
	private async pullRequestViewOnRemote(ref: BranchRef, clipboard?: boolean) {
		const pr = await this.getPullRequestFromRef(ref);
		if (pr == null) {
			void window.showErrorMessage('Unable to find pull request to open on remote');
			return;
		}

		void executeCommand<OpenPullRequestOnRemoteCommandArgs>('gitlens.openPullRequestOnRemote', {
			pr: { url: pr.url },
			clipboard: clipboard,
		});
	}

	@log<HomeWebviewProvider['pullRequestDetails']>({
		args: { 0: r => `${r.branchId}, upstream: ${r.branchUpstreamName}` },
	})
	private async pullRequestDetails(ref: BranchRef) {
		const pr = await this.getPullRequestFromRef(ref);
		if (pr == null) {
			void window.showErrorMessage('Unable to find pull request to open details');
			return;
		}

		void this.container.views.pullRequest.showPullRequest(pr, ref.repoPath);
	}

	@log<HomeWebviewProvider['pullRequestCreate']>({
		args: { 0: a => `${a.ref.branchId}, upstream: ${a.ref.branchUpstreamName}` },
	})
	private async pullRequestCreate({ ref, describeWithAI, source }: CreatePullRequestCommandArgs) {
		const { branch } = await this.getRepoInfoFromRef(ref);
		if (branch == null) return;

		const remote = await branch.getRemote();

		// If we are describing with AI, we need to use the built-in action runner only
		const runnerId = describeWithAI
			? this.container.actionRunners.get('createPullRequest')?.find(r => r.type === ActionRunnerType.BuiltIn)?.id
			: undefined;

		executeActionCommand<CreatePullRequestActionContext>(
			'createPullRequest',
			{
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
				describeWithAI: describeWithAI,
				source: source,
			},
			runnerId,
		);
	}

	@log<HomeWebviewProvider['worktreeOpen']>({
		args: { 0: r => `${r.branchId}, worktree: ${r.worktree?.name}` },
	})
	private async worktreeOpen(args: OpenWorktreeCommandArgs) {
		const { location, ...ref } = args;
		const { branch } = await this.getRepoInfoFromRef(ref);
		const worktree = await branch?.getWorktree();
		if (worktree == null) return;

		openWorkspace(worktree.uri, location ? { location: location } : undefined);
	}

	@log<HomeWebviewProvider['switchToBranch']>({ args: { 0: r => r?.branchId } })
	private async switchToBranch(ref: BranchRef | { repoPath: string; branchName?: never; branchId?: never }) {
		const { repo, branch } = await this.getRepoInfoFromRef(ref);
		void RepoActions.switchTo(repo, branch ? getReferenceFromBranch(branch) : undefined);
	}

	@log<HomeWebviewProvider['fetch']>({ args: { 0: r => r?.branchId } })
	private async fetch(ref?: BranchRef) {
		if (ref == null) {
			const repo = this.getSelectedRepository();
			void RepoActions.fetch(repo);
			return;
		}

		const { repo, branch } = await this.getRepoInfoFromRef(ref);
		if (branch == null) return;

		void RepoActions.fetch(repo, getReferenceFromBranch(branch));
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

	private async getPullRequestFromRef(ref: BranchRef): Promise<PullRequest | undefined> {
		const { branch } = await this.getRepoInfoFromRef(ref);
		return branch?.getAssociatedPullRequest();
	}

	private async getRepoInfoFromRef(
		ref: BranchRef | { repoPath: string; branchName?: string },
	): Promise<{ repo: Repository; branch: GitBranch | undefined } | { repo: undefined; branch: undefined }> {
		const repo = this.container.git.getRepository(ref.repoPath);
		if (repo == null) return { repo: undefined, branch: undefined };
		if (!ref.branchName) return { repo: repo, branch: undefined };

		const branch = await repo.git.branches.getBranch(ref.branchName);
		return { repo: repo, branch: branch };
	}
}

function getOverviewBranchesCore(
	container: Container,
	branches: GitBranch[],
	worktreesByBranch: Map<string, GitWorktree>,
	isPro: boolean,
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
	const remotePromises = new Map<string, Promise<GitRemote | undefined>>();
	const prPromises = new Map<string, Promise<PullRequestInfo | undefined>>();
	const autolinkPromises = new Map<string, Promise<Map<string, EnrichedAutolink> | undefined>>();
	const issuePromises = new Map<string, Promise<Issue[] | undefined>>();
	const statusPromises = new Map<string, Promise<GitStatus | undefined>>();
	const contributorsPromises = new Map<string, Promise<BranchContributionsOverview | undefined>>();
	const mergeTargetPromises = new Map<string, Promise<BranchMergeTargetStatusInfo>>();

	const overviewBranches: GetOverviewBranch[] = [];
	for (const branch of branches) {
		if (branch.upstream?.missing === false) {
			remotePromises.set(branch.id, branch.getRemote());
		}

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
				container.git.getRepositoryService(branch.repoPath).branches.getBranchContributionsOverview(branch.ref),
			);
			if (branch.current) {
				mergeTargetPromises.set(branch.id, getBranchMergeTargetStatusInfo(container, branch));
			}
		}

		if (wt != null) {
			statusPromises.set(branch.id, wt.getStatus(forceOptions));
		} else if (isActive === true) {
			if (repoStatusPromise === undefined) {
				repoStatusPromise = container.git.getRepositoryService(branch.repoPath).status.getStatus();
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
			status: branch.status,
			upstream: branch.upstream,
			worktree: wt ? { name: wt.name, uri: wt.uri.toString(), isDefault: wt.isDefault } : undefined,
		});
	}

	if (overviewBranches.length > 0) {
		enrichOverviewBranchesCore(
			container,
			overviewBranches,
			isActive,
			remotePromises,
			prPromises,
			autolinkPromises,
			issuePromises,
			statusPromises,
			contributorsPromises,
			mergeTargetPromises,
		);
	}

	return overviewBranches;
}

// FIXME: support partial enrichment
function enrichOverviewBranchesCore(
	container: Container,
	overviewBranches: GetOverviewBranch[],
	isActive: boolean,
	remotePromises: Map<string, Promise<GitRemote | undefined>>,
	prPromises: Map<string, Promise<PullRequestInfo | undefined>>,
	autolinkPromises: Map<string, Promise<Map<string, EnrichedAutolink> | undefined>>,
	issuePromises: Map<string, Promise<Issue[] | undefined>>,
	statusPromises: Map<string, Promise<GitStatus | undefined>>,
	contributorsPromises: Map<string, Promise<BranchContributionsOverview | undefined>>,
	mergeTargetPromises: Map<string, Promise<BranchMergeTargetStatusInfo>>,
) {
	for (const branch of overviewBranches) {
		branch.remote = remotePromises.get(branch.id)?.then(async r => {
			if (r == null) return undefined;

			return {
				name: r.name,
				provider: r.provider
					? {
							name: r.provider.name,
							icon: r.provider.icon === 'remote' ? 'cloud' : r.provider.icon,
							url: await r.provider.url({ type: RemoteResourceType.Repo }),
							supportedFeatures: r.provider.supportedFeatures,
						}
					: undefined,
			};
		});

		branch.pr = prPromises.get(branch.id);

		const autolinks = autolinkPromises.get(branch.id);
		branch.autolinks = autolinks?.then(a => getAutolinkIssuesInfo(a));

		const issues = issuePromises.get(branch.id);
		branch.issues = issues?.then(
			issues =>
				issues?.map(
					i =>
						({ id: i.id, title: i.title, state: i.state, url: i.url }) satisfies NonNullable<IssuesInfo>[0],
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

			return { id: issue.id, title: issue.title, url: issue.url, state: issue.state };
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
					count: c.contributionCount,
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
	const info = await getBranchMergeTargetInfo(container, branch, {
		associatedPullRequest: branch.getAssociatedPullRequest(),
	});

	let targetResult;
	if (!info.mergeTargetBranch.paused && info.mergeTargetBranch.value) {
		targetResult = info.mergeTargetBranch.value;
	}

	const target = targetResult ?? info.baseBranch ?? info.defaultBranch;
	if (target == null) return undefined;

	const svc = container.git.getRepositoryService(branch.repoPath);
	const targetBranch = await svc.branches.getBranch(target);
	if (targetBranch == null) return undefined;

	const [countsResult, conflictResult, mergedStatusResult] = await Promise.allSettled([
		svc.commits.getLeftRightCommitCount(createRevisionRange(targetBranch.name, branch.ref, '...'), {
			excludeMerges: true,
		}),
		svc.branches.getPotentialMergeOrRebaseConflict?.(branch.name, targetBranch.name),
		svc.branches.getBranchMergedStatus?.(branch, targetBranch),
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
		result = await container.launchpad.getCategorizedItems({ search: [pr] });
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
		active ? container.git.getRepositoryService(branch.repoPath).status.getPausedOperationStatus?.() : undefined,
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
