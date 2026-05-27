import type { GitFileStatus } from '@gitlens/git/models/fileStatus.js';
import { rootSha } from '@gitlens/git/models/revision.js';
import { CancellationError } from '@gitlens/utils/cancellation.js';
import type { GitRepositoryService } from '../../../../git/gitRepositoryService.js';
import { getSimulatorState } from '../../../../plus/ai/__debug__simulatorState.js';
import type { ComposeHunk, ComposePlan } from '../../../../plus/coretools/compose/types.js';
import { configuration } from '../../../../system/-webview/configuration.js';
import type { ComposeProgressUpdate, ScopeSelection } from '../graphService.js';

/**
 * Detects whether the AI simulator is currently active. The simulator gates compose's
 * dedicated bypass path so production behaviour is unchanged when no simulator is in play.
 *
 * Active iff `ai.model` is configured as `simulator:<mode>` (the simulator command sets
 * this when enabled and clears it on disable — see `__debug__aiSimulator.ts`).
 */
export function isComposeSimulatorActive(): boolean {
	const model = configuration.get('ai.model');
	return typeof model === 'string' && model.startsWith('simulator:');
}

/**
 * Shape consumers can pass into the simulator inject queue to drive a specific
 * compose result. The schema is intentionally simple — far simpler than
 * compose-tools' real validator — so test code can produce it by hand.
 *
 * Each commit owns a list of file paths; the simulator packs all hunks for those
 * files into that commit. Files not assigned to any commit fall through into an
 * auto-generated commit ("Remaining changes"). Unknown paths are dropped silently.
 */
export interface SimulatedComposeContent {
	readonly commits: ReadonlyArray<{
		readonly message: string;
		readonly files?: ReadonlyArray<string>;
	}>;
}

/** Same shape `libraryPlanToProposedCommits` consumes — pure types, no library values. */
export interface SimulatedPlanResult {
	plan: ComposePlan;
	sourceHunks: ComposeHunk[];
	headSha: string;
	rewriteFromSha: string;
	kind: 'wip-only';
	selectedShas?: string[];
}

/**
 * Synthesises a `planResult` compatible with `libraryPlanToProposedCommits` without
 * invoking the AI pipeline. The output funnels through the same `ProposedCommit[]`
 * conversion + virtual session bootstrap that the real path uses, so the rest of the
 * compose UI (registry generating→complete, projection, back/forward) exercises end-to-end.
 *
 * `commitCompose` is deliberately out of scope here — the bypass does NOT register a
 * compose-tools cache key, so committing the sim plan returns
 * "No active compose plan; please regenerate." This keeps the bypass purely additive
 * (no fake apply path) and matches review's sim behaviour (review surfaces results but
 * doesn't apply them either).
 */
export async function runSimulatedComposeChanges(input: {
	svc: GitRepositoryService;
	scope: Extract<ScopeSelection, { type: 'wip' }>;
	signal?: AbortSignal;
	onProgress: (update: ComposeProgressUpdate) => void;
}): Promise<SimulatedPlanResult> {
	const { svc, scope, signal, onProgress } = input;

	const state = getSimulatorState();
	const mode = state.mode;

	signal?.throwIfAborted();

	if (mode === 'cancel') {
		throw new CancellationError();
	}

	onProgress({ phase: 'collecting', message: 'Preparing changes…' });

	if (mode === 'slow') {
		await delay(state.slowDelayMs, signal);
	}

	// Resolve HEAD up front — both for the wip-only base anchor and the synthetic hunks.
	const headCommit = await svc.commits.getCommit('HEAD');
	signal?.throwIfAborted();
	const headSha = headCommit?.sha ?? rootSha;

	// Pull file list straight from `git status` — same source the real path uses
	// downstream via `wipByPath`, so file rows light up identically.
	const status = await svc.status.getStatus(undefined, signal);
	signal?.throwIfAborted();

	const statusFiles = status?.files ?? [];
	if (statusFiles.length === 0) {
		// No working changes — surface as an empty plan rather than a fake error. The
		// UI handles `commits: []` as a no-op "nothing to compose" state cleanly.
		return {
			plan: emptyPlan(),
			sourceHunks: [],
			headSha: headSha,
			rewriteFromSha: headSha,
			kind: 'wip-only',
		};
	}

	// Filter to the scope's staged/unstaged toggles. status.files includes both
	// staged and unstaged entries; we keep a file if its anchor matches at least one
	// enabled toggle.
	const filtered = statusFiles.filter(f => {
		const isStagedOnly = f.staged && !f.workingTreeStatus;
		if (isStagedOnly) return scope.includeStaged;

		const isWorkingOnly = !f.staged && f.workingTreeStatus != null;
		if (isWorkingOnly) return scope.includeUnstaged;
		// Both staged + unstaged — include if either toggle is on.
		return scope.includeStaged || scope.includeUnstaged;
	});

	if (filtered.length === 0) {
		return {
			plan: emptyPlan(),
			sourceHunks: [],
			headSha: headSha,
			rewriteFromSha: headSha,
			kind: 'wip-only',
		};
	}

	// Pop the next injected payload for `generate-commits`. This is the same queue the
	// simulator AI provider drains, so a `gitlens.plus.simulate.ai` `inject` flows here.
	// Built-in defaults aren't useful (compose-tools' validator rejects them) — for the
	// bypass path we treat "no inject" as "deterministic fallback".
	const injected = state.pop('generate-commits');

	if (mode === 'error') {
		// Honour error mode after collection so progress events still fire. Matches what
		// the simulator AI provider does at the per-call layer.
		throw new Error('(Simulator) Simulated compose failure for verification');
	}

	onProgress({ phase: 'composing', message: 'Generating commit groups…' });

	// Build one ComposeHunk per scoped file. Synthetic content — the patch field is
	// realistic enough to render in the per-commit virtual diff view (one file → one hunk).
	const sourceHunks: ComposeHunk[] = filtered.map((f, i) => makeSyntheticHunk(i, f.path, f.originalPath, f.status));

	const hunkIndexByPath = new Map<string, number[]>();
	for (const h of sourceHunks) {
		const existing = hunkIndexByPath.get(h.fileName);
		if (existing == null) {
			hunkIndexByPath.set(h.fileName, [h.index]);
		} else {
			existing.push(h.index);
		}
	}

	const parsed = parseInjectedContent(injected);
	const groupings = groupHunksToCommits(parsed, hunkIndexByPath, filtered);

	signal?.throwIfAborted();
	onProgress({ phase: 'verifying', message: 'Finalising plan…' });

	const plan: ComposePlan = {
		grouping: { groups: [] } as unknown as ComposePlan['grouping'],
		ordering: { orderedCommitIds: groupings.map(g => g.id) } as unknown as ComposePlan['ordering'],
		branches: [],
		allOrderedCommits: groupings.map(g => ({
			id: g.id,
			message: g.message,
			explanation: '(Simulator) Synthetic commit grouping for verification.',
			hunkIndices: g.hunkIndices,
		})),
	};

	return {
		plan: plan,
		sourceHunks: sourceHunks,
		headSha: headSha,
		rewriteFromSha: headSha,
		kind: 'wip-only',
	};
}

function emptyPlan(): ComposePlan {
	return {
		grouping: { groups: [] } as unknown as ComposePlan['grouping'],
		ordering: { orderedCommitIds: [] } as unknown as ComposePlan['ordering'],
		branches: [],
		allOrderedCommits: [],
	};
}

function makeSyntheticHunk(
	index: number,
	fileName: string,
	originalFileName: string | undefined,
	status: GitFileStatus,
): ComposeHunk {
	const isRename = status === 'R' || status === 'C';
	const path = fileName;
	const oldPath = originalFileName ?? fileName;
	const diffHeader = [`diff --git a/${oldPath} b/${path}`, `--- a/${oldPath}`, `+++ b/${path}`].join('\n');
	const hunkHeader = '@@ -1,1 +1,1 @@';
	// One-line synthetic content — enough to render a non-empty diff but small enough
	// to keep memory + serialization trivial across the IPC boundary.
	const content = ['-(simulated original line)', '+(simulated changed line)'].join('\n');
	return {
		index: index,
		fileName: path,
		diffHeader: diffHeader,
		hunkHeader: hunkHeader,
		content: content,
		additions: 1,
		deletions: 1,
		isRename: isRename || undefined,
		originalFileName: originalFileName,
	};
}

function parseInjectedContent(raw: string | undefined): SimulatedComposeContent | undefined {
	if (raw == null || raw.length === 0) return undefined;

	try {
		const parsed: unknown = JSON.parse(raw);
		if (parsed == null || typeof parsed !== 'object') return undefined;

		const commits = (parsed as { commits?: unknown }).commits;
		if (!Array.isArray(commits)) return undefined;

		const sanitized: SimulatedComposeContent['commits'][number][] = [];
		for (const c of commits) {
			if (c == null || typeof c !== 'object') continue;

			const message = (c as { message?: unknown }).message;
			const files = (c as { files?: unknown }).files;
			if (typeof message !== 'string' || message.length === 0) continue;

			sanitized.push({
				message: message,
				files: Array.isArray(files) ? files.filter((f): f is string => typeof f === 'string') : undefined,
			});
		}
		if (sanitized.length === 0) return undefined;
		return { commits: sanitized };
	} catch {
		// Malformed JSON falls through to deterministic fallback rather than failing —
		// keeps the sim path forgiving when a test mistypes the payload.
		return undefined;
	}
}

function groupHunksToCommits(
	parsed: SimulatedComposeContent | undefined,
	hunkIndexByPath: ReadonlyMap<string, number[]>,
	files: ReadonlyArray<{ path: string }>,
): { id: string; message: string; hunkIndices: number[] }[] {
	if (parsed != null) {
		const assignedIndices = new Set<number>();
		const groups: { id: string; message: string; hunkIndices: number[] }[] = [];
		for (let i = 0; i < parsed.commits.length; i++) {
			const c = parsed.commits[i];
			const indices: number[] = [];
			if (c.files != null) {
				for (const path of c.files) {
					const fileIndices = hunkIndexByPath.get(path);
					if (fileIndices == null) continue;

					for (const idx of fileIndices) {
						if (assignedIndices.has(idx)) continue;

						assignedIndices.add(idx);
						indices.push(idx);
					}
				}
			}
			groups.push({ id: `sim-${i + 1}`, message: c.message, hunkIndices: indices });
		}

		// Sweep up any unassigned hunks into a trailing commit so no file silently disappears.
		const remaining: number[] = [];
		for (const indices of hunkIndexByPath.values()) {
			for (const idx of indices) {
				if (!assignedIndices.has(idx)) {
					remaining.push(idx);
				}
			}
		}
		if (remaining.length > 0) {
			groups.push({
				id: `sim-${groups.length + 1}`,
				message: '(Simulator) Remaining changes',
				hunkIndices: remaining,
			});
		}
		// Drop empty groups — keeps the proposed commit list focused on real content.
		return groups.filter(g => g.hunkIndices.length > 0);
	}

	// Deterministic fallback — one commit per modified file. Stable + obvious in screenshots.
	return files.map((f, i) => {
		const indices = hunkIndexByPath.get(f.path) ?? [];
		return {
			id: `sim-${i + 1}`,
			message: `(Simulator) Update ${f.path}`,
			hunkIndices: indices,
		};
	});
}

function delay(ms: number, signal?: AbortSignal): Promise<void> {
	return new Promise<void>((resolve, reject) => {
		if (signal?.aborted) {
			reject(new CancellationError());
			return;
		}

		let timer: ReturnType<typeof setTimeout>;
		const onAbort = (): void => {
			clearTimeout(timer);
			reject(new CancellationError());
		};
		timer = setTimeout(() => {
			signal?.removeEventListener('abort', onAbort);
			resolve();
		}, ms);
		signal?.addEventListener('abort', onAbort, { once: true });
	});
}
