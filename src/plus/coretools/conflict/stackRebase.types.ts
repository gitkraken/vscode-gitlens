/**
 * Lifecycle of a stack rebase cascade.
 *
 * Running: `starting` → (`running` → `paused`)* — one pass per layer, bottom to top.
 * Terminal: `completed` (every layer rebased), `stopped` (the user aborted a layer's rebase or its
 * automation, leaving the layers below it rebased), `failed` (a rebase error, a branch that went
 * missing, or an unexpected error).
 *
 * `paused` is deliberately NOT terminal: a manual-mode conflict and an AI-mode escalation both hand
 * the user the wheel for ONE layer, and the cascade picks the rest of the stack back up the moment
 * that layer finishes — see {@link StackRebaseSession}.
 */
export type StackRebasePhase = 'starting' | 'running' | 'paused' | 'completed' | 'stopped' | 'failed';

export type StackRebaseStepStatus = 'pending' | 'running' | 'paused' | 'completed' | 'failed';

/** One layer of the stack, as the cascade will act on it. */
export interface StackRebaseStep {
	/** The pull request occupying this layer. */
	prNumber: number;
	/** The pull request's head branch name, without a remote prefix. */
	headRef: string;
	/** The local branch the cascade rebases — {@link headRef} unless a differently-named local branch
	 *  tracks it. */
	branchName: string;
	/** Set when no local branch exists yet: the remote-tracking ref (e.g. `origin/feature-b`) the
	 *  engine creates {@link branchName} from before rebasing it. */
	createFromRef?: string;
	status: StackRebaseStepStatus;
	/**
	 * The branch tip recorded BEFORE this layer is rebased — load-bearing, not diagnostic. It is the
	 * `<oldBase>` the layer above rebases off (`git rebase --onto <thisBranch> <thisPreSha> <above>`),
	 * because once this layer is rewritten its old commits are only reachable by SHA. Recording it
	 * after the rebase would name the new tip and replay nothing.
	 */
	preSha?: string;
	/** The branch tip after this layer was rebased — what a force push would publish. */
	postSha?: string;
	/** Set once the rewritten branch has been force pushed, so the durable offer retires itself instead
	 *  of inviting a second, pointless push. */
	pushed?: boolean;
	/** Error message when {@link status} is `failed`. */
	error?: string;
}

/** The cascade the engine will run, resolved from a stack's layers. Steps are ordered bottom to top. */
export interface StackRebasePlan {
	/** Identifies the stack within its repository. */
	stackNumber: number;
	/** The branch the bottom of the stack targets, as the host names it (e.g. `main`). */
	baseRef: string;
	/** {@link baseRef} as a remote-tracking ref (e.g. `origin/main`) — the trunk the bottom layer
	 *  rebases onto, so the cascade lands on what the host will actually merge into. */
	upstreamRef: string;
	/** The remote {@link upstreamRef} and any {@link StackRebaseStep.createFromRef} are qualified by. */
	remoteName: string;
	steps: StackRebaseStep[];
}

export type StackRebaseRefusalReason =
	/** No connected git host integration on any remote */
	| 'no-integration'
	/** The host has no stack for this pull request (not enrolled, or it isn't stacked) */
	| 'no-stack'
	/** No pull request to resolve a stack from */
	| 'not-stacked'
	/** Every layer of the stack has already merged */
	| 'no-unmerged-layers'
	/** A layer has no local branch and the provider can't create one */
	| 'cannot-create-branch'
	/** Rebasing isn't available in this environment (no operations provider) */
	| 'unavailable';

export type StackRebasePlanResult =
	| { ok: true; plan: StackRebasePlan }
	| { ok: false; reason: StackRebaseRefusalReason; message: string };

/**
 * A stack rebase in flight. One per repository; mutated in place, with every transition announced on
 * `StackRebaseService.onDidChange` — so a progress surface can hold the object and re-render.
 */
export interface StackRebaseSession {
	readonly id: string;
	readonly repoPath: string;
	/** Identifies the stack within its repository. */
	readonly stackNumber: number;
	/** `manual` stops at each conflict; `ai` delegates each layer to the Auto-Rebase engine. */
	readonly mode: 'manual' | 'ai';
	/** The trunk the bottom layer was rebased onto, as a remote-tracking ref. */
	readonly upstreamRef: string;
	/** The remote {@link upstreamRef} is qualified by — carried on the session because publishing the
	 *  rewritten branches outlives the plan: the durable Force Push Stack offer runs off the finished
	 *  session alone. */
	readonly remoteName: string;
	/** The branch that was checked out when the cascade started, restored at the end when it still
	 *  exists and the working tree is clean. `undefined` on a detached HEAD. */
	readonly startedOnBranch: string | undefined;
	/** The cascade's layers, bottom to top. */
	readonly steps: StackRebaseStep[];
	readonly startedAt: number;
	/** Index into {@link steps} of the layer the cascade is on. */
	index: number;
	phase: StackRebasePhase;
	/** Transient human-readable progress, already carrying the stack position. */
	message?: string;
	/** Error message when {@link phase} is `failed`. */
	failure?: string;
	finishedAt?: number;
}

export interface StackRebaseChangeEvent {
	repoPath: string;
	/** `undefined` when the session was dropped */
	session: StackRebaseSession | undefined;
}
