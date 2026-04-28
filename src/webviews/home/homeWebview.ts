import { Disposable, env, Uri, window, workspace } from 'vscode';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import type { GitPausedOperationStatus } from '@gitlens/git/models/pausedOperationStatus.js';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { GitWorktree } from '@gitlens/git/models/worktree.js';
import { getComparisonRefsForPullRequest } from '@gitlens/git/utils/pullRequest.utils.js';
import { sortBranches } from '@gitlens/git/utils/sorting.js';
import { debug, trace } from '@gitlens/utils/decorators/log.js';
import { filterMap } from '@gitlens/utils/iterable.js';
import { hasKeys } from '@gitlens/utils/object.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import { SubscriptionManager } from '@gitlens/utils/subscriptionManager.js';
import { ActionRunnerType } from '../../api/actionRunners.js';
import type { CreatePullRequestActionContext } from '../../api/gitlens.d.js';
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
import {
	getBranchAssociatedPullRequest,
	getBranchRemote,
	getBranchWorktree,
} from '../../git/utils/-webview/branch.utils.js';
import { getReferenceFromBranch } from '../../git/utils/-webview/reference.utils.js';
import { remoteSupportsIntegration } from '../../git/utils/-webview/remote.utils.js';
import { toRepositoryShapeWithProvider } from '../../git/utils/-webview/repository.utils.js';
import { getOpenedWorktreesByBranch, groupWorktreesByBranch } from '../../git/utils/-webview/worktree.utils.js';
import { showPatchesView } from '../../plus/drafts/actions.js';
import type { Subscription } from '../../plus/gk/models/subscription.js';
import type { SubscriptionChangeEvent } from '../../plus/gk/subscriptionService.js';
import { isSubscriptionTrialOrPaidFromState } from '../../plus/gk/utils/subscription.utils.js';
import type { ConfiguredIntegrationsChangeEvent } from '../../plus/integrations/authentication/configuredIntegrationService.js';
import type { ConnectionStateChangeEvent } from '../../plus/integrations/integrationService.js';
import { providersMetadata } from '../../plus/integrations/providers/models.js';
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
import type { ComposerCommandArgs } from '../plus/composer/registration.js';
import type { ShowInCommitGraphCommandArgs } from '../plus/graph/registration.js';
import type { Change } from '../plus/patchDetails/protocol.js';
import * as branchRefCommands from '../plus/shared/branchRefCommands.js';
import type { TimelineCommandArgs } from '../plus/timeline/registration.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from '../rpc/eventVisibilityBuffer.js';
import { createRpcEvent, createRpcEventSubscription } from '../rpc/eventVisibilityBuffer.js';
import { LaunchpadService } from '../rpc/launchpadService.js';
import { createSharedServices, proxyServices } from '../rpc/services/common.js';
import { getBranchOverviewType, toOverviewBranch } from '../shared/overviewBranches.js';
import { getOverviewEnrichment, getOverviewWip } from '../shared/overviewEnrichment.utils.js';
import type { WebviewHost, WebviewProvider, WebviewShowingArgs } from '../webviewProvider.js';
import type { WebviewShowOptions } from '../webviewsController.js';
import type { HomeServices, HomeViewService, WalkthroughProgressState } from './homeService.js';
import type {
	AgentSessionState,
	BranchAndTargetRefs,
	BranchRef,
	CreatePullRequestCommandArgs,
	DidChangeRepositoriesParams,
	GetOverviewBranchesResponse,
	GetOverviewEnrichmentResponse,
	GetOverviewWipResponse,
	IntegrationState,
	OpenInGraphParams,
	OpenInTimelineParams,
	OpenWorktreeCommandArgs,
	OverviewBranch,
	OverviewFilters,
	OverviewRepository,
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
			...(this.container.agentStatus != null
				? [this.container.agentStatus.onDidChange(() => this.updateAgentBadge())]
				: []),
		);

		this.updateAgentBadge();
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
				this._overviewFilterChangedEvent.fire({ filter: this._overviewBranchFilter });
				return Promise.resolve();
			},
			getOverviewRepositoryState: () => Promise.resolve(this.getSelectedRepository()?.path),
			setOverviewRepository: repoPath => Promise.resolve(this.selectRepository(repoPath)?.path),
			changeOverviewRepository: async () => {
				const repo = await this.onChooseRepository();
				if (repo == null) return;
				this.fireOverviewRepositoryChanged(repo.path);
			},
			onOverviewRepositoryChanged: this._overviewRepoChangedEvent.subscribe(buffer, tracker),
			onOverviewFilterChanged: this._overviewFilterChangedEvent.subscribe(buffer, tracker),

			// --- Walkthrough ---
			getWalkthroughProgress: () => Promise.resolve(this.getWalkthroughProgress()),
			dismissWalkthrough: () => {
				this.dismissWalkthrough();
				return Promise.resolve();
			},
			onWalkthroughProgressChanged: createRpcEventSubscription<WalkthroughProgressState>(
				buffer,
				'walkthroughProgress',
				'save-last',
				buffered =>
					this.container.walkthrough.onDidChangeProgress(() => {
						const progress = this.getWalkthroughProgress();
						if (progress != null) {
							buffered(progress);
						}
					}),
				undefined,
				tracker,
			),

			// --- UI Actions ---
			openInGraph: params => this.showInCommitGraph(params),
			onFocusAccount: this._focusAccountEvent.subscribe(buffer, tracker),

			// --- Agent Sessions ---
			getAgentSessions: () => Promise.resolve(this.getAgentSessionsState()),
			onAgentSessionsChanged: createRpcEventSubscription<AgentSessionState[]>(
				buffer,
				'agentSessions',
				'save-last',
				buffered => {
					if (this.container.agentStatus == null) return { dispose: () => {} };

					let lastSerialized = '';
					return this.container.agentStatus.onDidChange(() => {
						const state = this.getAgentSessionsState();
						const serialized = JSON.stringify(state);
						if (serialized === lastSerialized) return;
						lastSerialized = serialized;
						buffered(state);
					});
				},
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
					orgSettings: this.getOrgSettings(),
				}),
		};

		return proxyServices({
			...base,
			home: home,
			launchpad: new LaunchpadService(this.container, buffer, tracker),
		} satisfies HomeServices);
	}

	private readonly _overviewRepoChangedEvent = createRpcEvent<{ repoPath: string | undefined }>(
		'overviewRepoChanged',
		'save-last',
	);
	private readonly _overviewFilterChangedEvent = createRpcEvent<{ filter: OverviewFilters }>(
		'overviewFilterChanged',
		'save-last',
	);
	private readonly _focusAccountEvent = createRpcEvent<undefined>('focusAccount', 'signal');

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
					this._focusAccountEvent.fire(undefined);
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
		this._overviewRepoChangedEvent.fire({ repoPath: repoPath });
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

			this._focusAccountEvent.fire(undefined);
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
		if (worktree != null) {
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
		branchRefCommands.changeBranchMergeTarget(ref);
	}

	@command('gitlens.mergeIntoCurrent:')
	@debug({ args: ref => ({ ref: ref.branchId }) })
	private mergeIntoCurrent(ref: BranchRef) {
		return branchRefCommands.mergeIntoCurrent(this.container, ref);
	}

	@command('gitlens.rebaseCurrentOnto:')
	@debug({ args: ref => ({ ref: ref.branchId }) })
	private rebaseCurrentOnto(ref: BranchRef) {
		return branchRefCommands.rebaseCurrentOnto(this.container, ref);
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

	@debug()
	private dismissWalkthrough() {
		if (!this.container.onboarding.isDismissed('home:walkthrough')) {
			void this.container.onboarding.dismiss('home:walkthrough').catch();
			void this.container.usage.track('home:walkthrough:dismissed').catch();
		}
	}

	private getWalkthroughDismissed() {
		return this.container.onboarding.isDismissed('home:walkthrough');
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
		type?: 'active' | 'inactive' | 'agents',
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

		// Agent branches: return only branches that have an active agent session
		if (type === 'agents') {
			const sessions = this.container.agentStatus?.sessions ?? [];
			const repoPath = repo.path;
			const agentBranchNames = new Set<string>();
			for (const session of sessions) {
				if (session.branch != null && session.workspacePath === repoPath) {
					agentBranchNames.add(session.branch);
				}
			}

			const agentBranches: OverviewBranch[] = [];
			for (const branch of branches) {
				if (agentBranchNames.has(branch.name)) {
					agentBranches.push(toOverviewBranch(branch, worktreesByBranch, false));
				}
			}

			return { repository: repository, active: [], recent: agentBranches, stale: undefined };
		}

		const active: OverviewBranch[] = [];
		const recent: OverviewBranch[] = [];
		let stale: OverviewBranch[] | undefined;

		// Classify and build skeletons — skip unneeded categories when type filter is specified
		const staleBranches: GitBranch[] = [];
		for (const branch of branches) {
			const branchType = getBranchOverviewType(
				branch,
				worktreesByBranch,
				this._overviewBranchFilter.recent.threshold,
				this._overviewBranchFilter.stale.threshold,
			);
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

		return getOverviewWip(this.container, branches, worktreesByBranch, branchIds, { signal: signal });
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

		return getOverviewEnrichment(this.container, branches, branchIds, {
			isPro: isPro,
			signal: signal,
		});
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
		} else {
			this._subscription ??= await this.container.subscription.getSubscription(true);
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
			state: state,
		};
	}

	private getAgentSessionsState(): AgentSessionState[] {
		const service = this.container.agentStatus;
		if (service == null) return [];

		return service.sessions.map(s => ({
			id: s.id,
			name: s.name,
			status: s.status,
			phase: s.phase,
			statusDetail: s.statusDetail,
			branch: s.branch,
			worktreeName: s.worktreeName,
			isInWorkspace: s.isInWorkspace,
			hasPermissionRequest: s.pendingPermission != null,
			subagentCount: s.subagents?.length ?? 0,
			workspacePath: s.workspacePath,
			cwd: s.cwd,
			lastActivityTimestamp: s.lastActivity.getTime(),
			phaseSinceTimestamp: s.phaseSince.getTime(),
			pendingPermissionDetail:
				s.pendingPermission != null
					? {
							toolName: s.pendingPermission.toolName,
							toolDescription: s.pendingPermission.toolDescription,
							toolInputDescription: s.pendingPermission.toolInputDescription,
							hasSuggestions:
								s.pendingPermission.suggestions != null && s.pendingPermission.suggestions.length > 0,
						}
					: undefined,
			lastPrompt: s.lastPrompt,
		}));
	}

	private _lastBadgeWaiting = -1;

	private updateAgentBadge(): void {
		const service = this.container.agentStatus;
		if (service == null) {
			if (this._lastBadgeWaiting !== 0) {
				this._lastBadgeWaiting = 0;
				this.host.badge = undefined;
			}
			return;
		}

		const waiting = service.sessions.filter(
			s => !s.isSubagent && (s.status === 'waiting' || s.status === 'permission_requested'),
		).length;

		if (waiting === this._lastBadgeWaiting) return;
		this._lastBadgeWaiting = waiting;
		this.host.badge = waiting > 0 ? { tooltip: `${waiting} agent(s) need attention`, value: waiting } : undefined;
	}

	private async onIntegrationsChangedCore() {
		const integrations = await this.getIntegrationStates(true);
		if (integrations.some(i => i.connected)) {
			void this.container.onboarding.dismiss('home:integrationBanner').catch();
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
	private deleteBranchOrWorktree(ref: BranchRef, mergeTarget?: BranchRef) {
		return branchRefCommands.deleteBranchOrWorktree(this.container, ref, mergeTarget);
	}

	@command('gitlens.pushBranch:')
	@debug({
		args: ref => ({ ref: `${ref.branchId}, upstream: ${ref.branchUpstreamName}` }),
	})
	private pushBranch(ref: BranchRef) {
		return branchRefCommands.pushBranch(this.container, ref);
	}

	@command('gitlens.openMergeTargetComparison:')
	@debug({
		args: ref => ({
			ref: `${ref.branchId}, upstream: ${ref.branchUpstreamName}, mergeTargetId: ${ref.mergeTargetId}`,
		}),
	})
	private mergeTargetCompare(ref: BranchAndTargetRefs) {
		return branchRefCommands.openMergeTargetComparison(this.container, ref);
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
