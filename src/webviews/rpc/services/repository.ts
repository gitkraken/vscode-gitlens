/**
 * Repository service — per-repo operations for webviews.
 *
 * Handles all operations scoped to a specific repository:
 * - Commit, branch, and signature queries
 * - WIP/working tree queries
 * - Git actions (stage, unstage, fetch, push, pull, publish, switchBranch)
 * - Per-repo change events (working tree FS changes, filtered repository changes)
 */

import { Disposable, FileSystemError, Uri, window, workspace } from 'vscode';
import type { GitBranch } from '@gitlens/git/models/branch.js';
import { GitCommit } from '@gitlens/git/models/commit.js';
import type { GitFileChange, GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import type { GitFileConflictStatus } from '@gitlens/git/models/fileStatus.js';
import type { RepositoryChange } from '@gitlens/git/models/repository.js';
import { repositoryChanges } from '@gitlens/git/models/repository.js';
import type { CommitSignature } from '@gitlens/git/models/signature.js';
import type { GitStatusFile } from '@gitlens/git/models/statusFile.js';
import type { GitCommitReachability } from '@gitlens/git/providers/commits.js';
import { isConflictStatus } from '@gitlens/git/utils/fileStatus.utils.js';
import { getConflictIncomingRef, resolveConflictFilePaths } from '@gitlens/git/utils/pausedOperationStatus.utils.js';
import { Logger } from '@gitlens/utils/logger.js';
import { normalizePath } from '@gitlens/utils/path.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import { pluralize } from '@gitlens/utils/string.js';
import type { DiffWithCommandArgs } from '../../../commands/diffWith.js';
import type { Container } from '../../../container.js';
import { ProviderNotSupportedError } from '../../../errors.js';
import type { FeatureAccess, PlusFeatures } from '../../../features.js';
import * as BranchActions from '../../../git/actions/branch.js';
import * as RepoActions from '../../../git/actions/repository.js';
import * as StashActions from '../../../git/actions/stash.js';
import { GitUri } from '../../../git/gitUri.js';
import { getCommitSignature } from '../../../git/utils/-webview/commit.utils.js';
import {
	resolveAllConflicts as resolveAllConflictsHelper,
	stageConflictResolution as stageConflictResolutionHelper,
} from '../../../git/utils/-webview/conflictResolution.utils.js';
import { countConflictMarkers } from '../../../git/utils/-webview/mergeConflicts.utils.js';
import { getReferenceFromBranch } from '../../../git/utils/-webview/reference.utils.js';
import { executeCommand, executeCoreCommand } from '../../../system/-webview/command.js';
import { serialize } from '../../../system/serialize.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from '../eventVisibilityBuffer.js';
import { bufferEventHandler } from '../eventVisibilityBuffer.js';
import type { ClassifiedCommitFailure, CommitResult } from './commitFailure.js';
import { buildCommitOutputPreview, classifyCommitFailure } from './commitFailure.js';
import { discardOneWith } from './discard.utils.js';
import type {
	CommitSignatureShape,
	RepositoryChangeEventData,
	SerializedGitBranch,
	SerializedGitCommit,
	SerializedGitFileChange,
	Unsubscribe,
	WipStatus,
	WipSummary,
} from './types.js';

export class RepositoryService {
	constructor(
		private readonly container: Container,
		private readonly buffer: EventVisibilityBuffer | undefined,
		private readonly tracker?: SubscriptionTracker,
	) {}

	// ============================================================
	// Per-repo Events
	// ============================================================

	/**
	 * Watch a repository for working tree file changes (saves, creates, deletes).
	 * Git-level changes (index, head) come via `onRepositoryChanged` instead.
	 * Pure signal — the repoPath is known from the subscription parameter.
	 * @param repoPath - Repository to watch
	 * @param callback - Called when working tree files change
	 * @returns Unsubscribe function that stops watching
	 */
	onRepositoryWorkingChanged(repoPath: string, callback: () => void): Unsubscribe {
		const repo = this.container.git.getRepository(repoPath);
		if (repo == null) return () => {};

		const pendingKey = Symbol(`repositoryWorking:${repoPath}`);
		const buffered = bufferEventHandler<undefined>(this.buffer, pendingKey, callback, 'signal', undefined);
		const disposable = Disposable.from(
			repo.watchWorkingTree(1000),
			repo.onDidChangeWorkingTree(() => buffered(undefined)),
		);
		const unsubscribe = () => {
			this.buffer?.removePending(pendingKey);
			disposable.dispose();
		};
		return this.tracker != null ? this.tracker.track(unsubscribe) : unsubscribe;
	}

	/**
	 * Fired when a specific repository changes (branches, commits, etc.).
	 * Filtered to only fire for the specified repo.
	 * When gated (hidden webview), changes are aggregated and
	 * replayed on visibility restore with the union of all change types.
	 * @param repoPath - Repository to watch for changes
	 * @param callback - Called with change event data
	 * @returns Unsubscribe function that stops watching
	 */
	onRepositoryChanged(repoPath: string, callback: (data: RepositoryChangeEventData) => void): Unsubscribe {
		const pendingKey = Symbol(`repositoryChanged:${repoPath}`);
		const pendingChanges = new Set<RepositoryChange>();
		let pendingUri: string | undefined;

		const disposable = this.container.git.onDidChangeRepository(e => {
			if (e.repository.path !== repoPath) return;

			const data: RepositoryChangeEventData = {
				repoPath: e.repository.path,
				repoUri: e.repository.uri.toString(),
				changes: extractRepositoryChanges(e),
			};
			if (!this.buffer || this.buffer.visible) {
				callback(data);
			} else {
				pendingUri = data.repoUri;
				for (const c of data.changes) {
					pendingChanges.add(c);
				}
				this.buffer.addPending(pendingKey, () => {
					callback({ repoPath: repoPath, repoUri: pendingUri!, changes: [...pendingChanges] });
					pendingChanges.clear();
					pendingUri = undefined;
				});
			}
		});
		const unsubscribe = () => {
			this.buffer?.removePending(pendingKey);
			pendingChanges.clear();
			disposable.dispose();
		};
		return this.tracker != null ? this.tracker.track(unsubscribe) : unsubscribe;
	}

	// ============================================================
	// Commit & Branch Queries
	// ============================================================

	async getCommit(repoPath: string, sha: string): Promise<SerializedGitCommit | undefined> {
		const commit = await this.container.git.getRepositoryService(repoPath).commits.getCommit(sha);
		return commit != null ? serializeCommit(commit) : undefined;
	}

	async getCommitFiles(repoPath: string, sha: string): Promise<SerializedGitFileChange[]> {
		const commit = await this.container.git.getRepositoryService(repoPath).commits.getCommit(sha);
		if (commit == null) return [];

		await GitCommit.ensureFullDetails(commit);
		const files = commit.fileset?.files;
		if (files == null || files.length === 0) return [];
		return files.map(serializeFileChange);
	}

	async getBranch(repoPath: string, name: string): Promise<SerializedGitBranch | undefined> {
		const branch = await this.container.git.getRepositoryService(repoPath).branches.getBranch(name);
		return branch != null ? serializeBranch(branch) : undefined;
	}

	async getCurrentBranch(repoPath: string): Promise<SerializedGitBranch | undefined> {
		const branch = await this.container.git.getRepositoryService(repoPath).branches.getBranch();
		return branch != null ? serializeBranch(branch) : undefined;
	}

	async getCommitReachability(
		repoPath: string,
		sha: string,
		signal?: AbortSignal,
	): Promise<GitCommitReachability | undefined> {
		return this.container.git.getRepositoryService(repoPath).commits.getCommitReachability?.(sha, signal);
	}

	async getCommitSignature(
		repoPath: string,
		sha: string,
		signal?: AbortSignal,
	): Promise<CommitSignatureShape | undefined> {
		signal?.throwIfAborted();
		const signature = await getCommitSignature(repoPath, sha);
		signal?.throwIfAborted();
		return signature != null ? serializeSignature(signature) : undefined;
	}

	async getFeatureAccess(feature: PlusFeatures, repoUri?: string): Promise<FeatureAccess> {
		const access =
			repoUri != null
				? await this.container.git.access(feature, Uri.parse(repoUri))
				: await this.container.git.access(feature);
		return serialize(access);
	}

	async hasRemotes(repoPath: string): Promise<boolean> {
		const remotes = await this.container.git.getRepositoryService(repoPath).remotes.getRemotes();
		return remotes.length > 0;
	}

	// ============================================================
	// Git Actions
	// ============================================================

	/**
	 * Stage a file. When the file is conflicted and still contains conflict markers, prompts
	 * the user before staging so they don't accidentally commit unresolved markers.
	 */
	async stageFile(file: GitFileChangeShape): Promise<void> {
		if (isConflictStatus(file.status)) {
			const uri = Uri.joinPath(Uri.file(file.repoPath), file.path);
			const markers = await countConflictMarkers(uri);
			if (markers > 0 && !(await this.confirmStageWithConflictMarkers(uri, file.path, markers))) {
				return;
			}
		}

		await this.container.git.getRepositoryService(file.repoPath).staging?.stageFile(file.path);
	}

	/**
	 * Unstage a file.
	 */
	async unstageFile(file: GitFileChangeShape): Promise<void> {
		await this.container.git.getRepositoryService(file.repoPath).staging?.unstageFile(file.path);
	}

	/**
	 * Stage a set of files in ONE atomic `git add` (multi-select). Using the batch rather than N
	 * concurrent {@link stageFile} calls avoids `.git/index.lock` contention that would silently leave
	 * some files unstaged. All files are assumed to share a repo (the file tree is per-repo).
	 */
	async stageFiles(files: GitFileChangeShape[]): Promise<void> {
		if (!files.length) return;

		await this.container.git.getRepositoryService(files[0].repoPath).staging?.stageFiles(files.map(f => f.path));
	}

	/**
	 * Unstage a set of files in ONE atomic `git reset` (multi-select) — see {@link stageFiles} for why
	 * the batch is used instead of N concurrent {@link unstageFile} calls.
	 */
	async unstageFiles(files: GitFileChangeShape[]): Promise<void> {
		if (!files.length) return;

		await this.container.git.getRepositoryService(files[0].repoPath).staging?.unstageFiles(files.map(f => f.path));
	}

	// Stash the working-tree changes of a single file (or set). Routes through the shared stash-push
	// action (its confirm/message wizard), `includeUntracked` so a new file can be stashed too.
	async stashFile(file: GitFileChangeShape): Promise<void> {
		await StashActions.push(file.repoPath, [Uri.joinPath(Uri.file(file.repoPath), file.path)], undefined, true);
	}

	async stashFiles(files: GitFileChangeShape[]): Promise<void> {
		if (!files.length) return;

		const uris = files.map(f => Uri.joinPath(Uri.file(f.repoPath), f.path));
		await StashActions.push(files[0].repoPath, uris, undefined, true);
	}

	/**
	 * Open the rebase-editor-style conflict changes diff for a paused-operation conflicted file.
	 * `side='current'` shows the user's working-tree side vs the merge-base; `side='incoming'`
	 * shows the incoming (theirs) side vs the merge-base.
	 */
	async openConflictChanges(file: GitFileChangeShape, side: 'current' | 'incoming'): Promise<void> {
		const normalizedPath = normalizePath(file.path);
		const svc = this.container.git.getRepositoryService(file.repoPath);
		const pausedStatus = await svc.pausedOps?.getPausedOperationStatus?.();
		if (pausedStatus?.mergeBase == null) {
			Logger.warn('openConflictChanges: paused-operation status or merge-base unavailable');
			void window.showWarningMessage('Unable to open conflict changes — operation status unavailable');
			return;
		}

		const incomingRef = getConflictIncomingRef(pausedStatus) ?? pausedStatus.HEAD.ref;
		const mergeBase = pausedStatus.mergeBase;

		// Resolve rename-aware paths (mirrors mergeConflictFileNode.ts pattern)
		const [currentFilesResult, incomingFilesResult] = await Promise.allSettled([
			svc.diff.getDiffStatus(mergeBase, 'HEAD', { renameLimit: 0 }),
			svc.diff.getDiffStatus(mergeBase, incomingRef, { renameLimit: 0 }),
		]);
		const currentFiles = getSettledValue(currentFilesResult);
		const incomingFiles = getSettledValue(incomingFilesResult);

		let lhsPath: string;
		let rhsPath: string;
		if (side === 'current') {
			({ lhsPath, rhsPath } = resolveConflictFilePaths(currentFiles, incomingFiles, normalizedPath));
		} else {
			// Swap: when viewing incoming changes, "my side" is the incoming ref
			({ lhsPath, rhsPath } = resolveConflictFilePaths(incomingFiles, currentFiles, normalizedPath));
		}

		const ref = side === 'current' ? 'HEAD' : incomingRef;

		await executeCommand<DiffWithCommandArgs>('gitlens.diffWith', {
			lhs: {
				sha: mergeBase,
				uri: GitUri.fromFile(lhsPath, file.repoPath, mergeBase),
				title: `${lhsPath} (merge-base)`,
			},
			rhs: {
				sha: ref,
				uri: GitUri.fromFile(rhsPath, file.repoPath, ref),
				title: `${rhsPath} (${side === 'current' ? 'current' : 'incoming'})`,
			},
			repoPath: file.repoPath,
			showOptions: { preserveFocus: false, preview: true },
		});
	}

	/**
	 * Stage all working tree changes. When any conflicted file still contains conflict markers,
	 * prompts the user once before staging the batch.
	 */
	async stageAll(repoPath: string): Promise<void> {
		const svc = this.container.git.getRepositoryService(repoPath);
		const status = await svc.status.getStatus();
		if (status?.hasConflicts) {
			const conflictedPaths = status.files.filter(f => isConflictStatus(f.status)).map(f => f.path);
			if (conflictedPaths.length > 0) {
				const counts = await Promise.allSettled(
					conflictedPaths.map(p => countConflictMarkers(Uri.joinPath(Uri.file(repoPath), p))),
				);
				const filesWithMarkers = conflictedPaths.filter((_, i) => (getSettledValue(counts[i]) ?? 0) > 0).length;
				if (filesWithMarkers > 0 && !(await this.confirmStageAllWithConflictMarkers(filesWithMarkers))) {
					return;
				}
			}
		}

		await svc.staging?.stageAll();
	}

	private async confirmStageWithConflictMarkers(uri: Uri, path: string, markers: number): Promise<boolean> {
		const stage = 'Stage Anyway';
		const open = 'Open File';
		const choice = await window.showWarningMessage(
			`"${path}" still contains ${pluralize('unresolved conflict marker', markers)}. Staging will commit them as-is.`,
			{ modal: true },
			stage,
			open,
		);
		if (choice === open) {
			await executeCoreCommand('vscode.open', uri);
			return false;
		}
		return choice === stage;
	}

	private async confirmStageAllWithConflictMarkers(fileCount: number): Promise<boolean> {
		const stage = 'Stage All Anyway';
		const choice = await window.showWarningMessage(
			`${pluralize('file', fileCount)} still ${fileCount === 1 ? 'contains' : 'contain'} unresolved conflict markers. Staging will commit them as-is.`,
			{ modal: true },
			stage,
		);
		return choice === stage;
	}

	/**
	 * Resolve a single conflicted file by taking either the current (HEAD/ours) or incoming
	 * (theirs) side, then stage it. Operation-agnostic — works for any paused operation type
	 * (rebase, merge, cherry-pick, revert).
	 */
	async stageConflictResolution(
		file: GitFileChangeShape & { status: GitFileConflictStatus },
		resolution: 'current' | 'incoming',
	): Promise<void> {
		await stageConflictResolutionHelper(this.container, file, resolution);
	}

	/**
	 * Resolve every conflicted file at once by staging the requested side. Currently scoped to
	 * paused rebases.
	 */
	async resolveAllConflicts(repoPath: string, resolution: 'current' | 'incoming'): Promise<void> {
		await resolveAllConflictsHelper(this.container, repoPath, resolution);
	}

	/**
	 * Unstage all staged changes.
	 */
	async unstageAll(repoPath: string): Promise<void> {
		await this.container.git.getRepositoryService(repoPath).staging?.unstageAll();
	}

	async discardFile(file: GitFileChangeShape): Promise<void> {
		const svc = this.container.git.getRepositoryService(file.repoPath);

		// Authoritative re-read — the wire snapshot can be stale by the time the user confirms,
		// and mis-detecting `mixed` is the difference between preserving and nuking staged content.
		// Scoped to this one path (git pathspec) so a per-file discard doesn't pay for a full
		// working-tree status scan.
		const fresh = await svc.status.getStatusForFile?.(file.path);

		// File vanished from status between snapshot and click (committed/unstaged elsewhere) —
		// bail rather than apply the destructive op against stale wire data: the user's intent
		// no longer maps onto a current state we can reason about.
		if (fresh == null) {
			Logger.warn(`Discard skipped for "${file.path}": file is no longer in working-tree status.`);
			return;
		}

		const confirmed = await this.confirmDiscardChanges(file.path, fresh.mixed);
		if (!confirmed) return;

		try {
			await this.discardOne(svc, fresh);
		} catch (ex) {
			Logger.error(ex, 'Failed to discard changes');
			void window.showErrorMessage(
				`Failed to discard changes in "${fresh.path}": ${ex instanceof Error ? ex.message : String(ex)}`,
			);
			throw ex;
		}
	}

	/**
	 * Discards a single file's working-tree changes per its status — the destructive core shared by
	 * per-file ({@link discardFile}) and bulk-staged ({@link discardStagedFiles}) discard. Throws on
	 * failure and shows no UI; the caller owns confirmation and error presentation.
	 *
	 * Takes the authoritative {@link GitStatusFile} (a freshly-read status entry) and branches off it
	 * exclusively — never a stale wire snapshot — so mixed-detection AND status/rename classification
	 * see the same current state.
	 *
	 * - **Mixed** (staged + unstaged): trash the working-tree copy, then restore the working tree
	 *   from the INDEX — drops the unstaged delta, preserves the staged portion (a second discard,
	 *   now non-mixed, fully reverts).
	 * - **Untracked / staged-added**: trash only — the file isn't in HEAD, so there's nothing to
	 *   restore (and no provider-ops requirement).
	 * - **Everything else** (modified, deleted, renamed/copied): trash + unstage, then restore from
	 *   HEAD (resets index and working tree). R/C target the original path.
	 */
	private discardOne(svc: ReturnType<Container['git']['getRepositoryService']>, file: GitStatusFile): Promise<void> {
		// Orchestration lives in `discardOneWith` (testable against a real repo without the Container);
		// here we just bind the git side-effects to the per-repo service.
		return discardOneWith(
			{
				canRestore: svc.ops?.restore != null,
				providerName: svc.provider.name,
				moveToTrash: uri => this.moveToTrash(uri),
				unstage: async path => {
					await svc.staging?.unstageFile(path);
				},
				restore: (path, options) => svc.ops!.restore(path, options),
			},
			file,
		);
	}

	async discardUnstagedFiles(repoPath: string): Promise<void> {
		const svc = this.container.git.getRepositoryService(repoPath);
		const status = await svc.status.getStatus();
		if (status == null) return;

		// Single-pass classification: every file with working-tree changes (purely-unstaged or
		// mixed), excluding conflicts. Mixed files have their unstaged delta dropped while staged
		// content is preserved — the user would need to discard the now-purely-staged file via the
		// per-file action to fully revert (the bulk filter won't pick it up a second time).
		const untracked: GitStatusFile[] = [];
		const trackedPureUnstaged: GitStatusFile[] = [];
		const mixed: GitStatusFile[] = [];
		const toTrash: GitStatusFile[] = [];
		for (const f of status.files) {
			if (f.workingTreeStatus == null || f.conflictStatus != null) continue;

			if (f.mixed) {
				mixed.push(f);
			} else if (f.status === '?') {
				untracked.push(f);
			} else {
				trackedPureUnstaged.push(f);
			}
			// Move non-deleted working-tree files to trash so versions are recoverable.
			// Gate on `workingTreeStatus` directly: for mixed files `f.status` reflects indexStatus
			// (e.g. 'M' when the WT is actually deleted), so checking `f.status !== 'D'` is wrong.
			if (f.workingTreeStatus !== 'D') {
				toTrash.push(f);
			}
		}
		if (untracked.length === 0 && trackedPureUnstaged.length === 0 && mixed.length === 0) return;

		const confirmed = await this.confirmDiscardUnstaged(trackedPureUnstaged.length, untracked.length, mixed.length);
		if (!confirmed) return;

		try {
			// Preflight: refuse to trash anything if any file will need a restore (from-index for
			// mixed, from-HEAD for tracked) but the provider can't restore. Covers both restore
			// batches below, not just mixed, and matches the per-file path's preflight so the two
			// never disagree about when discard is supported. (Untracked files only trash, so a
			// purely-untracked batch needs no provider ops.)
			if ((mixed.length > 0 || trackedPureUnstaged.length > 0) && svc.ops?.restore == null) {
				throw new ProviderNotSupportedError(svc.provider.name);
			}

			// Move working-tree files to trash so versions are recoverable (already gated on
			// workingTreeStatus !== 'D' during the classification pass above).
			const trashResults = await Promise.allSettled(
				toTrash.map(f => this.moveToTrash(Uri.joinPath(Uri.file(repoPath), f.path))),
			);
			for (const r of trashResults) {
				if (r.status === 'rejected') {
					Logger.warn(`Failed to move file to trash: ${r.reason}`);
				}
			}

			// Track restore failures so we can surface an aggregate warning at the end — files have
			// already been removed from the working tree by the trash step (and on trash-unavailable
			// providers `moveToTrash` falls back to a hard delete, so there's no Trash safety net),
			// so a silent failure would leave the user thinking discard succeeded while files are
			// missing from disk.
			const failed: string[] = [];

			// Restore tracked, purely-unstaged files from HEAD (drops working-tree changes).
			// 'A' (added) never appears with staged=false in practice — git reports unstaged new
			// files as '?'; the guard is defensive. R/C: target originalPath because the rename
			// hasn't been staged.
			const headRestorePaths = trackedPureUnstaged
				.filter(f => f.status !== 'A')
				.map(f => (f.status === 'R' || f.status === 'C' ? (f.originalPath ?? f.path) : f.path));
			failed.push(...(await this.restoreFromGit(svc, headRestorePaths, { ref: 'HEAD' })));

			// Restore mixed files from the INDEX (drops only the working-tree delta; staged content
			// stays put). Targets `f.path`: for renames the index has the rename, so checkout-from-
			// index resolves to the new path correctly (originalPath only applies when restoring
			// from HEAD, which this branch does not do).
			failed.push(
				...(await this.restoreFromGit(
					svc,
					mixed.map(f => f.path),
				)),
			);

			this.warnDiscardRestoreFailures(failed);
		} catch (ex) {
			Logger.error(ex, 'Failed to discard unstaged changes');
			void window.showErrorMessage(
				`Failed to discard unstaged changes: ${ex instanceof Error ? ex.message : String(ex)}`,
			);
			throw ex;
		}
	}

	/**
	 * Discards the working-tree changes of a SELECTED subset of files (multi-select inline discard)
	 * with ONE combined confirmation — mirrors {@link discardUnstagedFiles} but scoped to the requested
	 * paths. Re-reads authoritative status, classifies untracked/unstaged/mixed/conflicted (pure-staged
	 * files are skipped — a working-tree discard has nothing to drop for them), confirms once, then
	 * reverts each via the shared {@link discardOne} core (conflicts revert to our/HEAD side or are
	 * removed — see {@link discardOneWith}). Destructive: working-tree changes are permanently lost.
	 */
	async discardFiles(files: GitFileChangeShape[]): Promise<void> {
		if (files.length === 0) return;

		const svc = this.container.git.getRepositoryService(files[0].repoPath);
		const status = await svc.status.getStatus();
		if (status == null) return;

		// Authoritative re-read scoped to the requested paths. Conflicted files are discarded too
		// (reverted to our/HEAD side or removed — see discardOne); pure-staged files have no working-tree
		// delta so they fall out here (the working-tree discard is a no-op for them).
		const requested = new Set(files.map(f => f.path));
		const untracked: GitStatusFile[] = [];
		const trackedPureUnstaged: GitStatusFile[] = [];
		const mixed: GitStatusFile[] = [];
		const conflicted: GitStatusFile[] = [];
		for (const f of status.files) {
			if (!requested.has(f.path)) continue;

			if (f.conflictStatus != null) {
				conflicted.push(f);
			} else if (f.workingTreeStatus == null) {
				continue;
			} else if (f.mixed) {
				mixed.push(f);
			} else if (f.status === '?') {
				untracked.push(f);
			} else {
				trackedPureUnstaged.push(f);
			}
		}

		const toDiscard = [...untracked, ...trackedPureUnstaged, ...mixed, ...conflicted];
		if (toDiscard.length === 0) return;

		// One standard confirm for the whole selection (it may mix normal + conflicted files); conflicts
		// count with the tracked total.
		const confirmed = await this.confirmDiscardUnstaged(
			trackedPureUnstaged.length + conflicted.length,
			untracked.length,
			mixed.length,
		);
		if (!confirmed) return;

		try {
			// Preflight `ops.restore` before trashing anything (matches the per-file and bulk paths), so
			// a provider without restore fails fast instead of leaving files in the Trash unrecoverable.
			if (
				(mixed.length > 0 || trackedPureUnstaged.length > 0 || conflicted.length > 0) &&
				svc.ops?.restore == null
			) {
				throw new ProviderNotSupportedError(svc.provider.name);
			}

			// Reuse the per-file core so each file is reverted exactly as the single discard would.
			const failed: string[] = [];
			for (const f of toDiscard) {
				try {
					await this.discardOne(svc, f);
				} catch (ex) {
					Logger.warn(`Failed to discard changes in ${f.path}: ${ex}`);
					failed.push(f.path);
				}
			}

			this.warnDiscardRestoreFailures(failed);
		} catch (ex) {
			Logger.error(ex, 'Failed to discard changes');
			void window.showErrorMessage(`Failed to discard changes: ${ex instanceof Error ? ex.message : String(ex)}`);
			throw ex;
		}
	}

	/**
	 * Bulk-discards staged changes — the counterpart the WIP toolbar button morphs to when the
	 * working tree has only staged content (nothing unstaged left to discard). Reverts each
	 * pure-staged file to HEAD via the shared {@link discardOne} core, so behavior matches the
	 * per-file discard of a staged file exactly. Mixed files are intentionally excluded (they have
	 * working-tree changes and belong to the unstaged path); so are conflicts.
	 */
	async discardStagedFiles(repoPath: string): Promise<void> {
		const svc = this.container.git.getRepositoryService(repoPath);
		const status = await svc.status.getStatus();
		if (status == null) return;

		// Pure-staged, non-conflicted files: index dirty, working tree clean. (Mixed files have a
		// working-tree status and are handled by discardUnstagedFiles.)
		const staged = status.files.filter(
			f => f.indexStatus != null && f.workingTreeStatus == null && f.conflictStatus == null,
		);
		if (staged.length === 0) return;

		const confirmed = await this.confirmDiscardStaged(staged.length);
		if (!confirmed) return;

		try {
			// Staged additions aren't in HEAD (trash + unstage handles them); everything else needs
			// a HEAD restore. Preflight `ops.restore` only when such a file exists, matching the
			// unstaged path's conditional preflight.
			if (staged.some(f => f.indexStatus !== 'A') && svc.ops?.restore == null) {
				throw new ProviderNotSupportedError(svc.provider.name);
			}

			// Reuse the per-file core so staged bulk discard handles A/D/M/R exactly as the per-file
			// action does (trash for recovery, unstage, restore from HEAD). Per-file git calls rather
			// than one batch — staged-only sets are typically small; collect failures for one warning.
			const failed: string[] = [];
			for (const f of staged) {
				try {
					await this.discardOne(svc, f);
				} catch (ex) {
					Logger.warn(`Failed to discard staged changes in ${f.path}: ${ex}`);
					failed.push(f.path);
				}
			}

			this.warnDiscardRestoreFailures(failed);
		} catch (ex) {
			Logger.error(ex, 'Failed to discard staged changes');
			void window.showErrorMessage(
				`Failed to discard staged changes: ${ex instanceof Error ? ex.message : String(ex)}`,
			);
			throw ex;
		}
	}

	/**
	 * Surface paths that were removed during a bulk discard but couldn't be restored to their git
	 * version (e.g. transient `index.lock` contention, a locked/permissioned file). State the facts
	 * honestly — the files are missing from the working tree but recoverable from git (HEAD for
	 * tracked, index for staged) — without prescribing an action: the only in-product "recovery" is
	 * discarding the resulting deletion, and "discard it to bring it back" is too confusing to put
	 * in front of a user. Deliberately doesn't promise the Trash either: `moveToTrash` hard-deletes
	 * on trash-unavailable providers.
	 */
	private warnDiscardRestoreFailures(failed: string[]): void {
		if (failed.length === 0) return;

		const preview = failed.slice(0, 3).join(', ');
		const more = failed.length > 3 ? `, and ${failed.length - 3} more` : '';
		const they = failed.length === 1 ? "it's" : "they're";
		const their = failed.length === 1 ? 'its' : 'their';
		void window.showWarningMessage(
			`Couldn't restore ${pluralize('file', failed.length)} after discard: ${preview}${more} — ${they} missing from the working tree, but ${their} content is recoverable from Git.`,
		);
	}

	/**
	 * Restore paths in one batched git invocation (fast path), falling back to per-path restores if
	 * the batch throws — so a single unrestorable path can't strand the rest. This matters most on
	 * trash-unavailable providers, where the files have already been hard-deleted from the working
	 * tree and a wholesale batch failure would otherwise leave many of them missing at once.
	 * Returns the paths that still failed individually. Callers must have preflighted `ops.restore`.
	 */
	private async restoreFromGit(
		svc: ReturnType<Container['git']['getRepositoryService']>,
		paths: string[],
		options?: { ref?: string },
	): Promise<string[]> {
		if (paths.length === 0) return [];

		try {
			await svc.ops!.restore(paths, options);
			return [];
		} catch (batchEx) {
			Logger.warn(`Batch restore failed; retrying ${paths.length} path(s) individually: ${batchEx}`);
			const failed: string[] = [];
			for (const path of paths) {
				try {
					await svc.ops!.restore(path, options);
				} catch (ex) {
					Logger.warn(
						`Failed to restore ${path} ${options?.ref != null ? `from ${options.ref}` : 'from index'}: ${ex}`,
					);
					failed.push(path);
				}
			}
			return failed;
		}
	}

	private async confirmDiscardChanges(path: string, isMixed: boolean = false): Promise<boolean> {
		// Mixed: only the working-tree delta is discarded; the staged portion survives. Make that
		// expectation explicit so users aren't surprised when staged changes remain — and so they
		// understand a second discard is needed to fully revert.
		if (isMixed) {
			const discard = 'Discard Unstaged Changes';
			const choice = await window.showWarningMessage(
				`Are you sure you want to discard the unstaged changes in "${path}"?\n\nThe staged changes will be preserved — discard again to remove them.\nThis is IRREVERSIBLE!\nYour unstaged changes will be FOREVER LOST if you proceed.`,
				{ modal: true },
				discard,
			);
			return choice === discard;
		}

		const discard = 'Discard Changes';
		const choice = await window.showWarningMessage(
			`Are you sure you want to discard changes in "${path}"?\n\nThis is IRREVERSIBLE!\nYour current changes will be FOREVER LOST if you proceed.`,
			{ modal: true },
			discard,
		);
		return choice === discard;
	}

	private async confirmDiscardStaged(fileCount: number): Promise<boolean> {
		const discard = 'Discard Staged Changes';
		const choice = await window.showWarningMessage(
			`Are you sure you want to discard staged changes in ${pluralize('file', fileCount)}?\n\nThis is IRREVERSIBLE!\nYour staged changes will be FOREVER LOST if you proceed.`,
			{ modal: true },
			discard,
		);
		return choice === discard;
	}

	private async confirmDiscardUnstaged(
		trackedCount: number,
		untrackedCount: number,
		mixedCount: number = 0,
	): Promise<boolean> {
		// Lead with a unified question keyed off the total, then layer on caveats per category.
		// Collecting non-empty sections and joining with blank lines avoids the per-section
		// "remember to push '' first" blank-line bookkeeping the earlier shape needed.
		const totalCount = trackedCount + untrackedCount + mixedCount;
		const sections: string[] = [
			`Are you sure you want to discard unstaged changes in ${pluralize('file', totalCount)}?`,
		];
		if (untrackedCount > 0) {
			// Don't promise the Trash — `moveToTrash` hard-deletes on trash-unavailable providers,
			// and untracked files aren't in Git, so there's no other recovery path. The IRREVERSIBLE
			// line below is the honest worst case.
			sections.push(`This will DELETE ${pluralize('untracked file', untrackedCount)}.`);
		}
		if (mixedCount > 0) {
			// The bulk filter excludes purely-staged files, so a second click of the bulk button
			// won't pick these up — point users at the per-file discard for the staged portion.
			sections.push(
				`${pluralize('file', mixedCount)} also ${mixedCount === 1 ? 'has' : 'have'} staged changes — only ${mixedCount === 1 ? 'its' : 'their'} unstaged portion will be discarded. To also discard the staged portion, run the per-file discard action.`,
			);
		}
		sections.push('This is IRREVERSIBLE!\nYour current working set will be FOREVER LOST if you proceed.');

		// Label switches to the verb form (no count) whenever ANY mixed file is in the batch —
		// the count form would mis-describe mixed entries as "Unstaged Files" since those get
		// partial discards, not full ones. The verb form is honest for any batch size and
		// composition that includes mixed files.
		const discard =
			mixedCount > 0 ? 'Discard Unstaged Changes' : `Discard ${pluralize('Unstaged File', totalCount)}`;
		const choice = await window.showWarningMessage(sections.join('\n\n'), { modal: true }, discard);
		return choice === discard;
	}

	private async moveToTrash(uri: Uri): Promise<void> {
		try {
			await workspace.fs.delete(uri, { useTrash: true });
		} catch (ex) {
			// Nothing on disk (e.g. a both-deleted conflict, where neither side keeps a working copy) —
			// discard has nothing to trash, so treat it as done.
			if (ex instanceof FileSystemError && ex.code === 'FileNotFound') return;

			// Some filesystem providers (SSH-remote, dev containers, virtual FS) don't implement
			// trash. Fall back to a direct delete — the user already accepted the IRREVERSIBLE
			// warning in confirmDiscardChanges, so losing the recovery path is in policy.
			const msg = ex instanceof Error ? ex.message : String(ex);
			if (!msg.includes('via trash because provider does not support')) throw ex;

			Logger.warn(`Trash unsupported for ${uri.toString()}; deleting without trash`);
			await workspace.fs.delete(uri, { useTrash: false });
		}
	}

	/**
	 * Commit staged changes. Never throws for git failures — returns a discriminated
	 * {@link CommitResult} so the webview can drive its error UX without depending on
	 * exception fidelity surviving RPC serialization. On failure, the classified error is
	 * presented host-side (modal + optional full-output document) as a fire-and-forget effect.
	 */
	async commit(
		repoPath: string,
		message: string,
		options?: { all?: boolean; amend?: boolean },
	): Promise<CommitResult> {
		try {
			await this.container.git.getRepositoryService(repoPath).ops?.commit(message, options);
			return { status: 'committed' };
		} catch (ex) {
			const failure = classifyCommitFailure(ex);
			// Present asynchronously so the webview spinner stops the instant the commit fails,
			// rather than spinning while the modal sits open. The captured output is held in the
			// closure, so no caching/lifecycle is needed.
			void presentCommitFailure(failure);

			return {
				status: 'failed',
				reason: failure.reason,
				summary: failure.summary,
				hasOutput: failure.output != null && failure.output.length > 0,
			};
		}
	}

	/**
	 * Get the last commit message (for amend mode).
	 */
	async getLastCommitMessage(repoPath: string): Promise<string | undefined> {
		const commit = await this.container.git.getRepositoryService(repoPath).commits.getCommit('HEAD');
		return commit?.message;
	}

	/**
	 * Fetch from remote.
	 */
	async fetch(repoPath: string): Promise<void> {
		const repo = this.container.git.getRepository(repoPath);
		await RepoActions.fetch(repo ?? repoPath);
	}

	/**
	 * Push to remote.
	 */
	async push(repoPath: string, force?: boolean): Promise<void> {
		const repo = this.container.git.getRepository(repoPath);
		await RepoActions.push(repo ?? repoPath, force);
	}

	async publishBranch(repoPath: string): Promise<void> {
		const branch = await this.container.git.getRepositoryService(repoPath).branches.getBranch();
		if (branch == null) return;

		const repo = this.container.git.getRepository(repoPath);
		await RepoActions.push(repo ?? repoPath, undefined, getReferenceFromBranch(branch));
	}

	/**
	 * Pull from remote.
	 */
	async pull(repoPath: string): Promise<void> {
		const repo = this.container.git.getRepository(repoPath);
		await RepoActions.pull(repo ?? repoPath);
	}

	/**
	 * Switch branches.
	 */
	async switchBranch(repoPath: string): Promise<void> {
		const repo = this.container.git.getRepository(repoPath);
		await RepoActions.switchTo(repo ?? repoPath);
	}

	/**
	 * Create a new branch.
	 */
	async createBranch(repoPath: string): Promise<void> {
		const repo = this.container.git.getRepository(repoPath);
		await BranchActions.create(repo ?? repoPath);
	}

	// ============================================================
	// Working Tree / WIP Queries
	// ============================================================

	/**
	 * Get a lightweight WIP summary for a repository (diff stats, conflicts, paused op status).
	 * Used by Home overview for per-branch WIP display.
	 */
	async getWipSummary(repoPath: string): Promise<WipSummary | undefined> {
		const [statusResult, pausedOpResult] = await Promise.allSettled([
			this.container.git.getRepositoryService(repoPath).status.getStatus(),
			this.container.git.getRepositoryService(repoPath).pausedOps?.getPausedOperationStatus?.(),
		]);

		const status = getSettledValue(statusResult);
		if (status == null) return undefined;

		return {
			workingTreeState: status.diffStatus,
			hasConflicts: status.hasConflicts,
			conflictsCount: status.conflicts.length,
			pausedOpStatus: getSettledValue(pausedOpResult),
		};
	}

	/**
	 * Get full working tree status (file list + branch + summary).
	 * Used by Commit Details for WIP file display, Timeline for pseudo-commits.
	 */
	async getWipStatus(repoPath: string): Promise<WipStatus | undefined> {
		const status = await this.container.git.getRepositoryService(repoPath).status.getStatus();
		if (status == null) return undefined;

		return {
			branch: status.branch,
			files: status.files.map(f => serializeStatusFile(f)),
			summary: {
				workingTreeState: status.diffStatus,
				hasConflicts: status.hasConflicts,
				conflictsCount: status.conflicts.length,
			},
		};
	}
}

// ============================================================
// Shared Helpers
// ============================================================

export function extractRepositoryChanges(e: { changed(change: RepositoryChange): boolean }): RepositoryChange[] {
	const changes: RepositoryChange[] = [];
	for (const change of repositoryChanges) {
		if (e.changed(change)) {
			changes.push(change);
		}
	}
	return changes;
}

// ============================================================
// Serialization Helpers
// ============================================================

function serializeCommit(commit: GitCommit): SerializedGitCommit {
	return {
		sha: commit.sha,
		shortSha: commit.shortSha,
		repoPath: commit.repoPath,
		author: { name: commit.author.name, email: commit.author.email, date: commit.author.date.getTime() },
		committer: {
			name: commit.committer.name,
			email: commit.committer.email,
			date: commit.committer.date.getTime(),
		},
		parents: commit.parents,
		message: commit.message,
		summary: commit.summary,
		stashNumber: commit.stashNumber,
		stashOnRef: commit.stashOnRef,
		refType: commit.refType,
	};
}

function serializeBranch(branch: GitBranch): SerializedGitBranch {
	return {
		repoPath: branch.repoPath,
		id: branch.id,
		name: branch.name,
		refName: branch.refName,
		remote: branch.remote,
		current: branch.current,
		date: branch.date?.getTime(),
		sha: branch.sha,
		upstream: branch.upstream,
		detached: branch.detached,
		rebasing: branch.rebasing,
		worktree: branch.worktree,
	};
}

function serializeSignature(signature: CommitSignature): CommitSignatureShape {
	return {
		status: signature.status,
		format: signature.format,
		signer: signature.signer,
		keyId: signature.keyId,
		fingerprint: signature.fingerprint,
		trustLevel: signature.trustLevel,
		errorMessage: signature.errorMessage,
	};
}

function serializeFileChange(file: GitFileChange): SerializedGitFileChange {
	return {
		repoPath: file.repoPath,
		path: file.path,
		status: file.status,
		originalPath: file.originalPath,
		staged: file.staged,
		mode: file.mode,
		submodule: file.submodule,
		previousSha: file.previousSha,
		stats: file.stats,
	};
}

function serializeStatusFile(file: GitStatusFile): SerializedGitFileChange {
	return {
		repoPath: file.repoPath,
		path: file.path,
		status: file.status,
		originalPath: file.originalPath,
		staged: file.staged,
		submodule: file.submodule,
	};
}

/**
 * Presents a classified commit failure as a modal error dialog. When output is available, the
 * modal previews the first lines and offers a "View Full Output" action that opens the complete
 * output in an untitled `log` document (the lightweight pattern used by patches/changelog viewers).
 */
async function presentCommitFailure(failure: ClassifiedCommitFailure): Promise<void> {
	const { summary, output } = failure;
	const hasOutput = output != null && output.length > 0;

	// Self-contained: this runs as a fire-and-forget effect off the commit RPC, so it must never
	// escape as an unhandled rejection if a dialog/editor API rejects (e.g. the host refuses dialogs).
	try {
		const viewOutput = 'View Full Output';
		const choice = await window.showErrorMessage(
			summary,
			{ modal: true, detail: hasOutput ? buildCommitOutputPreview(output) : undefined },
			...(hasOutput ? [viewOutput] : []),
		);

		if (choice === viewOutput && output != null) {
			const doc = await workspace.openTextDocument({ content: output, language: 'log' });
			await window.showTextDocument(doc, { preview: false });
		}
	} catch (ex) {
		Logger.error(ex, 'presentCommitFailure');
	}
}
