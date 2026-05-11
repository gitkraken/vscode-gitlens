import { window } from 'vscode';
import type { GitFileStatus } from '@gitlens/git/models/fileStatus.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { Container } from '../../../../container.js';
import type { ComposeHunk, ComposePlan, UndoForceOptions } from '../../../../plus/coretools/compose/types.js';
import type { ComposerHunk } from '../../composer/protocol.js';
import type { CommitResult, ComposeCommitPlan, ProposedCommit, ProposedCommitFile } from '../graphService.js';
import type { GraphComposeIntegration } from './integration.js';

/** Stash message prefix used by every graph compose apply. Shared with {@link checkForAbandonedComposeStashes}. */
export const graphComposeStashPrefix = 'gitlens-compose-';

const anchorRank: Record<ProposedCommitFile['anchor'], number> = { committed: 0, staged: 1, unstaged: 2 };

/**
 * Translate the library's `ComposePlan` (plus the source hunks it collected)
 * into the graph's `ProposedCommit[]` wire format, while also producing the
 * per-commit `ComposerHunk[]` arrays used by the graph compose virtual
 * content provider.
 *
 * The `wipByPath` map carries the current working-tree status for files that
 * appear in the source — used to set `staged`/`anchor` correctly on the
 * resulting `ProposedCommitFile`s.
 */
export function libraryPlanToProposedCommits(
	planResult: { plan: ComposePlan; sourceHunks: ComposeHunk[]; headSha: string },
	repoPath: string,
	wipByPath: ReadonlyMap<string, { status: GitFileStatus; originalPath?: string }>,
	createCombinedDiffForCommit: (hunks: ComposerHunk[]) => { patch: string; filePatches: Map<string, string[]> },
): { commits: ProposedCommit[]; commitHunksByIndex: ComposerHunk[][] } {
	const { plan, sourceHunks, headSha } = planResult;
	const hunkByIndex = new Map<number, ComposeHunk>();
	for (const h of sourceHunks) {
		hunkByIndex.set(h.index, h);
	}

	const commitHunksByIndex: ComposerHunk[][] = [];
	const commits: ProposedCommit[] = plan.allOrderedCommits.map((c, ci): ProposedCommit => {
		const commitHunks: ComposerHunk[] = [];
		for (const idx of c.hunkIndices) {
			const lh = hunkByIndex.get(idx);
			if (lh == null) continue;
			commitHunks.push(toComposerHunk(lh));
		}
		commitHunksByIndex[ci] = commitHunks;

		const filesByPath = new Map<string, ProposedCommitFile>();
		for (const lh of c.hunkIndices.map(i => hunkByIndex.get(i)).filter((h): h is ComposeHunk => h != null)) {
			const hunkAnchor: ProposedCommitFile['anchor'] =
				lh.source === 'unstaged' || lh.source === 'untracked'
					? 'unstaged'
					: lh.source === 'staged'
						? 'staged'
						: 'committed';

			const existing = filesByPath.get(lh.fileName);
			const anchor =
				existing == null || anchorRank[hunkAnchor] > anchorRank[existing.anchor] ? hunkAnchor : existing.anchor;

			const wip = wipByPath.get(lh.fileName);
			filesByPath.set(lh.fileName, {
				repoPath: repoPath,
				path: lh.fileName,
				status: wip?.status ?? 'M',
				originalPath: wip?.originalPath ?? lh.originalFileName,
				staged: anchor === 'staged',
				anchor: anchor,
				anchorSha: anchor === 'committed' ? headSha : undefined,
			});
		}

		const additions = commitHunks.reduce((sum, h) => sum + (h.additions ?? 0), 0);
		const deletions = commitHunks.reduce((sum, h) => sum + (h.deletions ?? 0), 0);
		const { patch } = createCombinedDiffForCommit(commitHunks);

		return {
			id: c.id,
			message: c.message,
			files: [...filesByPath.values()],
			additions: additions,
			deletions: deletions,
			patch: patch,
		};
	});

	return { commits: commits, commitHunksByIndex: commitHunksByIndex };
}

/** Recognize the library's CANCELLED error so the RPC handler can surface a clean cancel sentinel. */
export function isComposeCancelled(ex: unknown): boolean {
	return ex instanceof Error && ex.name === 'ComposeWorkflowError' && (ex as { code?: string }).code === 'CANCELLED';
}

function toComposerHunk(h: ComposeHunk): ComposerHunk {
	return {
		index: h.index + 1,
		fileName: h.fileName,
		diffHeader: h.diffHeader,
		hunkHeader: h.hunkHeader,
		content: h.content,
		additions: h.additions,
		deletions: h.deletions,
		source: h.source === 'branch' ? (h.sourceCommitSha ?? 'commits') : h.source,
		isRename: h.isRename,
		originalFileName: h.originalFileName,
		author: h.author
			? { name: h.author.name, email: h.author.email, date: h.author.date ?? new Date() }
			: undefined,
		coAuthors: h.coAuthors?.map(ca => ({ name: ca.name, email: ca.email, date: ca.date ?? new Date() })),
	};
}

/**
 * Apply a graph compose plan, surfacing the result through GitLens's CommitResult shape.
 *
 * On stash-pop conflict, prompts the user with Keep/Rollback/Resolve options. Rollback
 * calls the library's undo machinery; Resolve / Keep both succeed but warn that the
 * working tree is in a conflicted state.
 */
export async function executeComposeCommit(
	container: Container,
	repoPath: string,
	plan: ComposeCommitPlan,
	composeTools: GraphComposeIntegration,
	cacheKey: string,
): Promise<CommitResult> {
	const repo = container.git.getRepository(repoPath);
	if (repo == null) {
		return { error: { message: 'Repository not found.' } };
	}

	const commits =
		plan.mode === 'up-to' && plan.upToIndex != null ? plan.commits.slice(0, plan.upToIndex + 1) : plan.commits;
	if (commits.length === 0) return { success: true as const };

	const signingConfig = await repo.git.config.getSigningConfig?.();
	const signing = signingConfig?.enabled
		? {
				enabled: true,
				signingKey: signingConfig.signingKey,
				gpgProgram: signingConfig.gpgProgram,
			}
		: undefined;

	let result;
	try {
		result = await composeTools.applyPlanForGraphDetails({
			repo: repo,
			cacheKey: cacheKey,
			mode: plan.mode,
			upToIndex: plan.upToIndex,
			signing: signing,
			telemetrySource: { source: 'graph' },
		});
	} catch (ex) {
		return { error: { message: `Compose rewrite failed: ${ex instanceof Error ? ex.message : String(ex)}` } };
	}

	const stashConflict = result.stashConflict;
	if (stashConflict == null) return { success: true as const };

	const choice = await window.showWarningMessage(
		`The compose rewrite succeeded, but re-applying your working changes hit a conflict. Your original state is saved as stash "${stashConflict.stashLabel}".`,
		{ modal: true },
		'Keep Rewrite',
		'Roll Back',
		'Resolve Manually',
	);
	if (choice === 'Roll Back') {
		if (result.undoId == null) {
			return {
				error: {
					message: `Roll back unavailable: no undo manifest was created. Your original working changes remain in stash "${stashConflict.stashLabel}".`,
				},
			};
		}
		try {
			const force: UndoForceOptions = { dirtyWorkdir: true };
			await composeTools.undoCompose({
				repo: repo,
				undoId: result.undoId,
				force: force,
			});
			return { error: { message: 'Compose rewrite rolled back by user after stash conflict.' } };
		} catch (ex) {
			Logger.error(ex, 'executeComposeCommit.rollback');
			return {
				error: {
					message: `Roll back failed: ${
						ex instanceof Error ? ex.message : String(ex)
					}. Your original working changes remain in stash "${stashConflict.stashLabel}".`,
				},
			};
		}
	}
	return {
		success: true as const,
		warning: `Working changes left in a conflicted state — resolve in stash "${stashConflict.stashLabel}".`,
	};
}

/**
 * Per-repo state for the abandoned-stash scan: deduplicates overlapping in-flight scans
 * (two rapid graph shows) and suppresses re-prompting after the user dismisses — a
 * fresh prompt fires again only once a new compose-stash appears.
 */
const abandonedStashScans = new Map<string, Promise<void>>();
const dismissedStashNames = new Map<string, Set<string>>();

/**
 * Scans the repo's stash list for leftover compose stashes (created by
 * {@link executeComposeCommit} and never successfully re-applied — the process was
 * killed mid-rewrite, or the user chose "Keep Rewrite" / "Resolve Manually" in the
 * conflict modal). Surfaces a non-modal notification with Pop / Drop / View actions.
 *
 * Dedup: overlapping calls for the same repo share one scan. Dismiss: when the user
 * closes the notification without acting, the current set of abandoned stashes is
 * remembered for the session — a new prompt fires only when an additional compose
 * stash appears.
 */
export async function checkForAbandonedComposeStashes(container: Container, repoPath: string): Promise<void> {
	const inFlight = abandonedStashScans.get(repoPath);
	if (inFlight != null) return inFlight;

	const scan = runAbandonedStashScan(container, repoPath).finally(() => {
		abandonedStashScans.delete(repoPath);
	});
	abandonedStashScans.set(repoPath, scan);
	return scan;
}

async function runAbandonedStashScan(container: Container, repoPath: string): Promise<void> {
	const svc = container.git.getRepositoryService(repoPath);
	if (svc.stash == null) return;

	let stashList;
	try {
		// `includeFiles: false` — we only read `stashName` and `message`. Skipping file
		// details avoids the rename-detection pass and per-stash fileset parsing.
		stashList = await svc.stash.getStash({ includeFiles: false });
	} catch (ex) {
		Logger.error(ex, 'checkForAbandonedComposeStashes');
		return;
	}
	if (stashList?.stashes == null) return;

	const abandoned: { name: string; label: string }[] = [];
	for (const s of stashList.stashes.values()) {
		if (s.stashName == null) continue;
		const msg = s.message ?? '';
		const ix = msg.indexOf(graphComposeStashPrefix);
		if (ix < 0) continue;
		abandoned.push({ name: s.stashName, label: msg.slice(ix) });
	}
	if (abandoned.length === 0) return;

	const dismissed = dismissedStashNames.get(repoPath);
	if (dismissed != null && abandoned.every(a => dismissed.has(a.name))) return;

	const plural = abandoned.length > 1;
	const prompt = plural
		? `GitLens Compose left ${String(abandoned.length)} working-changes stashes that were not restored.`
		: `GitLens Compose left a working-changes stash ("${abandoned[0].label}") that was not restored.`;
	const choices: string[] = plural ? ['View Stashes'] : ['Pop', 'Drop', 'View'];
	const choice = await window.showWarningMessage(prompt, ...choices);
	if (choice == null) {
		const slot = dismissed ?? new Set<string>();
		for (const a of abandoned) {
			slot.add(a.name);
		}
		dismissedStashNames.set(repoPath, slot);
		return;
	}

	if (!plural) {
		const entry = abandoned[0];
		if (choice === 'Pop') {
			try {
				const result = await svc.stash.applyStash(entry.name, { deleteAfter: true, index: true });
				if (result.conflicted) {
					void window.showWarningMessage(`Stash "${entry.label}" popped with conflicts — resolve manually.`);
				}
			} catch (ex) {
				void window.showErrorMessage(
					`Failed to pop stash "${entry.label}": ${ex instanceof Error ? ex.message : String(ex)}`,
				);
			}
			return;
		}
		if (choice === 'Drop') {
			try {
				await svc.stash.deleteStash(entry.name);
			} catch (ex) {
				void window.showErrorMessage(
					`Failed to drop stash "${entry.label}": ${ex instanceof Error ? ex.message : String(ex)}`,
				);
			}
			return;
		}
	}

	// View — reveal the stashes view. Both singular "View" and plural "View Stashes"
	// land here. Per-stash targeting needs a resolved SHA which we deliberately avoid
	// looking up for a dismiss-time action — the stashes view lands the user on the
	// compose stashes anyway (they're grouped by recency).
	void container.views.stashes.show({ preserveFocus: false });
}
