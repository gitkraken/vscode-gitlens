import type { CancellationToken } from 'vscode';
import { rootSha } from '@gitlens/git/models/revision.js';
import type { Source } from '../../../../constants.telemetry.js';
import type { GitRepositoryService } from '../../../../git/gitRepositoryService.js';
import { ComposeToolsIntegration } from '../../../../plus/coretools/compose/integration.js';
import type {
	ComposeApplyPlan,
	ComposeHunk,
	ComposePlan,
	ComposePlanResult,
	ComposeProgressEvent,
	ComposeSource,
	RefineProgressEvent,
	SigningConfig,
	StashConflict,
} from '../../../../plus/coretools/compose/types.js';
import {
	applyComposePlan,
	cancellationTokenToSignal,
	composePlan,
	REDACTED_HUNK_CONTENT,
	refinePlan,
} from '../../../../plus/coretools/compose/utils.js';
import type { ComposerHunk } from '../../composer/protocol.js';
import type { ScopeSelection } from '../graphService.js';
import { graphComposeStashPrefix, toComposerHunk } from './utils.js';

export interface GeneratePlanForGraphDetailsInput {
	svc: GitRepositoryService;
	scope: ScopeSelection;
	customInstructions?: string;
	excludedFiles?: string[];
	aiExcludedFiles?: string[];
	cancellation?: CancellationToken;
	telemetrySource: Source;
	suppressLargePromptWarning?: boolean;
	onProgress?: (event: ComposeProgressEvent) => void;
}

export interface GeneratePlanForGraphDetailsResult {
	cacheKey: string;
	plan: ComposePlan;
	sourceHunks: ComposeHunk[];
	headSha: string;
	rewriteFromSha: string;
	selectedShas?: string[];
	kind: 'wip-only' | 'wip+commits' | 'commits-only';
	diffStats: { fileCount: number; hunkCount: number; addedLines: number; removedLines: number };
	usage: { inputTokens: number; outputTokens: number };
}

export interface ApplyPlanForGraphDetailsInput {
	svc: GitRepositoryService;
	cacheKey: string;
	/** When provided, only commits whose `id` is in this list are applied. Hunks belonging to
	 *  omitted commits become unstaged workdir changes via the library's leftover-patch path.
	 *  Undefined applies every commit. */
	includedCommitIds?: readonly string[];
	signing?: SigningConfig;
	telemetrySource: Source;
	onProgress?: (event: ComposeProgressEvent) => void;
}

export interface ApplyPlanForGraphDetailsResult {
	commitShas?: Record<string, string>;
	undoId?: string;
	stashConflict?: StashConflict;
}

/**
 * Input for {@link GraphComposeIntegration.refinePlanForGraphDetails} — a chat-style follow-up
 * to an existing cached plan. No re-collection, no re-analysis: a single AI continuation call
 * that produces an updated plan from the prior session + the user's new instructions.
 */
export interface RefinePlanForGraphDetailsInput {
	svc: GitRepositoryService;
	/** Cache key from the prior `generatePlanForGraphDetails` (or earlier refine) call. */
	priorCacheKey: string;
	/** The user's refinement instructions — passed verbatim to the library. */
	customInstructions?: string;
	/**
	 * Commit ids from the prior plan that the user has locked in the UI. The library
	 * enforces that every locked commit appears in the AI's output (retries if missing)
	 * and substitutes their content from the prior plan to keep id/message/hunks
	 * byte-identical regardless of minor AI drift.
	 */
	lockedCommitIds?: readonly string[];
	cancellation?: CancellationToken;
	telemetrySource: Source;
	suppressLargePromptWarning?: boolean;
	onProgress?: (event: RefineProgressEvent) => void;
}

/** Cached scope info stamped onto the integration cache entry by the graph compose flow.
 *  Read on refine so we can return the same downstream shape without re-running any git ops. */
interface GraphCacheExtras {
	headSha: string;
	rewriteFromSha: string;
	selectedShas?: string[];
	kind: 'wip-only' | 'wip+commits' | 'commits-only';
}

/**
 * Compose-tools integration specialized for the graph-details compose panel.
 *
 * Translates the graph's `ScopeSelection` (WIP-only, commits-only, WIP+commits) into the
 * library's `ComposeSource` shape, and returns the library `ComposePlan` directly (the graph
 * webview turns it into `ProposedCommit[]` via `libraryPlanToProposedCommits` in `./utils.js`).
 *
 * Lives in its own file (separate from `./utils.js`) so that the worker-targeted
 * `graphWebview.ts` can value-import the pure helpers from `utils.ts` without dragging this
 * class's transitive `node:child_process` dependency into the worker bundle. The class itself
 * is only value-imported by the env-routed factory in `@env/coretools/composer.js`.
 */
export class GraphComposeIntegration extends ComposeToolsIntegration {
	async generatePlanForGraphDetails(
		input: GeneratePlanForGraphDetailsInput,
	): Promise<GeneratePlanForGraphDetailsResult> {
		const git = this.createGitPort(input.svc);
		const model = this.createAiModelPort(input.telemetrySource);
		const { signal, dispose: disposeSignal } = cancellationTokenToSignal(input.cancellation);
		const onBeforePrompt = this.buildLargePromptGate(input.suppressLargePromptWarning ?? false);

		try {
			const resolved = await this.resolveGraphScope(input.svc, input.scope);
			const source = this.scopeToComposeSource(input.scope, resolved);

			const aiExcluded = input.aiExcludedFiles?.length ? new Set(input.aiExcludedFiles) : undefined;
			const userExcluded = input.excludedFiles?.length
				? new Set(input.excludedFiles.filter(p => !aiExcluded?.has(p)))
				: undefined;
			const hunkFilter = userExcluded?.size
				? (hunks: ComposeHunk[]) =>
						hunks.filter(
							h => !userExcluded.has(h.fileName) && !userExcluded.has(h.originalFileName ?? h.fileName),
						)
				: undefined;
			const redactHunkContent = aiExcluded?.size
				? (h: ComposeHunk) => aiExcluded.has(h.fileName) || aiExcluded.has(h.originalFileName ?? h.fileName)
				: undefined;

			const result: ComposePlanResult = await composePlan({
				git: git,
				model: model,
				source: source,
				instructions: input.customInstructions,
				onProgress: input.onProgress,
				cancellation: signal,
				onBeforePrompt: onBeforePrompt,
				hunkFilter: hunkFilter,
				redactHunkContent: redactHunkContent,
			});

			const cacheKey = this.createCacheKey(input.svc.path);
			const extras: GraphCacheExtras = {
				headSha: resolved.headSha,
				rewriteFromSha: resolved.rewriteFromSha,
				selectedShas: resolved.selectedShas,
				kind: resolved.kind,
			};
			this._cache.set(cacheKey, {
				plan: result.plan,
				snapshot: result.snapshot,
				source: source,
				sourceHunks: result.source.hunks,
				excludedFiles: userExcluded?.size ? [...userExcluded] : undefined,
				aiExcludedFiles: input.aiExcludedFiles?.length ? [...input.aiExcludedFiles] : undefined,
				session: result.session,
				extras: extras,
			});

			return {
				cacheKey: cacheKey,
				plan: result.plan,
				sourceHunks: result.source.hunks,
				headSha: resolved.headSha,
				rewriteFromSha: resolved.rewriteFromSha,
				selectedShas: resolved.selectedShas,
				kind: resolved.kind,
				diffStats: {
					fileCount: new Set(result.source.hunks.map(h => h.fileName)).size,
					hunkCount: result.source.hunks.length,
					addedLines: result.source.hunks.reduce((sum, h) => sum + h.additions, 0),
					removedLines: result.source.hunks.reduce((sum, h) => sum + h.deletions, 0),
				},
				usage: {
					inputTokens: result.usage.inputTokens,
					outputTokens: result.usage.outputTokens,
				},
			};
		} finally {
			disposeSignal();
		}
	}

	/**
	 * Refine an existing cached plan with new user instructions — chat-style continuation.
	 *
	 * NO git operations. NO re-collection. NO re-analysis. Reuses the cached session + plan
	 * from the prior `generatePlanForGraphDetails` (or earlier refine) call and runs a single
	 * AI call via `refinePlan` from `@gitkraken/compose-tools`. The cached snapshot is carried
	 * forward unchanged so a subsequent `applyPlanForGraphDetails` can validate against it.
	 *
	 * Adds two GitLens-specific wrinkles on top of the library contract:
	 *
	 * 1. Builds a `clientContext` string with a UI-ordering note — the webview displays commits
	 *    in REVERSE of the library's planning order, so positional references in user
	 *    instructions ("merge commits 1 and 2") need explicit mapping. The note is appended to
	 *    the library's refinement prompt verbatim.
	 *
	 * 2. Reconstructs the same `redactHunkContent` predicate used at original generate time so
	 *    AI-excluded file content stays masked in the refinement prompt's references.
	 */
	async refinePlanForGraphDetails(input: RefinePlanForGraphDetailsInput): Promise<GeneratePlanForGraphDetailsResult> {
		const prior = this._cache.get(input.priorCacheKey);
		if (prior == null) {
			throw new Error(
				`No cached compose plan for key '${input.priorCacheKey}'. Call generatePlanForGraphDetails() first.`,
			);
		}

		if (prior.session == null || prior.session.messages.length === 0) {
			throw new Error(
				`Cannot refine — prior compose session lacks message history. Regenerate a fresh plan first.`,
			);
		}

		const priorExtras = prior.extras as GraphCacheExtras | undefined;
		if (priorExtras == null) {
			throw new Error(`Cannot refine — prior cache entry lacks scope metadata. Regenerate a fresh plan first.`);
		}

		const model = this.createAiModelPort(input.telemetrySource);
		const { signal, dispose: disposeSignal } = cancellationTokenToSignal(input.cancellation);
		const onBeforePrompt = this.buildLargePromptGate(input.suppressLargePromptWarning ?? false);

		try {
			const refined = await refinePlan({
				session: prior.session,
				priorPlan: prior.plan,
				model: model,
				instructions: input.customInstructions,
				lockedCommits: input.lockedCommitIds,
				clientContext: buildUiOrderingNote(prior.plan),
				cancellation: signal,
				onBeforePrompt: onBeforePrompt,
				onProgress: input.onProgress,
			});

			const cacheKey = this.createCacheKey(input.svc.path);
			this._cache.set(cacheKey, {
				plan: refined.plan,
				snapshot: prior.snapshot,
				source: prior.source,
				sourceHunks: prior.sourceHunks,
				excludedFiles: prior.excludedFiles,
				aiExcludedFiles: prior.aiExcludedFiles,
				session: refined.session,
				extras: priorExtras,
			});

			if (input.priorCacheKey !== cacheKey) {
				this._cache.delete(input.priorCacheKey);
			}

			return {
				cacheKey: cacheKey,
				plan: refined.plan,
				sourceHunks: prior.sourceHunks,
				headSha: priorExtras.headSha,
				rewriteFromSha: priorExtras.rewriteFromSha,
				selectedShas: priorExtras.selectedShas,
				kind: priorExtras.kind,
				diffStats: {
					fileCount: new Set(prior.sourceHunks.map(h => h.fileName)).size,
					hunkCount: prior.sourceHunks.length,
					addedLines: prior.sourceHunks.reduce((sum, h) => sum + h.additions, 0),
					removedLines: prior.sourceHunks.reduce((sum, h) => sum + h.deletions, 0),
				},
				usage: {
					inputTokens: refined.usage.inputTokens,
					outputTokens: refined.usage.outputTokens,
				},
			};
		} finally {
			disposeSignal();
		}
	}

	async applyPlanForGraphDetails(input: ApplyPlanForGraphDetailsInput): Promise<ApplyPlanForGraphDetailsResult> {
		const cached = this._cache.get(input.cacheKey);
		if (!cached) {
			throw new Error(
				`No cached compose plan for key '${input.cacheKey}'. Call generatePlanForGraphDetails() first.`,
			);
		}

		const git = this.createGitPort(input.svc);
		const applyPlanInput: ComposeApplyPlan = {
			plan: cached.plan,
			source: cached.source,
			snapshot: cached.snapshot,
		};

		const stashLabel = `${graphComposeStashPrefix}${new Date().toISOString().replace(/[:.]/g, '-')}`;

		// Reconstruct the same user-only hunkFilter the plan was generated with. The cached
		// snapshot's diffHash was computed from the filtered hunk set; without re-applying the
		// filter at apply time, the library's drift check sees the fresh unfiltered diff and
		// reports a false-positive SAFETY_CHECK_FAILED. aiexclude-masked files were NOT filtered
		// (only their AI prompt content was masked), so they don't participate here.
		const excluded = cached.excludedFiles?.length ? new Set(cached.excludedFiles) : undefined;
		const hunkFilter = excluded?.size
			? (hunks: ComposeHunk[]) =>
					hunks.filter(h => !excluded.has(h.fileName) && !excluded.has(h.originalFileName ?? h.fileName))
			: undefined;

		try {
			const result = await applyComposePlan({
				git: git,
				applyPlan: applyPlanInput,
				onProgress: input.onProgress,
				signing: input.signing,
				authorAttribution: 'plurality',
				applyCommitIds: input.includedCommitIds != null ? [...input.includedCommitIds] : undefined,
				stashLabel: stashLabel,
				hunkFilter: hunkFilter,
			});

			return {
				commitShas: result.commitShas,
				undoId: result.undoId,
				stashConflict: result.stashConflict,
			};
		} finally {
			this._cache.delete(input.cacheKey);
		}
	}

	/**
	 * Read the hunks belonging to a cached draft commit, converted to GitLens's `ComposerHunk`
	 * shape and with content masked for any file in the original compose run's `aiExcludedFiles`.
	 *
	 * Used by the per-commit message-regen flow: the AI gets a masked view of excluded content
	 * that matches the original compose run's prompt, so single-commit regen doesn't quietly
	 * bypass an aiexclude rule the original compose honored.
	 *
	 * Returns `undefined` when the cache entry or commit id isn't found.
	 */
	getMaskedHunksForCachedCommit(
		cacheKey: string,
		commitId: string,
	): { hunks: ComposerHunk[]; currentMessage: string } | undefined {
		const cached = this._cache.get(cacheKey);
		if (cached == null) return undefined;

		const commit = cached.plan.allOrderedCommits.find(c => c.id === commitId);
		if (commit == null) return undefined;

		const indexSet = new Set(commit.hunkIndices);
		const aiExcluded = cached.aiExcludedFiles?.length ? new Set(cached.aiExcludedFiles) : undefined;

		const hunks: ComposerHunk[] = [];
		for (const h of cached.sourceHunks) {
			if (!indexSet.has(h.index)) continue;

			const composerHunk = toComposerHunk(h);
			if (aiExcluded?.has(h.fileName) || (h.originalFileName != null && aiExcluded?.has(h.originalFileName))) {
				composerHunk.content = REDACTED_HUNK_CONTENT;
			}
			hunks.push(composerHunk);
		}

		return { hunks: hunks, currentMessage: commit.message };
	}

	/**
	 * Mutate the cached plan's commit message in place. `branches[*].branchGroup.commits[*]`
	 * and `grouping.branches[*].commits[*]` share the same object references with
	 * `allOrderedCommits[*]` (the library builds the latter via `flatMap` over the former),
	 * so one assignment propagates to every read site. Subsequent `refinePlan` calls' locked-
	 * commit substitution will pick up the new message, and `applyComposePlan` writes it to
	 * the resulting commit.
	 *
	 * Returns `false` when the cache entry or commit id isn't found.
	 */
	updateCachedPlanCommitMessage(cacheKey: string, commitId: string, message: string): boolean {
		const cached = this._cache.get(cacheKey);
		if (cached == null) return false;

		const commit = cached.plan.allOrderedCommits.find(c => c.id === commitId);
		if (commit == null) return false;

		commit.message = message;
		return true;
	}

	private async resolveGraphScope(
		svc: GitRepositoryService,
		scope: ScopeSelection,
	): Promise<{
		branchName: string;
		headSha: string;
		rewriteFromSha: string;
		selectedShas?: string[];
		kind: 'wip-only' | 'wip+commits' | 'commits-only';
	}> {
		if (scope.type !== 'wip') {
			throw new Error(`Compose does not support scope type '${scope.type}' yet`);
		}

		const branch = await svc.branches.getBranch();
		if (branch == null || branch.detached || branch.remote) {
			throw new Error('Compose requires a local checked-out branch');
		}

		const headCommit = await svc.commits.getCommit('HEAD');
		if (headCommit == null) {
			throw new Error('Unable to resolve HEAD');
		}

		const headSha = headCommit.sha;

		const hasShas = scope.includeShas.length > 0;
		const hasWip = scope.includeStaged || scope.includeUnstaged;

		if (!hasShas) {
			return { branchName: branch.name, headSha: headSha, rewriteFromSha: headSha, kind: 'wip-only' };
		}

		const selectedSet = new Set(scope.includeShas);
		const ordered: string[] = [];
		let cursorSha: string | undefined = headCommit.sha;
		let cursorParents: readonly string[] = headCommit.parents;
		let collecting = false;
		while (cursorSha != null && ordered.length < selectedSet.size) {
			if (selectedSet.has(cursorSha)) {
				ordered.push(cursorSha);
				collecting = true;
			} else if (collecting) {
				throw new Error('Compose scope includeShas is not a contiguous first-parent range from HEAD');
			}
			const parentSha: string | undefined = cursorParents[0];
			if (parentSha == null) break;

			const parentCommit = await svc.commits.getCommit(parentSha);
			cursorSha = parentCommit?.sha;
			cursorParents = parentCommit?.parents ?? [];
		}
		if (ordered.length !== selectedSet.size) {
			throw new Error('Compose scope includeShas references commits not reachable via first-parent from HEAD');
		}

		const oldest = ordered.at(-1);
		let rewriteFromSha = headSha;
		if (oldest != null) {
			const oldestCommit = await svc.commits.getCommit(oldest);
			rewriteFromSha = oldestCommit?.parents[0] ?? rootSha;
		}
		return {
			branchName: branch.name,
			headSha: headSha,
			rewriteFromSha: rewriteFromSha,
			selectedShas: ordered,
			kind: hasWip ? 'wip+commits' : 'commits-only',
		};
	}

	private scopeToComposeSource(
		scope: ScopeSelection,
		resolved: {
			branchName: string;
			headSha: string;
			rewriteFromSha: string;
			selectedShas?: string[];
			kind: string;
		},
	): ComposeSource {
		if (scope.type !== 'wip') {
			throw new Error(`Compose does not support scope type '${scope.type}'`);
		}

		const hasShas = scope.includeShas.length > 0;
		const hasWip = scope.includeStaged || scope.includeUnstaged;

		if (!hasShas) {
			return {
				type: 'workdir',
				stagedOnly: !scope.includeUnstaged,
				noUntracked: !scope.includeUnstaged,
			};
		}

		const oldestSha = resolved.selectedShas?.at(-1);
		if (oldestSha == null) {
			throw new Error('Compose scope includeShas resolved to an empty selection');
		}

		if (!hasWip) {
			return {
				type: 'commit-range',
				branch: resolved.branchName,
				from: oldestSha,
				to: resolved.headSha,
			};
		}

		return {
			type: 'commit-range',
			branch: resolved.branchName,
			from: oldestSha,
			to: resolved.headSha,
			includeWorkdir: {
				includeStaged: scope.includeStaged,
				includeUnstaged: scope.includeUnstaged,
				includeUntracked: scope.includeUnstaged,
			},
		};
	}
}

/**
 * Build the GitLens-specific UI-ordering note that gets passed to `refinePlan` as
 * `clientContext`. The library doesn't know about the graph webview's reversed display order;
 * this note tells the AI how the user perceives the commit ordering so positional references
 * like "the first commit" resolve correctly.
 */
function buildUiOrderingNote(priorPlan: ComposePlan): string {
	const commits = priorPlan.allOrderedCommits;
	if (commits.length === 0) return '';

	const uiOrdered = commits.toReversed();
	const mapping = uiOrdered.map((c, i) => `${String(i + 1)}. [${c.id}] ${c.message.split('\n')[0]}`).join('\n');

	return `UI ORDERING NOTE: In GitLens's graph compose panel, commits are displayed in REVERSE of your prior plan's allOrderedCommits order — newest at the top, labeled "commit 1". When the user says "the first commit" or "commit 1", they mean the TOP of the UI list (which is the LAST commit in your prior plan).

UI label → commit id (in the order the user sees them):
${mapping}`;
}
