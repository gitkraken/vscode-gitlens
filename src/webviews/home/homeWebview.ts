import type { ConfigurationChangeEvent } from 'vscode';
import { Disposable, env, Uri, window, workspace } from 'vscode';
import { ActionRunnerType } from '../../api/actionRunners.js';
import type { CreatePullRequestActionContext } from '../../api/gitlens.d.js';
import type { EnrichedAutolink } from '../../autolinks/models/autolinks.js';
import { getAvatarUriFromGravatarEmail } from '../../avatars.js';
import type { ExplainBranchCommandArgs } from '../../commands/explainBranch.js';
import type { ExplainWipCommandArgs } from '../../commands/explainWip.js';
import type { BranchGitCommandArgs } from '../../commands/git/branch.js';
import type { GlWebviewCommandsOrCommandsWithSuffix } from '../../constants.commands.js';
import type { ContextKeys } from '../../constants.context.js';
import {
	isSupportedCloudIntegrationId,
	supportedCloudIntegrationDescriptors,
	supportedOrderedCloudIntegrationIds,
} from '../../constants.integrations.js';
import { urls } from '../../constants.js';
import type { HomeTelemetryContext } from '../../constants.telemetry.js';
import type { WalkthroughContextKeys } from '../../constants.walkthroughs.js';
import type { Container } from '../../container.js';
import { revealBranch } from '../../git/actions/branch.js';
import { openComparisonChanges } from '../../git/actions/commit.js';
import {
	abortPausedOperation,
	continuePausedOperation,
	showPausedOperationStatus,
	skipPausedOperation,
} from '../../git/actions/pausedOperation.js';
import * as RepoActions from '../../git/actions/repository.js';
import { revealWorktree } from '../../git/actions/worktree.js';
import { executeGitCommand } from '../../git/actions.js';
import { PushError } from '../../git/errors.js';
import type { BranchContributionsOverview } from '../../git/gitProvider.js';
import type { GitBranch } from '../../git/models/branch.js';
import type { GitFileChangeShape } from '../../git/models/fileChange.js';
import type { Issue } from '../../git/models/issue.js';
import type { GitPausedOperationStatus } from '../../git/models/pausedOperationStatus.js';
import type { PullRequest } from '../../git/models/pullRequest.js';
import type { GitRemote } from '../../git/models/remote.js';
import { RemoteResourceType } from '../../git/models/remoteResource.js';
import type { Repository, RepositoryFileSystemChangeEvent } from '../../git/models/repository.js';
import { uncommitted } from '../../git/models/revision.js';
import type { GitStatus } from '../../git/models/status.js';
import type { GitWorktree } from '../../git/models/worktree.js';
import { getAssociatedIssuesForBranch } from '../../git/utils/-webview/branch.issue.utils.js';
import { getBranchMergeTargetInfo } from '../../git/utils/-webview/branch.utils.js';
import { getReferenceFromBranch } from '../../git/utils/-webview/reference.utils.js';
import { toRepositoryShapeWithProvider } from '../../git/utils/-webview/repository.utils.js';
import { sortBranches } from '../../git/utils/-webview/sorting.js';
import { getOpenedWorktreesByBranch, groupWorktreesByBranch } from '../../git/utils/-webview/worktree.utils.js';
import { getBranchNameWithoutRemote } from '../../git/utils/branch.utils.js';
import { getComparisonRefsForPullRequest } from '../../git/utils/pullRequest.utils.js';
import { createRevisionRange } from '../../git/utils/revision.utils.js';
import { showGitErrorMessage } from '../../messages.js';
import type { AIModelChangeEvent } from '../../plus/ai/aiProviderService.js';
import { showPatchesView } from '../../plus/drafts/actions.js';
import type { Subscription } from '../../plus/gk/models/subscription.js';
import type { SubscriptionChangeEvent } from '../../plus/gk/subscriptionService.js';
import { isMcpBannerEnabled, mcpExtensionRegistrationAllowed } from '../../plus/gk/utils/-webview/mcp.utils.js';
import { isAiAllAccessPromotionActive } from '../../plus/gk/utils/-webview/promo.utils.js';
import {
	getCommunitySubscription,
	isSubscriptionTrialOrPaidFromState,
} from '../../plus/gk/utils/subscription.utils.js';
import type { ConfiguredIntegrationsChangeEvent } from '../../plus/integrations/authentication/configuredIntegrationService.js';
import type { ConnectionStateChangeEvent } from '../../plus/integrations/integrationService.js';
import { providersMetadata } from '../../plus/integrations/providers/models.js';
import type { LaunchpadCategorizedResult } from '../../plus/launchpad/launchpadProvider.js';
import { getLaunchpadItemGroups } from '../../plus/launchpad/launchpadProvider.js';
import { getLaunchpadSummary } from '../../plus/launchpad/utils/-webview/launchpad.utils.js';
import type { StartWorkCommandArgs } from '../../plus/startWork/startWork.js';
import { getRepositoryPickerTitleAndPlaceholder, showRepositoryPicker } from '../../quickpicks/repositoryPicker.js';
import {
	executeActionCommand,
	executeCommand,
	executeCoreCommand,
	registerCommand,
	registerWebviewCommand,
} from '../../system/-webview/command.js';
import { configuration } from '../../system/-webview/configuration.js';
import { getContext, onDidChangeContext } from '../../system/-webview/context.js';
import type { StorageChangeEvent } from '../../system/-webview/storage.js';
import { openUrl } from '../../system/-webview/vscode/uris.js';
import { openWorkspace } from '../../system/-webview/vscode/workspaces.js';
import { createCommandDecorator, getWebviewCommand } from '../../system/decorators/command.js';
import { debug, trace } from '../../system/decorators/log.js';
import type { Deferrable } from '../../system/function/debounce.js';
import { debounce } from '../../system/function/debounce.js';
import { filterMap } from '../../system/iterable.js';
import { getLoggableName, Logger } from '../../system/logger.js';
import { maybeStartLoggableScope } from '../../system/logger.scope.js';
import { hasKeys } from '../../system/object.js';
import { getSettledValue } from '../../system/promise.js';
import { SubscriptionManager } from '../../system/subscriptionManager.js';
import { isWebviewContext } from '../../system/webview.js';
import type { UriTypes } from '../../uris/deepLinks/deepLink.js';
import { DeepLinkServiceState, DeepLinkType } from '../../uris/deepLinks/deepLink.js';
import type { IpcParams, IpcResponse } from '../ipc/handlerRegistry.js';
import { ipcCommand, ipcRequest } from '../ipc/handlerRegistry.js';
import type { ComposerCommandArgs } from '../plus/composer/registration.js';
import type { ShowInCommitGraphCommandArgs } from '../plus/graph/registration.js';
import type { Change } from '../plus/patchDetails/protocol.js';
import type { TimelineCommandArgs } from '../plus/timeline/registration.js';
import type { WebviewHost, WebviewProvider, WebviewShowingArgs } from '../webviewProvider.js';
import type { WebviewShowOptions } from '../webviewsController.js';
import type {
	BranchAndTargetRefs,
	BranchRef,
	CreatePullRequestCommandArgs,
	DidChangeRepositoriesParams,
	GetActiveOverviewResponse,
	GetInactiveOverviewResponse,
	GetOverviewBranch,
	IntegrationState,
	OpenInTimelineParams,
	OpenWorktreeCommandArgs,
	OverviewFilters,
	OverviewRecentThreshold,
	OverviewRepository,
	OverviewStaleThreshold,
	State,
	SubscriptionState,
} from './protocol.js';
import {
	ChangeOverviewRepositoryCommand,
	CollapseSectionCommand,
	DidChangeAiAllAccessBanner,
	DidChangeIntegrationsConnections,
	DidChangeLaunchpad,
	DidChangeMcpBanner,
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
} from './protocol.js';
import type { HomeWebviewShowingArgs } from './registration.js';

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

const { command, getCommands } = createCommandDecorator<GlWebviewCommandsOrCommandsWithSuffix<'home'>>();

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
			this.container.integrations.onDidChangeConnectionState(this.onIntegrationConnectionStateChanged, this),
			this.container.walkthrough.onDidChangeProgress(this.onWalkthroughProgressChanged, this),
			configuration.onDidChange(this.onDidChangeConfig, this),
			this.container.launchpad.onDidChange(this.onLaunchpadChanged, this),
			this.container.ai.onDidChangeModel(this.onAIModelChanged, this),
			this.container.storage.onDidChange(this.onStorageChanged, this),
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

	private onStorageChanged(e: StorageChangeEvent) {
		if (e.type === 'global' && e.keys.includes('mcp:banner:dismissed')) {
			this.onMcpBannerChanged();
		}
	}

	private onIntegrationsChanged(_e: ConfiguredIntegrationsChangeEvent) {
		void this.notifyDidChangeIntegrations();
	}

	private onIntegrationConnectionStateChanged(_e: ConnectionStateChangeEvent) {
		void this.notifyDidChangeIntegrations();
	}

	private async onChooseRepository() {
		const currentRepo = this.getSelectedRepository();
		// // Ensure that the current repository is always last
		// const repositories = this.container.git.openRepositories.sort(
		// 	(a, b) =>
		// 		(a === currentRepo ? 1 : -1) - (b === currentRepo ? 1 : -1) ||
		// 		(a.starred ? -1 : 1) - (b.starred ? -1 : 1) ||
		// 		a.index - b.index,
		// );

		const { title, placeholder } = getRepositoryPickerTitleAndPlaceholder(
			this.container.git.openRepositories,
			'Switch',
			currentRepo?.name,
		);
		const pick = await showRepositoryPicker(
			this.container,
			title,
			placeholder,
			this.container.git.openRepositories,
			{ picked: currentRepo },
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
		if (configuration.changed(e, ['home.preview.enabled', 'ai.enabled', 'ai.experimental.composer.enabled'])) {
			this.notifyDidChangeConfig();
		}
	}

	private onLaunchpadChanged() {
		this.notifyDidChangeLaunchpad();
	}

	@command('gitlens.push:')
	private async push(options?: { force?: boolean }) {
		const repo = this.getSelectedRepository();
		return executeGitCommand({
			command: 'push',
			state: { repos: repo ? [repo] : undefined, flags: options?.force ? ['--force'] : undefined },
		});
	}

	@command('gitlens.publishBranch:')
	private async publishBranch(ref: BranchRef) {
		const { repo, branch } = await this.getRepoInfoFromRef(ref);
		if (branch == null) return;

		return RepoActions.push(repo, undefined, getReferenceFromBranch(branch));
	}

	@command('gitlens.pull:')
	private async pull() {
		const repo = this.getSelectedRepository();
		return executeGitCommand({ command: 'pull', state: { repos: repo ? [repo] : undefined } });
	}

	registerCommands(): Disposable[] {
		const commands: Disposable[] = [];

		if (this.host.is('view')) {
			commands.push(
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
			);
		}

		// Register commands from @command decorators
		for (const { command, handler } of getCommands()) {
			const modified = (...args: any[]) => {
				const [arg] = args;
				if (isWebviewContext(arg)) {
					const { webview: _webview, webviewInstance: _webviewInstance, ...rest } = arg;
					if (hasKeys(rest)) {
						args.splice(0, 1, rest);
					} else {
						args.length = 0;
					}
				}

				// eslint-disable-next-line @typescript-eslint/no-unsafe-return
				return handler.call(this, ...args);
			};

			commands.push(registerWebviewCommand(getWebviewCommand(command, this.host.type), modified, this));
		}

		return commands;
	}

	@ipcCommand(SetOverviewFilter)
	private onSetOverviewFilter(params: IpcParams<typeof SetOverviewFilter>) {
		this._overviewBranchFilter = params;
		void this.host.notify(DidChangeOverviewFilter, { filter: this._overviewBranchFilter });
	}

	@ipcRequest(GetLaunchpadSummary)
	private async onGetLaunchpadSummary(): Promise<IpcResponse<typeof GetLaunchpadSummary>> {
		return getLaunchpadSummary(this.container);
	}

	@ipcRequest(GetOverviewFilterState)
	private onGetOverviewFilterState(): IpcResponse<typeof GetOverviewFilterState> {
		return this._overviewBranchFilter;
	}

	@ipcCommand(ChangeOverviewRepositoryCommand)
	private async onChangeOverviewRepository() {
		if ((await this.onChooseRepository()) == null) return;

		void this.host.notify(DidChangeOverviewRepository, undefined);
	}

	@ipcRequest(GetActiveOverview)
	private onGetActiveOverview(): Promise<IpcResponse<typeof GetActiveOverview>> {
		return this.getActiveBranchOverview();
	}

	@ipcRequest(GetInactiveOverview)
	private onGetInactiveOverview(): Promise<IpcResponse<typeof GetInactiveOverview>> {
		return this.getInactiveBranchOverview();
	}

	includeBootstrap(_deferrable?: boolean): Promise<State> {
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

	@ipcCommand(OpenInGraphCommand)
	@command('gitlens.showInCommitGraph:')
	@debug({
		args: params => ({ params: `${params?.type}, repoPath=${params?.repoPath}, branchId=${params?.branchId}` }),
	})
	private showInCommitGraph(params: IpcParams<typeof OpenInGraphCommand>) {
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
					source: { source: 'home' },
				});
				return;
			}
		}

		void executeCommand('gitlens.showGraph', repoInfo.repo);
	}

	@command('gitlens.visualizeHistory.branch:')
	@command('gitlens.visualizeHistory.repo:')
	@debug({
		args: params => ({ params: `${params?.type}, repoPath=${params?.repoPath}, branchId=${params?.branchId}` }),
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

	@command('gitlens.openInView.branch:')
	@debug({
		args: params => ({ params: `repoPath=${params?.repoPath}, branchId=${params?.branchId}` }),
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

	@command('gitlens.createBranch:')
	@debug()
	private createBranch() {
		this.container.telemetry.sendEvent('home/createBranch');
		void executeCommand<BranchGitCommandArgs>('gitlens.gitCommands', {
			command: 'branch',
			state: {
				subcommand: 'create',
				suggestedRepo: this.getSelectedRepository(),
				confirmOptions: ['--switch', '--worktree'],
			},
		});
	}

	@command('gitlens.git.branch.setMergeTarget:')
	@debug()
	private changeBranchMergeTarget(ref: BranchAndTargetRefs) {
		this.container.telemetry.sendEvent('home/changeBranchMergeTarget');
		void executeCommand<BranchGitCommandArgs>('gitlens.git.branch.setMergeTarget', {
			command: 'branch',
			state: {
				subcommand: 'mergeTarget',
				repo: ref.repoPath,
				reference: ref.branchName,
				suggestedMergeTarget: ref.mergeTargetName,
			},
		});
	}

	@command('gitlens.mergeIntoCurrent:')
	@debug({ args: ref => ({ ref: ref.branchId }) })
	private async mergeIntoCurrent(ref: BranchRef) {
		const { repo, branch } = await this.getRepoInfoFromRef(ref);
		if (branch == null) return;

		void RepoActions.merge(repo, getReferenceFromBranch(branch));
	}

	@command('gitlens.rebaseCurrentOnto:')
	@debug({ args: ref => ({ ref: ref.branchId }) })
	private async rebaseCurrentOnto(ref: BranchRef) {
		const { repo, branch } = await this.getRepoInfoFromRef(ref);
		if (branch == null) return;

		void RepoActions.rebase(repo, getReferenceFromBranch(branch));
	}

	@command('gitlens.ai.explainBranch:')
	@debug({ args: ref => ({ ref: ref.branchId }) })
	private async explainBranch(ref: BranchRef) {
		const { repo, branch } = await this.getRepoInfoFromRef(ref);
		if (repo == null) return;

		void executeCommand<ExplainBranchCommandArgs>('gitlens.ai.explainBranch', {
			repoPath: repo.path,
			ref: branch?.ref,
			source: { source: 'home', context: { type: 'branch' } },
		});
	}

	@command('gitlens.ai.explainWip:')
	@debug({ args: ref => ({ ref: ref.branchId }) })
	private async explainWip(ref: BranchRef) {
		const { repo, branch } = await this.getRepoInfoFromRef(ref);
		if (repo == null) return;

		const worktree = await branch?.getWorktree();

		void executeCommand<ExplainWipCommandArgs>('gitlens.ai.explainWip', {
			repoPath: repo.path,
			worktreePath: worktree?.path,
			source: { source: 'home', context: { type: 'wip' } },
		});
	}

	@command('gitlens.composeCommits:')
	@debug({ args: ref => ({ ref: ref.branchId }) })
	private async composeCommits(ref: BranchRef) {
		const { repo } = await this.getRepoInfoFromRef(ref);
		if (repo == null) return;

		void executeCommand<ComposerCommandArgs>('gitlens.composeCommits', {
			repoPath: repo.path,
			source: 'home',
		});
	}

	@command('gitlens.startWork:')
	@debug()
	private startWork() {
		this.container.telemetry.sendEvent('home/startWork');
		void executeCommand<StartWorkCommandArgs>('gitlens.startWork', {
			command: 'startWork',
			source: 'home',
		});
	}

	@command('gitlens.pausedOperation.abort:')
	@debug({ args: pausedOpArgs => ({ pausedOpArgs: pausedOpArgs.type }) })
	private async abortPausedOperation(pausedOpArgs: GitPausedOperationStatus) {
		await abortPausedOperation(this.container.git.getRepositoryService(pausedOpArgs.repoPath));
	}

	@command('gitlens.pausedOperation.continue:')
	@debug({ args: pausedOpArgs => ({ pausedOpArgs: pausedOpArgs.type }) })
	private async continuePausedOperation(pausedOpArgs: GitPausedOperationStatus) {
		if (pausedOpArgs.type === 'revert') return;

		await continuePausedOperation(this.container.git.getRepositoryService(pausedOpArgs.repoPath));
	}

	@command('gitlens.pausedOperation.skip:')
	@debug({ args: pausedOpArgs => ({ pausedOpArgs: pausedOpArgs.type }) })
	private async skipPausedOperation(pausedOpArgs: GitPausedOperationStatus) {
		await skipPausedOperation(this.container.git.getRepositoryService(pausedOpArgs.repoPath));
	}

	@command('gitlens.pausedOperation.open:')
	@debug({ args: pausedOpArgs => ({ pausedOpArgs: pausedOpArgs.type }) })
	private async openRebaseEditor(pausedOpArgs: GitPausedOperationStatus) {
		if (pausedOpArgs.type !== 'rebase') return;

		const gitDir = await this.container.git.getRepositoryService(pausedOpArgs.repoPath).config.getGitDir?.();
		if (gitDir == null) return;

		const rebaseTodoUri = Uri.joinPath(gitDir.uri, 'rebase-merge', 'git-rebase-todo');
		void executeCoreCommand('vscode.openWith', rebaseTodoUri, 'gitlens.rebase', {
			preview: false,
		});
	}

	@command('gitlens.pausedOperation.showConflicts:')
	@debug({ args: pausedOpArgs => ({ pausedOpArgs: pausedOpArgs.type }) })
	private async showConflicts(pausedOpArgs: GitPausedOperationStatus) {
		await showPausedOperationStatus(this.container, pausedOpArgs.repoPath, { openRebaseEditor: true });
	}

	@command('gitlens.createCloudPatch:')
	@debug({ args: ref => ({ ref: ref.branchId }) })
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

	@ipcCommand(TogglePreviewEnabledCommand)
	private onTogglePreviewEnabled(isEnabled?: boolean) {
		if (isEnabled === undefined) {
			isEnabled = !this.getPreviewEnabled();
		}

		this.container.telemetry.sendEvent('home/preview/toggled', { enabled: isEnabled, version: 'v16' });
		configuration.updateEffective('home.preview.enabled', isEnabled);
	}

	@ipcCommand(CollapseSectionCommand)
	private onCollapseSection(params: IpcParams<typeof CollapseSectionCommand>) {
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

	@ipcCommand(DismissWalkthroughSection)
	@debug()
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

	private getWelcomeOverlayCollapsed() {
		return this.container.storage.get('home:sections:collapsed')?.includes('welcomeOverlay') ?? false;
	}

	private getAiEnabled() {
		return this.container.ai.enabled;
	}

	private getExperimentalComposerEnabled() {
		return configuration.get('ai.experimental.composer.enabled', undefined, false);
	}

	private getAmaBannerCollapsed() {
		if (Date.now() >= new Date('2025-02-13T13:00:00-05:00').getTime()) return true;

		return this.container.storage.get('home:sections:collapsed')?.includes('feb2025AmaBanner') ?? false;
	}

	private getMcpBannerCollapsed() {
		return !isMcpBannerEnabled(this.container, true);
	}

	private getMcpCanAutoRegister() {
		return mcpExtensionRegistrationAllowed(this.container);
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

	@ipcCommand(DismissAiAllAccessBannerCommand)
	@debug()
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

	@trace({ args: false })
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
		const [subscriptionResult, integrationResult, aiModelResult, aiAllAccessBannerCollapsed] =
			await Promise.allSettled([
				this.getSubscriptionState(subscription),
				this.getIntegrationStates(true),
				this.container.ai.getModel({ silent: true }, { source: 'home' }),
				this.getAiAllAccessBannerCollapsed(),
			]);

		// Handle subscription rejection gracefully by falling back to community subscription
		let subscriptionState: SubscriptionState;
		if (subscriptionResult.status === 'fulfilled') {
			subscriptionState = subscriptionResult.value;
		} else {
			using scope = maybeStartLoggableScope(
				`${getLoggableName(this)}.getState(${Logger.toLoggable(subscription)})`,
			);
			scope?.error(subscriptionResult.reason, 'Failed to get subscription state');

			this.container.telemetry.sendEvent('home/failed', {
				reason: 'subscription',
				error: String(subscriptionResult.reason),
			});

			subscriptionState = {
				subscription: getCommunitySubscription(),
				avatar: `${this.host.getWebRoot() ?? ''}/media/gitlens-logo.webp`,
				organizationsCount: 0,
			};
		}

		const integrations = getSettledValue(integrationResult) ?? [];
		const anyConnected = integrations.some(i => i.connected);
		const ai = { model: getSettledValue(aiModelResult) };

		return {
			...this.host.baseWebviewState,
			discovering: this._discovering != null,
			repositories: this.getRepositoriesState(),
			webroot: this.host.getWebRoot(),
			subscription: subscriptionState.subscription,
			avatar: subscriptionState.avatar,
			organizationsCount: subscriptionState.organizationsCount,
			orgSettings: this.getOrgSettings(),
			aiEnabled: this.getAiEnabled(),
			experimentalComposerEnabled: this.getExperimentalComposerEnabled(),
			integrationBannerCollapsed: this.getIntegrationBannerCollapsed(),
			aiAllAccessBannerCollapsed: getSettledValue(aiAllAccessBannerCollapsed, false),
			integrations: integrations,
			ai: ai,
			hasAnyIntegrationConnected: anyConnected,
			walkthroughSupported: this.container.walkthrough.isWalkthroughSupported,
			walkthroughProgress: this.getWalkthroughProgress(),
			previewEnabled: this.getPreviewEnabled(),
			newInstall: !configuration.get('advanced.skipOnboarding') && getContext('gitlens:install:new', false),
			amaBannerCollapsed: this.getAmaBannerCollapsed(),
			mcpBannerCollapsed: this.getMcpBannerCollapsed(),
			mcpCanAutoRegister: this.getMcpCanAutoRegister(),
			welcomeOverlayCollapsed: this.getWelcomeOverlayCollapsed(),
			hostAppName: env.appName,
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
			repo = this.container.git.getBestRepositoryOrFirst();
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
						'config',
						'head',
						'heads',
						// 'index',
						'remotes',
						'pausedOp',
						'starred',
						'worktrees',
						'unknown',
					)
				) {
					this.onOverviewRepoChanged(repo);
				}
			}),
		);
	}

	@trace({ args: (_e, repository) => ({ repository: repository.id }) })
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

	@trace()
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

	private onMcpBannerChanged() {
		if (!this.host.visible) return;

		void this.host.notify(DidChangeMcpBanner, {
			mcpBannerCollapsed: this.getMcpBannerCollapsed(),
			mcpCanAutoRegister: this.getMcpCanAutoRegister(),
		});
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

			// eslint-disable-next-line @typescript-eslint/await-thenable
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

	private async getSubscriptionState(subscription?: Subscription): Promise<SubscriptionState> {
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

		this._notifyDidChangeRepositoriesDebounced ??= debounce(this.notifyDidChangeRepositoriesCore.bind(this), 500);

		this._notifyDidChangeRepositoriesDebounced();
	}

	private getWalkthroughProgress(): State['walkthroughProgress'] {
		if (this.getWalkthroughDismissed()) return undefined;

		const walkthroughState = this.container.walkthrough.getState();
		const state: Record<string, boolean> = Object.fromEntries(walkthroughState);

		return {
			allCount: this.container.walkthrough.walkthroughSize,
			doneCount: this.container.walkthrough.doneCount,
			progress: this.container.walkthrough.progress,
			state: state as Record<WalkthroughContextKeys, boolean>,
		};
	}

	private notifyDidChangeProgress() {
		const state = this.getWalkthroughProgress();
		if (state == null) return;

		void this.host.notify(DidChangeWalkthroughProgress, state);
	}

	private notifyDidChangeConfig() {
		void this.host.notify(DidChangePreviewEnabled, {
			previewEnabled: this.getPreviewEnabled(),
			aiEnabled: this.getAiEnabled(),
			experimentalComposerEnabled: this.getExperimentalComposerEnabled(),
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

	@command('gitlens.deleteBranchOrWorktree:')
	@debug({
		args: (ref, mergeTarget) => ({
			ref: `${ref.branchId}, upstream: ${ref.branchUpstreamName}`,
			mergeTarget: mergeTarget?.branchId,
		}),
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
			if (confirm?.title !== 'Continue') return;

			try {
				await this.container.git.getRepositoryService(ref.repoPath).ops?.checkout(mergeTargetLocalBranchName);
			} catch (ex) {
				void showGitErrorMessage(ex, `Unable to switch to branch '${mergeTargetLocalBranchName}'`);
				return;
			}

			void executeGitCommand({
				command: 'branch',
				state: {
					subcommand: 'delete',
					repo: ref.repoPath,
					references: branch,
				},
			});
		} else if (repo != null && worktree != null && !worktree.isDefault) {
			const commonRepo = await repo.getOrOpenCommonRepository();
			const defaultWorktree = await repo.git.worktrees?.getWorktree(w => w.isDefault);
			if (defaultWorktree == null || commonRepo == null) return;

			const confirm = await window.showWarningMessage(
				`Before deleting the worktree for '${branch.name}', you will be switched to the default worktree.`,
				{ modal: true },
				{ title: 'Continue' },
			);
			if (confirm?.title !== 'Continue') return;

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

	@command('gitlens.pushBranch:')
	@debug({
		args: ref => ({ ref: `${ref.branchId}, upstream: ${ref.branchUpstreamName}` }),
	})
	private async pushBranch(ref: BranchRef) {
		try {
			await this.container.git.getRepositoryService(ref.repoPath).ops?.push({
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
		} catch (ex) {
			if (PushError.is(ex)) {
				void showGitErrorMessage(ex);
			} else {
				void showGitErrorMessage(ex, 'Unable to push branch');
			}
		}
	}

	@command('gitlens.openMergeTargetComparison:')
	@debug({
		args: ref => ({
			ref: `${ref.branchId}, upstream: ${ref.branchUpstreamName}, mergeTargetId: ${ref.mergeTargetId}`,
		}),
	})
	private mergeTargetCompare(ref: BranchAndTargetRefs) {
		return this.container.views.searchAndCompare.compare(ref.repoPath, ref.branchName, ref.mergeTargetName);
	}

	@command('gitlens.openPullRequestComparison:')
	@debug({
		args: ref => ({ ref: `${ref.branchId}, upstream: ${ref.branchUpstreamName}` }),
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

	@command('gitlens.openPullRequestChanges:')
	@debug({
		args: ref => ({ ref: `${ref.branchId}, upstream: ${ref.branchUpstreamName}` }),
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

	// @command('gitlens.openPullRequestOnRemote:')
	// @log<HomeWebviewProvider['pullRequestViewOnRemote']>({
	// 	args: { 0: r => `${r.branchId}, upstream: ${r.branchUpstreamName}` },
	// })
	// private async pullRequestViewOnRemote(ref: BranchRef, clipboard?: boolean) {
	// 	const pr = await this.getPullRequestFromRef(ref);
	// 	if (pr == null) {
	// 		void window.showErrorMessage('Unable to find pull request to open on remote');
	// 		return;
	// 	}

	// 	void executeCommand<OpenPullRequestOnRemoteCommandArgs>('gitlens.openPullRequestOnRemote', {
	// 		pr: { url: pr.url },
	// 		clipboard: clipboard,
	// 	});
	// }

	@command('gitlens.openPullRequestDetails:')
	@debug({
		args: ref => ({ ref: `${ref.branchId}, upstream: ${ref.branchUpstreamName}` }),
	})
	private async pullRequestDetails(ref: BranchRef) {
		const pr = await this.getPullRequestFromRef(ref);
		if (pr == null) {
			void window.showErrorMessage('Unable to find pull request to open details');
			return;
		}

		void this.container.views.pullRequest.showPullRequest(pr, ref.repoPath);
	}

	@command('gitlens.createPullRequest:')
	@debug({
		args: a => ({ a: `${a.ref.branchId}, upstream: ${a.ref.branchUpstreamName}` }),
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

	@command('gitlens.openWorktree:')
	@debug({
		args: args => ({ args: `${args.branchId}, worktree: ${args.worktree?.name}` }),
	})
	private async worktreeOpen(args: OpenWorktreeCommandArgs) {
		const { location, ...ref } = args;
		const { branch } = await this.getRepoInfoFromRef(ref);
		const worktree = await branch?.getWorktree();
		if (worktree == null) return;

		openWorkspace(worktree.uri, location ? { location: location } : undefined);
	}

	@command('gitlens.switchToBranch:')
	@debug({ args: ref => ({ ref: ref?.branchId }) })
	private async switchToBranch(ref: BranchRef | { repoPath: string; branchName?: never; branchId?: never }) {
		const { repo, branch } = await this.getRepoInfoFromRef(ref);
		void RepoActions.switchTo(repo, branch ? getReferenceFromBranch(branch) : undefined);
	}

	@command('gitlens.fetch:')
	@debug({ args: ref => ({ ref: ref?.branchId }) })
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
						({
							id: i.number || i.id,
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
		svc.branches.getPotentialMergeConflicts?.(branch.name, targetBranch.name),
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
		active
			? container.git.getRepositoryService(branch.repoPath).pausedOps?.getPausedOperationStatus?.()
			: undefined,
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
