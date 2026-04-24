import { window } from 'vscode';
import { rootSha } from '@gitlens/git/models/revision.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { Container } from '../../../container.js';
import type { CommitResult, ComposeCommitPlan } from './graphService.js';

/**
 * Applies a compose plan by creating unreachable commits from exact per-commit patches
 * and then moving the current branch ref. For `wip-only` plans the rewrite anchors at
 * HEAD; for plans that include unpushed commits the anchor is the parent of the oldest
 * selected commit and the selection range is validated for contiguity. The user's
 * working tree and index are preserved via stash save/pop — no `unstageDirectory(...)`
 * mutation of the real index.
 */
export async function executeComposeCommit(
	container: Container,
	repoPath: string,
	plan: ComposeCommitPlan,
): Promise<CommitResult> {
	const svc = container.git.getRepositoryService(repoPath);
	if (!svc.patch || !svc.ops || !svc.commits || !svc.refs || !svc.branches) {
		return { error: { message: 'Commit operations are not supported in this environment.' } };
	}

	const commits =
		plan.mode === 'up-to' && plan.upToIndex != null ? plan.commits.slice(0, plan.upToIndex + 1) : plan.commits;
	if (commits.length === 0) return { success: true as const };

	// Validate non-empty patches up front — avoids surprising mid-rewrite apply failures.
	for (let i = 0; i < commits.length; i++) {
		if (!commits[i].patch?.trim()) {
			return {
				error: {
					message: `Compose commit ${String(i + 1)} of ${String(
						commits.length,
					)} has no patch content to apply.`,
				},
			};
		}
	}

	// Commits-involving plans must have a validated, contiguous selection.
	if (plan.base.kind === 'commits-only' || plan.base.kind === 'wip+commits') {
		const selected = plan.base.selectedShas ?? [];
		if (selected.length === 0) {
			return { error: { message: 'No commits selected for rewrite.' } };
		}
		const contiguous = await validateContiguousSelection(container, repoPath, selected, plan.base.rewriteFromSha);
		if (!contiguous) {
			return {
				error: {
					message:
						'Compose rewrite requires a contiguous range of unpushed commits rooted at the current branch tip. Select an unbroken run of commits and try again.',
				},
			};
		}
	}

	const branch = await svc.branches.getBranch();
	if (branch == null || branch.remote || branch.detached) {
		return {
			error: { message: 'Compose can only commit on a local branch that is currently checked out.' },
		};
	}
	const branchRef = `refs/heads/${branch.name}`;

	const headBefore = (await svc.commits.getCommit('HEAD'))?.sha;
	if (headBefore == null) {
		return { error: { message: 'Unable to resolve HEAD before rewrite.' } };
	}

	// Stash worktree + index + untracked so the rewrite is applied against a clean state
	// and the user's pre-existing WIP is preserved for re-apply.
	const stashLabel = `gitlens-compose-${new Date().toISOString().replace(/[:.]/g, '-')}`;
	let stashEntryName: string | undefined;
	if (svc.stash != null) {
		try {
			const before = await svc.stash.getStash();
			const beforeRef = before?.stashes.values().next().value?.ref;
			await svc.stash.saveStash(stashLabel, undefined, { includeUntracked: true });
			const after = await svc.stash.getStash();
			const top = after?.stashes.values().next().value;
			if (top != null && top.ref !== beforeRef && (top.message ?? '').endsWith(stashLabel)) {
				stashEntryName = top.stashName;
			}
		} catch (ex) {
			return {
				error: {
					message: `Failed to snapshot working changes before compose: ${
						ex instanceof Error ? ex.message : String(ex)
					}`,
				},
			};
		}
	}

	const popStash = async (): Promise<{ conflicted: boolean } | undefined> => {
		if (stashEntryName == null || svc.stash == null) return undefined;
		// Pop by explicit `stash@{N}` (the git model rejects bare SHAs for pop). The entry
		// we captured above is the one we created; no blind `git stash pop`.
		const result = await svc.stash.applyStash(stashEntryName, { deleteAfter: true, index: true });
		if (!result.conflicted) {
			stashEntryName = undefined;
		}
		return { conflicted: result.conflicted };
	};

	// Rollback: reset HEAD back to its pre-rewrite state, then re-apply the stash. If
	// either step fails, the repo is in an intermediate state — surface the failure so
	// the caller can warn the user; don't swallow silently.
	let rollbackFailure: string | undefined;
	const rollback = async () => {
		try {
			await svc.ops!.reset(headBefore, { mode: 'hard' });
		} catch (ex) {
			rollbackFailure = `reset to pre-compose HEAD failed: ${ex instanceof Error ? ex.message : String(ex)}`;
			Logger.error(ex, 'executeComposeCommit.rollback.reset');
		}
		try {
			await popStash();
		} catch (ex) {
			const popFailure = `stash re-apply failed: ${ex instanceof Error ? ex.message : String(ex)}`;
			rollbackFailure = rollbackFailure != null ? `${rollbackFailure}; ${popFailure}` : popFailure;
			Logger.error(ex, 'executeComposeCommit.rollback.popStash');
		}
	};

	try {
		// For commits-involving plans, chain from the rewrite anchor so
		// `createUnreachableCommitsFromPatches` produces the same tree git would have
		// produced if each patch were committed on top of it.
		const chainBase =
			plan.base.kind === 'wip-only'
				? headBefore
				: plan.base.rewriteFromSha === rootSha
					? undefined
					: plan.base.rewriteFromSha;

		const patches = commits.map(c => ({ message: c.message, patch: c.patch }));
		const newShas = await svc.patch.createUnreachableCommitsFromPatches(chainBase, patches);
		if (newShas.length === 0) {
			await rollback();
			return {
				error: {
					message: composeErrorMessage(
						'No commits were produced from the compose plan.',
						stashLabel,
						rollbackFailure,
					),
				},
			};
		}
		const finalHead = newShas.at(-1)!;

		// Move the branch ref and align the working tree.
		await svc.refs.updateReference(branchRef, finalHead);
		await svc.ops.reset(finalHead, { mode: 'hard' });
	} catch (ex) {
		await rollback();
		return {
			error: {
				message: composeErrorMessage(
					`Compose rewrite failed: ${ex instanceof Error ? ex.message : String(ex)}`,
					stashLabel,
					rollbackFailure,
				),
			},
		};
	}

	// Re-apply the user's original working state on top of the rewritten tip.
	try {
		const popResult = await popStash();
		if (popResult?.conflicted) {
			const choice = await window.showWarningMessage(
				`The compose rewrite succeeded, but re-applying your working changes hit a conflict. Your original state is saved as stash "${stashLabel}".`,
				{ modal: true },
				'Keep Rewrite',
				'Roll Back',
				'Resolve Manually',
			);
			if (choice === 'Roll Back') {
				await rollback();
				return {
					error: {
						message: composeErrorMessage(
							'Compose rewrite rolled back by user after stash conflict.',
							stashLabel,
							rollbackFailure,
						),
					},
				};
			}
			return {
				success: true as const,
				warning: `Working changes left in a conflicted state — resolve in stash "${stashLabel}".`,
			};
		}
	} catch (ex) {
		return {
			success: true as const,
			warning: `Compose committed but restoring working changes failed: ${
				ex instanceof Error ? ex.message : String(ex)
			}. Stash "${stashLabel}" preserved for manual recovery.`,
		};
	}

	return { success: true as const };
}

/**
 * Verifies that `selected` equals (as a set) the commits reachable from HEAD down to the
 * child of `rewriteFromSha`, i.e. that the selection is the full, unbroken run between
 * HEAD and the anchor.
 */
async function validateContiguousSelection(
	container: Container,
	repoPath: string,
	selected: readonly string[],
	rewriteFromSha: string,
): Promise<boolean> {
	const svc = container.git.getRepositoryService(repoPath);
	if (!svc.commits) return false;

	const selectedSet = new Set(selected);
	const head = await svc.commits.getCommit('HEAD');
	let cursor = head;
	const walked = new Set<string>();
	while (cursor != null) {
		walked.add(cursor.sha);
		if (cursor.sha === rewriteFromSha) {
			walked.delete(cursor.sha); // anchor itself is NOT part of the rewritten range
			break;
		}
		const parent = cursor.parents[0];
		if (parent == null) {
			// Hit root before reaching anchor; only valid if anchor is the empty-tree sentinel.
			if (rewriteFromSha !== rootSha) return false;
			break;
		}
		cursor = await svc.commits.getCommit(parent);
	}

	if (walked.size !== selectedSet.size) return false;
	for (const sha of selectedSet) {
		if (!walked.has(sha)) return false;
	}
	return true;
}

/**
 * Composes a user-visible error message that includes recovery guidance when a rollback
 * also failed — so the user knows their stash reference even if the rewrite left the
 * repo in an intermediate state.
 */
function composeErrorMessage(primary: string, stashLabel: string, rollbackFailure: string | undefined): string {
	if (rollbackFailure == null) return primary;
	return `${primary} Additionally, automatic rollback failed (${rollbackFailure}). Your original working changes are in stash "${stashLabel}" — recover via 'git stash list' and pop manually.`;
}

/** Message prefix used by {@link executeComposeCommit} on every stash it creates. */
const composeStashPrefix = 'gitlens-compose-';

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
		const ix = msg.indexOf(composeStashPrefix);
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
