import { Disposable, env, Uri, window, workspace } from 'vscode';
import { PushError } from '@gitlens/git/errors.js';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import type { Issue } from '@gitlens/git/models/issue.js';
import type { GitPausedOperationStatus } from '@gitlens/git/models/pausedOperationStatus.js';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import type { GitRemote } from '@gitlens/git/models/remote.js';
import { RemoteResourceType } from '@gitlens/git/models/remoteResource.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { GitStatus } from '@gitlens/git/models/status.js';
import { GitWorktree } from '@gitlens/git/models/worktree.js';
import type { BranchContributionsOverview } from '@gitlens/git/providers/branches.js';
import { getBranchNameWithoutRemote } from '@gitlens/git/utils/branch.utils.js';
import { getComparisonRefsForPullRequest } from '@gitlens/git/utils/pullRequest.utils.js';
import { createRevisionRange } from '@gitlens/git/utils/revision.utils.js';
import { sortBranches } from '@gitlens/git/utils/sorting.js';
import { debug, trace } from '@gitlens/utils/decorators/log.js';
import { filterMap } from '@gitlens/utils/iterable.js';
import { hasKeys } from '@gitlens/utils/object.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import { SubscriptionManager } from '@gitlens/utils/subscriptionManager.js';
import { ActionRunnerType } from '../../api/actionRunners.js';
import type { CreatePullRequestActionContext } from '../../api/gitlens.d.js';
import type { EnrichedAutolink } from '../../autolinks/models/autolinks.js';
import { getAvatarUriFromGravatarEmail } from '../../avatars.js';
import type { ExplainBranchCommandArgs } from '../../commands/explainBranch.js';
import type { ExplainWipCommandArgs } from '../../commands/explainWip.js';
import type { BranchGitCommandArgs } from '../../commands/git/branch.js';
import type { GlWebviewCommandsOrCommandsWithSuffix } from '../../constants.commands.js';
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
import type { GlRepository } from '../../git/models/repository.js';
import { getAssociatedIssuesForBranch } from '../../git/utils/-webview/branch.issue.utils.js';
import {
	getBranchAssociatedPullRequest,
	getBranchEnrichedAutolinks,
	getBranchMergeTargetInfo,
	getBranchRemote,
	getBranchWorktree,
} from '../../git/utils/-webview/branch.utils.js';
import { getContributorAvatarUri } from '../../git/utils/-webview/contributor.utils.js';
import { getReferenceFromBranch } from '../../git/utils/-webview/reference.utils.js';
import { remoteSupportsIntegration } from '../../git/utils/-webview/remote.utils.js';
import { toRepositoryShapeWithProvider } from '../../git/utils/-webview/repository.utils.js';
import { getOpenedWorktreesByBranch, groupWorktreesByBranch } from '../../git/utils/-webview/worktree.utils.js';
import { showGitErrorMessage } from '../../messages.js';
import { showPatchesView } from '../../plus/drafts/actions.js';
import type { Subscription } from '../../plus/gk/models/subscription.js';
import type { SubscriptionChangeEvent } from '../../plus/gk/subscriptionService.js';
import { isSubscriptionTrialOrPaidFromState } from '../../plus/gk/utils/subscription.utils.js';
import type { ConfiguredIntegrationsChangeEvent } from '../../plus/integrations/authentication/configuredIntegrationService.js';
import type { ConnectionStateChangeEvent } from '../../plus/integrations/integrationService.js';
import { providersMetadata } from '../../plus/integrations/providers/models.js';
import type { LaunchpadCategorizedResult } from '../../plus/launchpad/launchpadProvider.js';
import { getLaunchpadItemGroups } from '../../plus/launchpad/launchpadProvider.js';
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
import { getContext } from '../../system/-webview/context.js';
import { openUrl } from '../../system/-webview/vscode/uris.js';
import { openWorkspace } from '../../system/-webview/vscode/workspaces.js';
import { createCommandDecorator, getWebviewCommand } from '../../system/decorators/command.js';
import { isWebviewContext } from '../../system/webview.js';
import type { UriTypes } from '../../uris/deepLinks/deepLink.js';
import { DeepLinkServiceState, DeepLinkType } from '../../uris/deepLinks/deepLink.js';
import type { ComposerCommandArgs } from '../plus/composer/registration.js';
import type { ShowInCommitGraphCommandArgs } from '../plus/graph/registration.js';
import type { Change } from '../plus/patchDetails/protocol.js';
import type { TimelineCommandArgs } from '../plus/timeline/registration.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from '../rpc/eventVisibilityBuffer.js';
import { createCallbackMapSubscription, createEventSubscription } from '../rpc/eventVisibilityBuffer.js';
import { LaunchpadService } from '../rpc/launchpadService.js';
import { createSharedServices, proxyServices } from '../rpc/services/common.js';
import type { WebviewHost, WebviewProvider, WebviewShowingArgs } from '../webviewProvider.js';
import type { WebviewShowOptions } from '../webviewsController.js';
import type { HomeServices, HomeViewService, WalkthroughProgressState } from './homeService.js';
import type {
	AgentSessionState,
	BranchAndTargetRefs,
	BranchRef,
	CollapseSectionParams,
	CreatePullRequestCommandArgs,
	DidChangeRepositoriesParams,
	GetOverviewBranch,
	GetOverviewBranchesResponse,
	GetOverviewEnrichmentResponse,
	GetOverviewWipResponse,
	IntegrationState,
	OpenInGraphParams,
	OpenInTimelineParams,
	OpenWorktreeCommandArgs,
	OverviewBranch,
	OverviewBranchEnrichment,
	OverviewFilters,
	OverviewRecentThreshold,
	OverviewRepository,
	OverviewStaleThreshold,
	State,
	SubscriptionState,
} from './protocol.js';
import { DidChangeSubscription } from './protocol.js';
import type { HomeWebviewShowingArgs } from './registration.js';

interface RepositoryBranchData {
	repo: GlRepository;
	branches: GitBranch[];
	worktreesByBranch: Map<string, GitWorktree>;
}

type BranchMergeTargetStatusInfo = Awaited<GetOverviewBranch['mergeTarget']>;
type ContributorsInfo = Awaited<GetOverviewBranch['contributors']>;
type LaunchpadItemInfo = Awaited<NonNullable<Awaited<GetOverviewBranch['pr']>>['launchpad']>;
type PullRequestInfo = Awaited<GetOverviewBranch['pr']>;

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
	private _etagRepository?: number;
	private _etagSubscription?: number;
	private _pendingFocusAccount = false;

	constructor(
		private readonly container: Container,
		private readonly host: WebviewHost<'gitlens.views.home'>,
	) {
		this._disposable = Disposable.from(
			this.container.subscription.onDidChange(this.onSubscriptionChanged, this),
			this.container.integrations.onDidChange(this.onIntegrationsChanged, this),
			this.container.integrations.onDidChangeConnectionState(this.onIntegrationConnectionStateChanged, this),
		);
	}

	dispose(): void {
		this._disposable.dispose();
	}

	getTelemetryContext(): HomeTelemetryContext {
		return this.host.getTelemetryContext();
	}

	getRpcServices(buffer?: EventVisibilityBuffer, tracker?: SubscriptionTracker): HomeServices {
		// Home has no webview-pushed telemetry context — all context is host-computed
		const base = createSharedServices(this.container, this.host, () => {}, buffer, tracker);

		const home: HomeViewService = {
			// --- Overview ---
			getOverviewBranches: (type?: 'active' | 'inactive', signal?: AbortSignal) =>
				this.getOverviewBranches(type, signal),
			getOverviewWip: (branchIds: string[], signal?: AbortSignal) => this.getOverviewWip(branchIds, signal),
			getOverviewEnrichment: (branchIds: string[], signal?: AbortSignal) =>
				this.getOverviewEnrichment(branchIds, signal),
			getOverviewFilterState: () => Promise.resolve(this._overviewBranchFilter),
			setOverviewFilter: filter => {
				this._overviewBranchFilter = filter;
				for (const cb of [...this._rpcOverviewFilterChangedCallbacks.values()]) {
					cb({ filter: this._overviewBranchFilter });
				}
				return Promise.resolve();
			},
			getOverviewRepositoryState: () => Promise.resolve(this.getSelectedRepository()?.path),
			setOverviewRepository: repoPath => Promise.resolve(this.selectRepository(repoPath)?.path),
			changeOverviewRepository: async () => {
				const repo = await this.onChooseRepository();
				if (repo == null) return;
				this.fireOverviewRepositoryChanged(repo.path);
			},
			onOverviewRepositoryChanged: createCallbackMapSubscription<{ repoPath: string | undefined }>(
				buffer,
				'overviewRepoChanged',
				'save-last',
				this._rpcOverviewRepoChangedCallbacks,
				undefined,
				tracker,
			),
			onOverviewFilterChanged: createCallbackMapSubscription(
				buffer,
				'overviewFilterChanged',
				'save-last',
				this._rpcOverviewFilterChangedCallbacks,
				undefined,
				tracker,
			),

			// --- Walkthrough ---
			getWalkthroughProgress: () => Promise.resolve(this.getWalkthroughProgress()),
			dismissWalkthrough: () => {
				this.dismissWalkthrough();
				return Promise.resolve();
			},
			onWalkthroughProgressChanged: createEventSubscription<WalkthroughProgressState>(
				buffer,
				'walkthroughProgress',
				'save-last',
				buffered =>
					this.container.walkthrough.onDidChangeProgress(() => {
						const progress = this.getWalkthroughProgress();
						if (progress != null) {
							buffered(progress as WalkthroughProgressState);
						}
					}),
				undefined,
				tracker,
			),

			// --- UI Actions ---
			collapseSection: (section, collapsed) => this.onCollapseSection({ section: section, collapsed: collapsed }),
			openInGraph: params => this.showInCommitGraph(params),
			onFocusAccount: createCallbackMapSubscription<undefined>(
				buffer,
				'focusAccount',
				'signal',
				this._rpcFocusAccountCallbacks,
				undefined,
				tracker,
			),

			// --- Agent Sessions ---
			getAgentSessions: () => Promise.resolve(this.getAgentSessionsState()),
			onAgentSessionsChanged: createEventSubscription<AgentSessionState[]>(
				buffer,
				'agentSessions',
				'save-last',
				buffered =>
					this.container.agentStatus != null
						? this.container.agentStatus.onDidChange(() => {
								buffered(this.getAgentSessionsState());
							})
						: { dispose: () => {} },
				undefined,
				tracker,
			),

			// --- Initial Context ---
			getInitialContext: () =>
				Promise.resolve({
					discovering: this._discovering != null,
					repositories: {
						count: this.container.git.repositoryCount,
						openCount: this.container.git.openRepositoryCount,
						hasUnsafe: this.container.git.hasUnsafeRepositories(),
						trusted: workspace.isTrusted,
					},
					walkthroughSupported: this.container.walkthrough.isWalkthroughSupported,
					newInstall:
						!configuration.get('advanced.skipOnboarding') && getContext('gitlens:install:new', false),
					hostAppName: env.appName,
					integrationBannerCollapsed: this.getIntegrationBannerCollapsed(),
					orgSettings: this.getOrgSettings(),
				}),
		};

		return proxyServices({
			...base,
			home: home,
			launchpad: new LaunchpadService(this.container, buffer, tracker),
		} satisfies HomeServices);
	}

	// RPC callback maps for events that don't have a Container-level emitter.
	// These are populated by RPC event subscriptions and fired by the provider methods.
	private readonly _rpcOverviewRepoChangedCallbacks = new Map<
		symbol,
		(data: { repoPath: string | undefined }) => void
	>();
	private readonly _rpcOverviewFilterChangedCallbacks = new Map<
		symbol,
		(data: { filter: OverviewFilters }) => void
	>();
	private readonly _rpcFocusAccountCallbacks = new Map<symbol, (data: undefined) => void>();

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
				queueMicrotask(() => {
					for (const cb of [...this._rpcFocusAccountCallbacks.values()]) {
						cb(undefined);
					}
				});
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
	}

	private onIntegrationsChanged(_e: ConfiguredIntegrationsChangeEvent) {
		void this.onIntegrationsChangedCore();
	}

	private onIntegrationConnectionStateChanged(_e: ConnectionStateChangeEvent) {
		void this.onIntegrationsChangedCore();
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

	private fireOverviewRepositoryChanged(repoPath: string | undefined): void {
		for (const cb of [...this._rpcOverviewRepoChangedCallbacks.values()]) {
			cb({ repoPath: repoPath });
		}
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

	includeBootstrap(_deferrable?: boolean): Promise<State> {
		// Webview fetches all data via RPC — bootstrap only provides metadata
		return Promise.resolve({
			...this.host.baseWebviewState,
		} as State);
	}

	onRefresh(): void {
		this.resetBranchOverview();
	}

	onReloaded(): void {
		this.onRefresh();
	}

	onReady(): void {
		if (this._pendingFocusAccount === true) {
			this._pendingFocusAccount = false;

			for (const cb of [...this._rpcFocusAccountCallbacks.values()]) {
				cb(undefined);
			}
		}
	}

	onVisibilityChanged(visible: boolean): void {
		if (!visible) {
			this._repositorySubscription?.pause();

			return;
		}

		this._repositorySubscription?.resume();
	}

	@command('gitlens.showInCommitGraph:')
	@debug({
		args: params => ({ params: `${params?.type}, repoPath=${params?.repoPath}, branchId=${params?.branchId}` }),
	})
	private showInCommitGraph(params: OpenInGraphParams) {
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
		const worktree = await getBranchWorktree(this.container, branch);
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

		const worktree = branch != null ? await getBranchWorktree(this.container, branch) : undefined;

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
		await showPausedOperationStatus(this.container, pausedOpArgs.repoPath, {
			openRebaseEditor: pausedOpArgs.type === 'rebase',
		});
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

	private getIntegrationBannerCollapsed() {
		return this.container.storage.get('home:sections:collapsed')?.includes('integrationBanner') ?? false;
	}

	private getOrgSettings(): State['orgSettings'] {
		return {
			drafts: getContext('gitlens:gk:organization:drafts:enabled', false),
			ai: getContext('gitlens:gk:organization:ai:enabled', true),
		};
	}

	@trace({ args: false })
	private async onSubscriptionChanged(e: SubscriptionChangeEvent) {
		if (e.etag === this._etagSubscription) return;

		await this.notifyDidChangeSubscription(e.current);

		if (
			isSubscriptionTrialOrPaidFromState(e.current.state) !== isSubscriptionTrialOrPaidFromState(e.previous.state)
		) {
			this.resetBranchOverview();
		}
	}

	private getRepositoriesState(): DidChangeRepositoriesParams {
		return {
			count: this.container.git.repositoryCount,
			openCount: this.container.git.openRepositoryCount,
			hasUnsafe: this.container.git.hasUnsafeRepositories(),
			trusted: workspace.isTrusted,
		};
	}

	// ---- Progressive overview methods (skeleton → WIP → enrichment) ----

	private async getOverviewBranches(
		type?: 'active' | 'inactive',
		signal?: AbortSignal,
	): Promise<GetOverviewBranchesResponse> {
		if (this._discovering != null) {
			await this._discovering;
		}
		signal?.throwIfAborted();

		const repo = this.getSelectedRepository();
		if (repo == null) return undefined;
		signal?.throwIfAborted();

		const [branchesAndWorktreesResult, formatRepositoryResult] = await Promise.allSettled([
			this.getBranchesData(repo, false, signal),
			this.formatRepository(repo, signal),
		]);
		signal?.throwIfAborted();

		const { branches, worktreesByBranch } = getSettledValue(branchesAndWorktreesResult)!;
		const repository = getSettledValue(formatRepositoryResult)!;

		const active: OverviewBranch[] = [];
		const recent: OverviewBranch[] = [];
		let stale: OverviewBranch[] | undefined;

		// Classify and build skeletons — skip unneeded categories when type filter is specified
		const staleBranches: GitBranch[] = [];
		for (const branch of branches) {
			const branchType = this.getBranchOverviewType(branch, worktreesByBranch);
			switch (branchType) {
				case 'active':
					if (type !== 'inactive') {
						active.push(toOverviewBranch(branch, worktreesByBranch, true));
					}
					break;
				case 'recent':
					if (type !== 'active') {
						recent.push(toOverviewBranch(branch, worktreesByBranch, false));
					}
					break;
				case 'stale':
					if (type !== 'active') {
						staleBranches.push(branch);
					}
					break;
			}
		}

		recent.sort((a, b) => (b.timestamp ?? -1) - (a.timestamp ?? -1));

		if (type !== 'active' && this._overviewBranchFilter.stale.show && staleBranches.length > 0) {
			sortBranches(staleBranches, {
				missingUpstream: true,
				orderBy: 'date:asc',
			});

			stale = staleBranches
				.slice(0, this._overviewBranchFilter.stale.limit)
				.map(b => toOverviewBranch(b, worktreesByBranch, false));
		}

		return { repository: repository, active: active, recent: recent, stale: stale };
	}

	private async getOverviewWip(branchIds: string[], signal?: AbortSignal): Promise<GetOverviewWipResponse> {
		if (branchIds.length === 0) return {};

		const repo = this.getSelectedRepository();
		if (repo == null) return {};

		const { branches, worktreesByBranch } = await this.getBranchesData(repo, false, signal);
		signal?.throwIfAborted();

		const result: GetOverviewWipResponse = {};
		const statusPromises = new Map<string, Promise<GitStatus | undefined>>();
		let repoStatusPromise: Promise<GitStatus | undefined> | undefined;

		for (const branchId of branchIds) {
			const branch = branches.find(b => b.id === branchId);
			if (branch == null) continue;

			const wt = worktreesByBranch.get(branchId);
			if (wt != null) {
				statusPromises.set(branchId, GitWorktree.getStatus(wt));
			} else if (branch.current) {
				repoStatusPromise ??= this.container.git.getRepositoryService(branch.repoPath).status.getStatus();
				statusPromises.set(branchId, repoStatusPromise);
			}
		}

		const isActive = (branchId: string) => {
			const branch = branches.find(b => b.id === branchId);
			return branch != null && (branch.current || worktreesByBranch.get(branchId)?.opened === true);
		};

		await Promise.allSettled(
			Array.from(statusPromises.entries(), async ([branchId, statusPromise]) => {
				const branch = branches.find(b => b.id === branchId)!;
				const [statusResult, pausedOpStatusResult] = await Promise.allSettled([
					statusPromise,
					isActive(branchId)
						? this.container.git
								.getRepositoryService(branch.repoPath)
								.pausedOps?.getPausedOperationStatus?.()
						: undefined,
				]);

				const status = getSettledValue(statusResult);
				const pausedOpStatus = getSettledValue(pausedOpStatusResult);

				if (status != null || pausedOpStatus != null) {
					result[branchId] = {
						workingTreeState: status?.diffStatus,
						hasConflicts: status?.hasConflicts,
						conflictsCount: status?.conflicts.length,
						pausedOpStatus: pausedOpStatus,
					};
				}
			}),
		);

		signal?.throwIfAborted();
		return result;
	}

	private async getOverviewEnrichment(
		branchIds: string[],
		signal?: AbortSignal,
	): Promise<GetOverviewEnrichmentResponse> {
		if (branchIds.length === 0) return {};

		const repo = this.getSelectedRepository();
		if (repo == null) return {};

		const [branchesAndWorktreesResult, proSubscriptionResult] = await Promise.allSettled([
			this.getBranchesData(repo, false, signal),
			this.isSubscriptionPro(),
		]);
		signal?.throwIfAborted();

		const { branches } = getSettledValue(branchesAndWorktreesResult)!;
		const isPro = getSettledValue(proSubscriptionResult)!;

		const result: GetOverviewEnrichmentResponse = {};

		// Shared launchpad promise for all branches in this batch
		let launchpadPromise: Promise<LaunchpadCategorizedResult> | undefined;

		// Collect all enrichment promises, keyed by branch ID
		interface BranchEnrichmentPromises {
			remote?: Promise<GitRemote | undefined>;
			pr?: Promise<PullRequestInfo>;
			autolinks?: Promise<Map<string, EnrichedAutolink> | undefined>;
			issues?: Promise<Issue[] | undefined>;
			contributors?: Promise<BranchContributionsOverview | undefined>;
			mergeTarget?: Promise<BranchMergeTargetStatusInfo>;
		}

		const enrichmentPromises = new Map<string, BranchEnrichmentPromises>();

		for (const branchId of branchIds) {
			const branch = branches.find(b => b.id === branchId);
			if (branch == null) continue;

			const promises: BranchEnrichmentPromises = {};

			if (branch.upstream?.missing === false) {
				promises.remote = getBranchRemote(this.container, branch);
			}

			if (isPro) {
				const associatedPR = getBranchAssociatedPullRequest(this.container, branch, { avatarSize: 64 });
				promises.pr = getPullRequestInfo(this.container, branch, launchpadPromise, associatedPR);
				promises.autolinks = getBranchEnrichedAutolinks(this.container, branch);
				promises.issues = getAssociatedIssuesForBranch(this.container, branch).then(issues => issues.value);
				promises.contributors = this.container.git
					.getRepositoryService(branch.repoPath)
					.branches.getBranchContributionsOverview(branch.ref, { associatedPullRequest: associatedPR });
				if (branch.current) {
					promises.mergeTarget = getBranchMergeTargetStatusInfo(this.container, branch);
				}
			}

			enrichmentPromises.set(branchId, promises);
		}

		// Resolve all enrichment in parallel per branch
		await Promise.allSettled(
			Array.from(enrichmentPromises.entries(), async ([branchId, promises]) => {
				const enrichment: OverviewBranchEnrichment = {};

				const [remoteResult, prResult, autolinksResult, issuesResult, contributorsResult, mergeTargetResult] =
					await Promise.allSettled([
						promises.remote,
						promises.pr,
						promises.autolinks?.then(a => getAutolinkIssuesInfo(a)),
						promises.issues?.then(
							issues =>
								issues?.map(i => ({
									id: i.number || i.id,
									title: i.title,
									state: i.state,
									url: i.url,
								})) ?? [],
						),
						getContributorsInfo(this.container, promises.contributors),
						promises.mergeTarget,
					]);

				const remote = getSettledValue(remoteResult);
				if (remote != null) {
					enrichment.remote = {
						name: remote.name,
						provider: remote.provider
							? {
									name: remote.provider.name,
									icon: remote.provider.icon === 'remote' ? 'cloud' : remote.provider.icon,
									url: await remote.provider.url({ type: RemoteResourceType.Repo }),
									supportedFeatures: remote.provider.supportedFeatures,
								}
							: undefined,
					};
				}

				enrichment.pr = getSettledValue(prResult);
				enrichment.autolinks = getSettledValue(autolinksResult);
				enrichment.issues = getSettledValue(issuesResult);
				enrichment.contributors = getSettledValue(contributorsResult);
				enrichment.mergeTarget = getSettledValue(mergeTargetResult);

				result[branchId] = enrichment;
			}),
		);

		signal?.throwIfAborted();
		return result;
	}

	private async formatRepository(repo: GlRepository, signal?: AbortSignal): Promise<OverviewRepository> {
		const remotes = await repo.git.remotes.getBestRemotesWithProviders();
		signal?.throwIfAborted();
		const remote = remotes.find(r => remoteSupportsIntegration(r)) ?? remotes[0];
		return toRepositoryShapeWithProvider(repo, remote);
	}

	private _repositorySubscription: SubscriptionManager<GlRepository> | undefined;
	private selectRepository(repoPath?: string) {
		const currentRepo = this._repositorySubscription?.source;
		const repo =
			(repoPath != null ? this.container.git.getRepository(repoPath) : undefined) ??
			this.container.git.getBestRepositoryOrFirst();

		if (repo === currentRepo) {
			return repo;
		}

		this._repositorySubscription?.dispose();
		this._repositorySubscription = undefined;

		if (repo != null) {
			this._repositorySubscription = new SubscriptionManager(repo, () => Disposable.from());
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

	private getSelectedRepository() {
		if (this._repositorySubscription == null) {
			this.selectRepository();
		}

		return this._repositorySubscription?.source;
	}

	private readonly _repositoryBranches: Map<string, RepositoryBranchData> = new Map();
	private async getBranchesData(repo: GlRepository, force = false, signal?: AbortSignal) {
		if (force || !this._repositoryBranches.has(repo.path) || repo.etag !== this._etagRepository) {
			signal?.throwIfAborted();
			const worktrees = (await repo.git.worktrees?.getWorktrees()) ?? [];
			signal?.throwIfAborted();
			const worktreesByBranch = groupWorktreesByBranch(worktrees, { includeDefault: true });
			const [branchesResult] = await Promise.allSettled([
				repo.git.branches.getBranches({
					filter: b => !b.remote,
					sort: { current: true, openedWorktreesByBranch: getOpenedWorktreesByBranch(worktreesByBranch) },
				}),
			]);
			signal?.throwIfAborted();

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
			const integrations: IntegrationState[] = [
				...filterMap(await this.container.integrations.getConfigured(), i => {
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
				}),
			];

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

	private getAgentSessionsState(): AgentSessionState[] {
		const service = this.container.agentStatus;
		if (service == null) return [];

		return service.sessions.map(s => ({
			id: s.id,
			name: s.name,
			status: s.status,
			statusDetail: s.statusDetail,
			branch: s.branch,
			worktreeName: s.worktreeName,
			isLocal: s.isLocal,
			hasPermissionRequest: s.pendingPermission != null,
			subagentCount: s.subagents?.length ?? 0,
			workspacePath: s.workspacePath,
		}));
	}

	private async onIntegrationsChangedCore() {
		const integrations = await this.getIntegrationStates(true);
		if (integrations.some(i => i.connected)) {
			this.onCollapseSection({ section: 'integrationBanner', collapsed: true });
		}
	}

	private async notifyDidChangeSubscription(subscription?: Subscription) {
		const subResult = await this.getSubscriptionState(subscription);

		void this.host.notify(DidChangeSubscription, {
			subscription: subResult.subscription,
			avatar: subResult.avatar,
			organizationsCount: subResult.organizationsCount,
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

		const worktree =
			branch.worktree === false
				? undefined
				: (branch.worktree ?? (await getBranchWorktree(this.container, branch)));

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
			const commonRepo = await repo.git.getOrOpenCommonRepository();
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

		const remote = await getBranchRemote(this.container, branch);

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
		const worktree = branch != null ? await getBranchWorktree(this.container, branch) : undefined;
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

		const timestamp = branch.effectiveDate?.getTime();
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
		return branch != null ? getBranchAssociatedPullRequest(this.container, branch) : undefined;
	}

	private async getRepoInfoFromRef(
		ref: BranchRef | { repoPath: string; branchName?: string },
	): Promise<{ repo: GlRepository; branch: GitBranch | undefined } | { repo: undefined; branch: undefined }> {
		const repo = this.container.git.getRepository(ref.repoPath);
		if (repo == null) return { repo: undefined, branch: undefined };
		if (!ref.branchName) return { repo: repo, branch: undefined };

		const branch = await repo.git.branches.getBranch(ref.branchName);
		return { repo: repo, branch: branch };
	}
}

function toOverviewBranch(
	branch: GitBranch,
	worktreesByBranch: Map<string, GitWorktree>,
	opened: boolean,
): OverviewBranch {
	const wt = worktreesByBranch.get(branch.id);
	return {
		reference: getReferenceFromBranch(branch),
		repoPath: branch.repoPath,
		id: branch.id,
		name: branch.name,
		opened: opened,
		timestamp: branch.effectiveDate?.getTime(),
		status: branch.status,
		upstream: branch.upstream,
		worktree: wt ? { name: wt.name, uri: wt.uri.toString(), isDefault: wt.isDefault } : undefined,
	};
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
					avatarUrl: (await getContributorAvatarUri(c))?.toString(),
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
		associatedPullRequest: getBranchAssociatedPullRequest(container, branch),
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
	if (!result.items) return undefined;

	let lpi = result.items.find(i => i.url === pr.url);
	if (lpi == null) {
		// result = await container.launchpad.getCategorizedItems({ search: pr.url });
		result = await container.launchpad.getCategorizedItems({ search: [pr] });
		if (!result.items) return undefined;

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
	associatedPullRequest?: Promise<PullRequest | undefined>,
): Promise<PullRequestInfo> {
	const pr = await (associatedPullRequest ?? getBranchAssociatedPullRequest(container, branch, { avatarSize: 64 }));
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
