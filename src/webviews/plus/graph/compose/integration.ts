import type { CancellationToken } from 'vscode';
import { rootSha } from '@gitlens/git/models/revision.js';
import type { Source } from '../../../../constants.telemetry.js';
import type { GlRepository } from '../../../../git/models/repository.js';
import { ComposeToolsIntegration } from '../../../../plus/coretools/compose/integration.js';
import type {
	ApplyUpTo,
	ComposeApplyPlan,
	ComposeHunk,
	ComposePlan,
	ComposePlanResult,
	ComposeProgressEvent,
	ComposeSource,
	SigningConfig,
	StashConflict,
} from '../../../../plus/coretools/compose/types.js';
import { applyComposePlan, cancellationTokenToSignal, composePlan } from '../../../../plus/coretools/compose/utils.js';
import type { ScopeSelection } from '../graphService.js';
import { graphComposeStashPrefix } from './utils.js';

export interface GeneratePlanForGraphDetailsInput {
	repo: GlRepository;
	scope: ScopeSelection;
	customInstructions?: string;
	excludedFiles?: string[];
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
	repo: GlRepository;
	cacheKey: string;
	mode: 'all' | 'up-to';
	upToIndex?: number;
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
 * Compose-tools integration specialized for the graph-details compose panel.
 *
 * Translates the graph's `ScopeSelection` (WIP-only, commits-only, WIP+commits)
 * into the library's `ComposeSource` shape, and returns the library `ComposePlan`
 * directly (the graph webview turns it into `ProposedCommit[]` via
 * `libraryPlanToProposedCommits` in `./utils.js`).
 *
 * Lives in its own file (separate from `./utils.js`) so that the worker-targeted
 * `graphWebview.ts` can value-import the pure helpers from `utils.ts` without
 * dragging this class's transitive `node:child_process` dependency into the
 * worker bundle. The class itself is only value-imported by the env-routed
 * factory in `@env/coretools/composer.js`.
 */
export class GraphComposeIntegration extends ComposeToolsIntegration {
	async generatePlanForGraphDetails(
		input: GeneratePlanForGraphDetailsInput,
	): Promise<GeneratePlanForGraphDetailsResult> {
		const git = this.createGitPort(input.repo);
		const model = this.createAiModelPort(input.telemetrySource);
		const { signal, dispose: disposeSignal } = cancellationTokenToSignal(input.cancellation);
		const onBeforePrompt = this.buildLargePromptGate(input.suppressLargePromptWarning ?? false);

		try {
			const resolved = await this.resolveGraphScope(input.repo, input.scope);
			const source = this.scopeToComposeSource(input.scope, resolved);

			const excluded = input.excludedFiles?.length ? new Set(input.excludedFiles) : undefined;
			const hunkFilter = excluded?.size
				? (hunks: ComposeHunk[]) =>
						hunks.filter(h => !excluded.has(h.fileName) && !excluded.has(h.originalFileName ?? h.fileName))
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
			});

			const cacheKey = this.createCacheKey(input.repo.path);
			this._cache.set(cacheKey, {
				plan: result.plan,
				snapshot: result.snapshot,
				source: source,
				sourceHunks: result.source.hunks,
				excludedFiles: input.excludedFiles?.length ? [...input.excludedFiles] : undefined,
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

	async applyPlanForGraphDetails(input: ApplyPlanForGraphDetailsInput): Promise<ApplyPlanForGraphDetailsResult> {
		const cached = this._cache.get(input.cacheKey);
		if (!cached) {
			throw new Error(
				`No cached compose plan for key '${input.cacheKey}'. Call generatePlanForGraphDetails() first.`,
			);
		}

		const git = this.createGitPort(input.repo);
		const applyPlanInput: ComposeApplyPlan = {
			plan: cached.plan,
			source: cached.source,
			snapshot: cached.snapshot,
		};

		const totalCommits = cached.plan.allOrderedCommits.length;
		const applyUpTo: ApplyUpTo =
			input.mode === 'all'
				? { kind: 'all' }
				: { kind: 'count', count: totalCommits - (input.upToIndex ?? totalCommits) };

		const stashLabel = `${graphComposeStashPrefix}${new Date().toISOString().replace(/[:.]/g, '-')}`;

		// Reconstruct the same hunkFilter the plan was generated with. The cached
		// snapshot's diffHash was computed from the filtered hunk set; if we don't
		// re-apply the filter at apply time, the library's drift check sees the
		// fresh unfiltered diff and reports a false-positive SAFETY_CHECK_FAILED.
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
				applyUpTo: applyUpTo,
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

	private async resolveGraphScope(
		repo: GlRepository,
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

		const svc = this.container.git.getRepositoryService(repo.path);
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
		resolved: { branchName: string; headSha: string; rewriteFromSha: string; kind: string },
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

		if (!hasWip) {
			return {
				type: 'commit-range',
				branch: resolved.branchName,
				from: resolved.rewriteFromSha,
				to: resolved.headSha,
			};
		}

		return {
			type: 'commit-range',
			branch: resolved.branchName,
			from: resolved.rewriteFromSha,
			to: resolved.headSha,
			includeWorkdir: {
				includeStaged: scope.includeStaged,
				includeUnstaged: scope.includeUnstaged,
				includeUntracked: scope.includeUnstaged,
			},
		};
	}
}
