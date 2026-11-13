import type { MergeTargetsChangeEvent } from '@gitlens/git/cache.js';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import type { Deferrable } from '@gitlens/utils/debounce.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { Container } from '../../../container.js';
import type { GlRepository, RepositoryChangeEvent } from '../../../git/models/repository.js';
import { getBranchAssociatedPullRequest } from '../../../git/utils/-webview/branch.utils.js';
import type { OverviewBranchMergeTarget } from '../../shared/overviewBranches.js';
import { getBranchMergeTargetStatusInfo } from '../../shared/overviewEnrichment.utils.js';
import type { WebviewHost } from '../../webviewProvider.js';
import type {
	GraphCurrentBranchMergeTarget,
	GraphCurrentBranchMergeTargetState,
	GraphMergeTargetsEpoch,
} from './protocol.js';

/** Collaborators the merge-target service reaches for on the host provider, assembled by
 *  `GraphWebviewProvider.createGraphMergeTargetContext()`. Both events route through the provider's RPC events. */
export type GraphMergeTargetServiceContext = {
	container: Container;
	host: WebviewHost<'gitlens.views.graph' | 'gitlens.graph'>;
	fireCurrentBranchMergeTargetChanged: (state: GraphCurrentBranchMergeTargetState) => void;
	fireMergeTargetsChanged: (epoch: GraphMergeTargetsEpoch) => void;
};

export type GraphMergeTargetIdentity = Pick<
	GraphCurrentBranchMergeTarget,
	'repoPath' | 'branch' | 'tipSha' | 'generation'
>;

/** What decides a verdict besides its identity — when none of these moved, a recompute would answer the same */
interface VerdictInputs {
	/** The upstream's name, and whether it's gone. Either can move the merge target. */
	readonly upstream: string | undefined;
	readonly targetRef: string | undefined;
	readonly targetTipSha: string | undefined;
	/** The tip of the local branch tracking a remote target, which the merged check measures against too */
	readonly localTargetTipSha: string | undefined;
}

interface VerdictComputation {
	readonly identity: GraphMergeTargetIdentity;
	readonly promise: Promise<OverviewBranchMergeTarget | undefined>;
}

/** Long enough for the status' own 5s pull request deadline, so pending clears by the verdict whenever it can */
const pendingTimeout = 10_000;

function isSameIdentity(a: GraphMergeTargetIdentity, b: GraphMergeTargetIdentity): boolean {
	return a.repoPath === b.repoPath && a.branch === b.branch && a.tipSha === b.tipSha && a.generation === b.generation;
}

function areInputsEqual(a: VerdictInputs | undefined, b: VerdictInputs): boolean {
	return (
		a != null &&
		a.upstream === b.upstream &&
		a.targetRef === b.targetRef &&
		a.targetTipSha === b.targetTipSha &&
		a.localTargetTipSha === b.localTargetTipSha
	);
}

/**
 * Whether `previous` stays shown while the verdict recomputes for `next`: only when the repository, branch, tip and
 * generation are the same, and so is the upstream (which can move the merge target) — that is, only the target's
 * tip or the pull request evidence moved. A pending verdict is no verdict, so there's nothing to keep.
 */
export function canKeepVerdictWhileRecomputing(
	previous: GraphCurrentBranchMergeTarget | undefined,
	previousUpstream: string | undefined,
	next: GraphMergeTargetIdentity,
	nextUpstream: string | undefined,
): boolean {
	return previous != null && !previous.pending && isSameIdentity(previous, next) && previousUpstream === nextUpstream;
}

/**
 * The merge-target verdict for the Graph's bound repository's current branch, computed once on the host for the
 * header and for the WIP details of that branch, so they can't disagree. Also forwards the repository's merge-target
 * changes to the webview as an epoch.
 *
 * Landed-only: merged status, counts, reflog and pull request evidence, never the potential conflicts (consumers that
 * show those ask for them on demand). Recomputed, debounced, when the current tip, the target's tip (or its local
 * counterpart's), the upstream or the merge target itself changes, on a branch switch or rebind, and once the pull
 * request evidence settles; a newer computation cancels an older one. Does nothing while the Graph is hidden.
 *
 * Those triggers compute eagerly only for a branch with no upstream or a gone one, the only case the header reads the
 * verdict for (whether to offer Publish). The merged check can take seconds on a large repo, so for a branch with a
 * live upstream a trigger only marks the verdict stale (dropping it if the identity moved), and it's computed when
 * {@link getStatus} asks for it.
 */
export class GraphMergeTargetService {
	private _repository: GlRepository | undefined;
	private _branchName: string | undefined;
	private _epoch: GraphMergeTargetsEpoch | undefined;
	private _generation = 0;
	private _revision = 0;
	private _verdict: GraphCurrentBranchMergeTarget | undefined;
	/** The inputs the latest computation answers for */
	private _inputs: VerdictInputs | undefined;
	private _computation: VerdictComputation | undefined;
	private _computeController: AbortController | undefined;
	private _readController: AbortController | undefined;
	private _pendingTimer: ReturnType<typeof setTimeout> | undefined;
	/** A trigger arrived that no refresh has read since */
	private _stale = false;
	/** A refresh was skipped while the Graph was hidden or not ready */
	private _deferred = false;
	/** The pull request settled after the latest computation answered without it */
	private _evidenceSettled = false;
	private readonly _refreshDebounced: Deferrable<() => void>;

	constructor(private readonly context: GraphMergeTargetServiceContext) {
		this._refreshDebounced = debounce(() => void this.refresh(), 100);
	}

	private get container(): Container {
		return this.context.container;
	}

	get state(): GraphCurrentBranchMergeTargetState {
		return { revision: this._revision, verdict: this._verdict };
	}

	get epoch(): GraphMergeTargetsEpoch | undefined {
		return this._epoch;
	}

	dispose(): void {
		this._refreshDebounced.cancel();
		this._readController?.abort();
		this._computeController?.abort();
		clearTimeout(this._pendingTimer);
	}

	/** Binds to the Graph's repository; any other binding starts over */
	setRepository(repository: GlRepository | undefined): void {
		if (repository === this._repository) return;

		this._repository = repository;
		this._branchName = undefined;
		this._refreshDebounced.cancel();
		this._readController?.abort();
		this.cancelComputation();
		if (this._verdict != null) {
			this.publish(undefined);
		}
		this.schedule(true);
	}

	onMergeTargetsChanged(e: MergeTargetsChangeEvent): void {
		const repo = this._repository;
		// Events carry the common path, so a worktree matches its whole family
		if (repo == null || e.repoPath !== (repo.commonPath ?? repo.path)) return;

		this._epoch = {
			repoPath: repo.path,
			epoch: (this._epoch?.epoch ?? 0) + 1,
			refs: e.refs != null ? [...e.refs] : undefined,
		};
		this.context.fireMergeTargetsChanged(this._epoch);

		// Until the current branch is known, any change may be its
		if (e.refs != null && this._branchName != null && !e.refs.has(this._branchName)) return;

		this._generation++;
		this._stale = true;
		this.schedule(true);
	}

	onRepositoryChanged(e: RepositoryChangeEvent): void {
		// The current tip or branch (`head`, `heads`), the target's tip or its local counterpart's (`heads`,
		// `remotes`), and the upstream, including a prune marking it gone (`remotes`, `config`)
		if (!e.changed('head', 'heads', 'remotes', 'config')) return;

		this._stale = true;
		this.schedule(false);
	}

	onVisible(): void {
		if (!this._deferred) return;

		this.schedule(true);
	}

	/**
	 * The landed-only merge-target status for `branch` when it's the one this verdict covers (the bound repository's
	 * current branch) — from the same computation the header reads, in flight or settled. `undefined` for any other
	 * branch, which the caller computes itself.
	 */
	getStatus(branch: GitBranch): Promise<OverviewBranchMergeTarget | undefined> | undefined {
		const repo = this._repository;
		if (repo == null || branch.repoPath !== repo.path || !branch.current || branch.detached || !branch.sha) {
			return undefined;
		}

		return this.getStatusCore(branch);
	}

	private async getStatusCore(branch: GitBranch): Promise<OverviewBranchMergeTarget | undefined> {
		// A computation that a newer one replaced rejects as cancelled, so follow it to its replacement
		for (let attempt = 0; attempt < 3; attempt++) {
			let computation = this.getComputationFor(branch);
			if (computation == null || this._stale) {
				this._refreshDebounced.cancel();
				await this.refresh(true);
				computation = this.getComputationFor(branch);
			}
			if (computation == null) break;

			try {
				return await computation.promise;
			} catch (ex) {
				if (!isCancellationError(ex) || this._computation === computation) throw ex;
			}
		}

		// The branch read raced the verdict's (a tip it hasn't read yet, or no longer has), so compute it apart
		return getBranchMergeTargetStatusInfo(this.container, branch, undefined, undefined, { landedOnly: true });
	}

	private getComputationFor(branch: GitBranch): VerdictComputation | undefined {
		const computation = this._computation;
		return computation != null &&
			computation.identity.branch === branch.name &&
			computation.identity.tipSha === branch.sha &&
			computation.identity.generation === this._generation
			? computation
			: undefined;
	}

	private schedule(immediate: boolean): void {
		if (this._repository == null) return;

		if (!this.context.host.ready || !this.context.host.visible) {
			this._refreshDebounced.cancel();
			this._deferred = true;
			return;
		}

		if (immediate) {
			this._refreshDebounced.cancel();
			void this.refresh();
		} else {
			this._refreshDebounced();
		}
	}

	/**
	 * Reads what decides the verdict, and recomputes it only when something did move. Unless on `demand`, only for a
	 * branch whose verdict the header reads (see the class comment).
	 */
	private async refresh(demand: boolean = false): Promise<void> {
		const repo = this._repository;
		if (repo == null) return;

		this._deferred = false;
		this._stale = false;

		this._readController?.abort();
		const controller = new AbortController();
		this._readController = controller;
		const signal = controller.signal;

		try {
			const branch = await repo.git.branches.getBranch(undefined, undefined, signal);
			if (signal.aborted) return;

			if (branch == null || branch.detached || !branch.sha) {
				this._branchName = undefined;
				this.cancelComputation();
				if (this._verdict != null) {
					this.publish(undefined);
				}
				return;
			}

			this._branchName = branch.name;
			const identity: GraphMergeTargetIdentity = {
				repoPath: repo.path,
				branch: branch.name,
				tipSha: branch.sha,
				generation: this._generation,
			};

			if (!demand && branch.upstream != null && !branch.upstream.missing) {
				// The header doesn't read it, so leave it for a request. A verdict for another identity would only
				// mislead, so drop it; one for this identity stays, possibly outdated, which `_stale` covers.
				if (this._verdict == null || !isSameIdentity(this._verdict, identity)) {
					this.cancelComputation();
					this.publish({ ...identity, targetRef: undefined, status: undefined, liveUpstream: true });
				}
				this._stale = true;
				return;
			}

			const previousInputs = this._verdict?.branch === branch.name ? this._inputs : undefined;
			const inputs = await this.readInputs(repo, branch, previousInputs?.targetRef, signal);
			if (signal.aborted) return;

			const computation = this._computation;
			if (
				computation != null &&
				isSameIdentity(computation.identity, identity) &&
				!this._evidenceSettled &&
				areInputsEqual(this._inputs, inputs)
			) {
				return;
			}

			const keep = canKeepVerdictWhileRecomputing(
				this._verdict,
				previousInputs?.upstream,
				identity,
				inputs.upstream,
			);
			// Only a new commit on a branch whose upstream was already gone: it can't have just landed, so withholding
			// Publish while it recomputes would only blink the button
			const onlyTipMoved =
				this._verdict != null &&
				this._verdict.branch === identity.branch &&
				this._verdict.generation === identity.generation &&
				this._verdict.tipSha !== identity.tipSha &&
				previousInputs?.upstream === inputs.upstream;
			this._evidenceSettled = false;
			this.compute(repo, branch, identity, inputs, keep, !onlyTipMoved);
		} catch (ex) {
			if (signal.aborted || isCancellationError(ex)) return;

			Logger.error(ex, 'GraphMergeTargetService', 'refresh');
		}
	}

	private compute(
		repo: GlRepository,
		branch: GitBranch,
		identity: GraphMergeTargetIdentity,
		inputs: VerdictInputs,
		keep: boolean,
		allowPending: boolean,
	): void {
		this.cancelComputation();
		const controller = new AbortController();
		this._computeController = controller;
		const signal = controller.signal;
		this._inputs = inputs;
		// Stamped on everything this publishes, so the header can tell the verdict hasn't caught up with a prune yet
		const liveUpstream = (branch.upstream != null && !branch.upstream.missing) || undefined;

		if (!keep) {
			// A gone upstream with no verdict yet may mean the branch landed and its remote branch was deleted, so the
			// header withholds Publish until this settles
			const pending = allowPending && branch.upstream?.missing === true;
			this.publish({
				...identity,
				targetRef: undefined,
				status: undefined,
				pending: pending || undefined,
				liveUpstream: liveUpstream,
			});
			if (pending) {
				this._pendingTimer = setTimeout(() => {
					if (this._computeController !== controller || !this._verdict?.pending) return;

					this.publish({ ...this._verdict, pending: undefined });
				}, pendingTimeout);
			}
		}

		const pullRequest = getBranchAssociatedPullRequest(this.container, branch);
		let pullRequestSettled = false;
		const onPullRequestSettled = (): void => {
			pullRequestSettled = true;
		};
		pullRequest.then(onPullRequestSettled, onPullRequestSettled);

		const promise = getBranchMergeTargetStatusInfo(this.container, branch, signal, pullRequest, {
			landedOnly: true,
		});
		this._computation = { identity: identity, promise: promise };

		void promise.then(
			async status => {
				if (this._computeController !== controller) return;

				clearTimeout(this._pendingTimer);
				this.publish({ ...identity, targetRef: status?.name, status: status, liveUpstream: liveUpstream });

				// The status names the target's tip it measured against, so that's the baseline a later move compares to
				if (status != null) {
					const baseline = await this.readInputs(repo, branch, status.name, signal).catch(() => undefined);
					if (this._computeController !== controller) return;

					this._inputs = { ...(baseline ?? inputs), targetRef: status.name, targetTipSha: status.sha };
				}

				// It answered without the pull request (past the status' deadline), whose evidence may yet decide
				if (!pullRequestSettled) {
					const onSettled = (): void => {
						if (this._computeController !== controller) return;

						this._evidenceSettled = true;
						this.schedule(true);
					};
					pullRequest.then(onSettled, onSettled);
				}
			},
			(ex: unknown) => {
				if (this._computeController !== controller) return;

				clearTimeout(this._pendingTimer);
				if (!isCancellationError(ex)) {
					Logger.error(ex, 'GraphMergeTargetService', 'compute');
				}
				// A failure settles it with no verdict, so pending can't outlive it
				this.publish({ ...identity, targetRef: undefined, status: undefined, liveUpstream: liveUpstream });
			},
		);
	}

	private async readInputs(
		repo: GlRepository,
		branch: GitBranch,
		targetRef: string | undefined,
		signal: AbortSignal,
	): Promise<VerdictInputs> {
		const upstream =
			branch.upstream != null ? `${branch.upstream.name}${branch.upstream.missing ? ':gone' : ''}` : undefined;
		if (targetRef == null) {
			return { upstream: upstream, targetRef: undefined, targetTipSha: undefined, localTargetTipSha: undefined };
		}

		// Both cache-backed, so a trigger that moved nothing costs no git
		const target = await repo.git.branches.getBranch(targetRef, undefined, signal);
		let localTargetTipSha: string | undefined;
		if (target?.remote) {
			const local = await repo.git.branches
				.getBranches({ filter: b => !b.remote && b.upstream?.name === targetRef }, signal)
				.catch(() => undefined);
			localTargetTipSha = local?.values[0]?.sha;
		}

		return {
			upstream: upstream,
			targetRef: targetRef,
			targetTipSha: target?.sha,
			localTargetTipSha: localTargetTipSha,
		};
	}

	private cancelComputation(): void {
		this._computeController?.abort();
		this._computeController = undefined;
		this._computation = undefined;
		this._inputs = undefined;
		clearTimeout(this._pendingTimer);
		this._pendingTimer = undefined;
	}

	private publish(verdict: GraphCurrentBranchMergeTarget | undefined): void {
		this._verdict = verdict;
		this._revision++;
		this.context.fireCurrentBranchMergeTargetChanged(this.state);
	}
}
