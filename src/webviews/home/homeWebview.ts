import type { ConfigurationChangeEvent } from 'vscode';
import { Disposable, workspace } from 'vscode';
import { getAvatarUriFromGravatarEmail } from '../../avatars';
import type { ContextKeys } from '../../constants.context';
import type { WebviewTelemetryContext } from '../../constants.telemetry';
import type { Container } from '../../container';
import type { BranchContributorOverview } from '../../git/gitProvider';
import type { GitBranch } from '../../git/models/branch';
import { sortBranches } from '../../git/models/branch';
import type { PullRequest } from '../../git/models/pullRequest';
import type { Repository } from '../../git/models/repository';
import { RepositoryChange, RepositoryChangeComparisonMode } from '../../git/models/repository';
import type { GitStatus } from '../../git/models/status';
import type { GitWorktree } from '../../git/models/worktree';
import { getOpenedWorktreesByBranch, groupWorktreesByBranch } from '../../git/models/worktree';
import type { Subscription } from '../../plus/gk/account/subscription';
import type { SubscriptionChangeEvent } from '../../plus/gk/account/subscriptionService';
import { getLaunchpadSummary } from '../../plus/launchpad/utils';
import { map } from '../../system/iterable';
import { getSettledValue } from '../../system/promise';
import { registerCommand } from '../../system/vscode/command';
import { configuration } from '../../system/vscode/configuration';
import { getContext, onDidChangeContext } from '../../system/vscode/context';
import type { IpcMessage } from '../protocol';
import type { WebviewHost, WebviewProvider, WebviewShowingArgs } from '../webviewProvider';
import type { WebviewShowOptions } from '../webviewsController';
import type {
	CollapseSectionParams,
	DidChangeRepositoriesParams,
	GetOverviewBranch,
	GetOverviewBranches,
	GetOverviewResponse,
	State,
} from './protocol';
import {
	CollapseSectionCommand,
	DidChangeIntegrationsConnections,
	DidChangeOrgSettings,
	DidChangePreviewEnabled,
	DidChangeRepositories,
	DidChangeRepositoryWip,
	DidChangeSubscription,
	DidChangeWalkthroughProgress,
	DidFocusAccount,
	DismissWalkthroughSection,
	GetLaunchpadSummary,
	GetOverview,
} from './protocol';
import type { HomeWebviewShowingArgs } from './registration';

const emptyDisposable = Object.freeze({
	dispose: () => {
		/* noop */
	},
});

type RepositorySubscription = { repo: Repository; subscription: Disposable };

export class HomeWebviewProvider implements WebviewProvider<State, State, HomeWebviewShowingArgs> {
	private readonly _disposable: Disposable;
	private _pendingFocusAccount = false;

	constructor(
		private readonly container: Container,
		private readonly host: WebviewHost,
	) {
		this._disposable = Disposable.from(
			this.container.git.onDidChangeRepositories(this.onRepositoriesChanged, this),
			!workspace.isTrusted
				? workspace.onDidGrantWorkspaceTrust(this.notifyDidChangeRepositories, this)
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

	getTelemetryContext(): WebviewTelemetryContext {
		return {
			...this.host.getTelemetryContext(),
		};
	}

	onShowing(
		loading: boolean,
		_options?: WebviewShowOptions,
		...args: WebviewShowingArgs<HomeWebviewShowingArgs, State>
	): [boolean, Record<`context.${string}`, string | number | boolean> | undefined] {
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

	private onChangeConnectionState() {
		this.notifyDidChangeOnboardingIntegration();
	}

	private onRepositoriesChanged() {
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

	registerCommands(): Disposable[] {
		return [
			registerCommand(`${this.host.id}.refresh`, () => this.host.refresh(true), this),
			registerCommand(
				`${this.host.id}.account.resync`,
				() => this.container.subscription.validate({ force: true }),
				this,
			),
		];
	}

	async onMessageReceived(e: IpcMessage) {
		switch (true) {
			case CollapseSectionCommand.is(e):
				this.onCollapseSection(e.params);
				break;
			case DismissWalkthroughSection.is(e):
				this.dismissWalkthrough();
				break;
			case GetLaunchpadSummary.is(e):
				void this.host.respond(GetLaunchpadSummary, e, await getLaunchpadSummary(this.container));
				break;
			case GetOverview.is(e):
				void this.host.respond(GetOverview, e, await this.getBranchOverview());
				break;
		}
	}

	includeBootstrap(): Promise<State> {
		return this.getState();
	}

	onReloaded() {
		this.notifyDidChangeRepositories();
		this.notifyDidChangeProgress();
	}

	onReady() {
		if (this._pendingFocusAccount === true) {
			this._pendingFocusAccount = false;

			void this.host.notify(DidFocusAccount, undefined);
		}
	}

	private onCollapseSection(params: CollapseSectionParams) {
		void this.container.storage.delete('home:walkthrough:dismissed');

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
		console.log({ test: this.container.storage.get('home:walkthrough:dismissed') });
		return Boolean(this.container.storage.get('home:walkthrough:dismissed'));
	}

	private getWalkthroughCollapsed() {
		return this.container.storage.get('home:sections:collapsed')?.includes('walkthrough') ?? false;
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
			repositories: this.getRepositoriesState(),
			webroot: this.host.getWebRoot(),
			subscription: subResult.subscription,
			avatar: subResult.avatar,
			organizationsCount: subResult.organizationsCount,
			orgSettings: this.getOrgSettings(),
			walkthroughCollapsed: this.getWalkthroughCollapsed(),
			integrationBannerCollapsed: this.getIntegrationBannerCollapsed(),
			hasAnyIntegrationConnected: this.isAnyIntegrationConnected(),
			walkthroughProgress: {
				allCount: this.container.walkthrough.walkthroughSize,
				doneCount: this.container.walkthrough.doneCount,
				progress: this.container.walkthrough.progress,
			},
			showWalkthroughProgress: !this.getWalkthroughDismissed(),
			previewEnabled: this.getPreviewEnabled(),
		};
	}

	private getPreviewEnabled() {
		return configuration.get('home.preview.enabled') ?? false;
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
		const repo = this.getSelectedRepository();
		if (repo == null) return undefined;

		const branchesAndWorktrees = await this.getBranchesAndWorktrees(repo);
		const overviewBranches = await getOverviewBranches(
			branchesAndWorktrees?.branches,
			branchesAndWorktrees?.worktrees,
			this.container,
			// TODO: add filters
		);
		if (overviewBranches == null) return undefined;

		const result: GetOverviewResponse = {
			repository: {
				name: repo.name,
				branches: overviewBranches,
			},
		};

		return result;
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
			this._repositorySubscription.subscription.dispose();
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

	private subscribeToRepository(repo: Repository): Disposable {
		return Disposable.from(
			repo.watchFileSystem(1000),
			repo.onDidChangeFileSystem(() => this.onWipChanged(repo)),
			repo.onDidChange(e => {
				if (e.changed(RepositoryChange.Index, RepositoryChangeComparisonMode.Any)) {
					this.onWipChanged(repo);
				}
			}),
		);
	}

	private onWipChanged(_repo: Repository) {
		void this.host.notify(DidChangeRepositoryWip, undefined);
	}

	private getSelectedRepository() {
		if (this._repositorySubscription == null) {
			this.selectRepository();
		}

		return this._repositorySubscription?.repo;
	}

	private _repositoryBranches: Map<string, { branches: GitBranch[]; worktrees: GitWorktree[] }> = new Map();
	private async getBranchesAndWorktrees(repo: Repository, force = false) {
		if (force || !this._repositoryBranches.has(repo.path)) {
			const [branchesResult, worktreesResult] = await Promise.allSettled([
				repo.git.getBranches({ filter: b => !b.remote }),
				repo.git.getWorktrees(),
			]);

			const branches = getSettledValue(branchesResult)?.values ?? [];
			const worktrees = getSettledValue(worktreesResult) ?? [];
			this._repositoryBranches.set(repo.path, { branches: branches, worktrees: worktrees });
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

	private notifyDidChangeRepositories() {
		void this.host.notify(DidChangeRepositories, this.getRepositoriesState());
	}

	private notifyDidChangeProgress() {
		void this.host.notify(DidChangeWalkthroughProgress, {
			allCount: this.container.walkthrough.walkthroughSize,
			doneCount: this.container.walkthrough.doneCount,
			progress: this.container.walkthrough.progress,
		});
	}

	private notifyDidChangeConfig() {
		void this.host.notify(DidChangePreviewEnabled, this.getPreviewEnabled());
	}

	private notifyDidChangeOnboardingIntegration() {
		// force rechecking
		const isConnected = this.isAnyIntegrationConnected(true);
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
}

const branchOverviewDefaults = Object.freeze({
	recent: { threshold: 1000 * 60 * 60 * 24 * 14 },
	stale: { threshold: 1000 * 60 * 60 * 24 * 365 },
});

interface BranchOverviewOptions {
	recent?: {
		threshold: number;
	};
	stale?: {
		show?: boolean;
		threshold?: number;
	};
}

async function getOverviewBranches(
	branches: GitBranch[],
	worktrees: GitWorktree[],
	container: Container,
	options?: BranchOverviewOptions,
): Promise<GetOverviewBranches | undefined> {
	if (branches.length === 0) return undefined;

	const worktreesByBranch = groupWorktreesByBranch(worktrees);

	sortBranches(branches, {
		current: true,
		orderBy: 'date:desc',
		openedWorktreesByBranch: getOpenedWorktreesByBranch(worktreesByBranch),
	});

	const overviewBranches: GetOverviewBranches = {
		active: [],
		recent: [],
		stale: [],
	};

	const prPromises = new Map<string, Promise<PullRequest | undefined>>();
	const statusPromises = new Map<string, Promise<GitStatus | undefined>>();
	const contributorPromises = new Map<string, Promise<BranchContributorOverview | undefined>>();

	const now = Date.now();
	const recentThreshold = now - (options?.recent?.threshold ?? branchOverviewDefaults.recent.threshold);

	for (const branch of branches) {
		const wt = worktreesByBranch.get(branch.id);
		const worktree: GetOverviewBranch['worktree'] = wt ? { name: wt.name, uri: wt.uri.toString() } : undefined;

		const timestamp = branch.date?.getTime();
		if (branch.current || wt?.opened) {
			prPromises.set(branch.id, branch.getAssociatedPullRequest());
			if (wt != null) {
				statusPromises.set(branch.id, wt.getStatus());
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

	if (options?.stale?.show === true) {
		const staleThreshold = now - (options?.stale?.threshold ?? branchOverviewDefaults.stale.threshold);
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
			.map(r => [
				r.value[0],
				r.value[1]
					? {
							id: r.value[1].id,
							title: r.value[1].title,
							state: r.value[1].state,
							url: r.value[1].url,
					  }
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
			const owner = contributor.owner ?? contributor.contributors?.shift();
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
			const contributors = contributor?.contributors
				? await Promise.all(
						contributor.contributors.map(async c => ({
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

	return overviewBranches;
}
