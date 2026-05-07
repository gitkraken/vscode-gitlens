/**
 * Files service — file viewing and comparison operations for webviews.
 *
 * Provides shared file operations (open, compare, show actions) that any
 * webview can reuse. Method signatures match the structural typing expected
 * by `src/webviews/apps/shared/actions/file.ts`.
 *
 * File operations resolve a commit from the provided `GitFileChangeShape` +
 * optional ref, then delegate to the git action utilities in
 * `src/git/actions/commit.ts`.
 */

import type { GitCommit } from '@gitlens/git/models/commit.js';
import type { GitFileChange, GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import type { GitRevisionReference } from '@gitlens/git/models/reference.js';
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { DiffRange } from '@gitlens/git/providers/types.js';
import type { DiffWithCommandArgs } from '../../../commands/diffWith.js';
import type { Container } from '../../../container.js';
import {
	openChanges,
	openChangesWithWorking,
	openFile,
	openFileOnRemote,
	openMultipleChanges,
	openWipMultipleChanges,
	showDetailsQuickPick,
} from '../../../git/actions/commit.js';
import { GitUri } from '../../../git/gitUri.js';
import { getCommitAndFileByPath } from '../../../git/utils/-webview/commit.utils.js';
import { executeCommand } from '../../../system/-webview/command.js';
import { openChangesEditor, openDiffEditor, openTextEditor } from '../../../system/-webview/vscode/editors.js';
import type { VirtualRef } from '../../../virtual/virtualContentProvider.js';
import type { FileShowOptions, OpenMultipleChangesArgs } from './types.js';

/**
 * Synthesize a `GitRevisionReference` pointing at a repo's working tree.
 *
 * Used to bypass commit-resolution for WIP file actions: `getCommit(uncommitted)` is not
 * reliably hydrated on every worktree's repo service (especially for non-active secondary
 * worktrees in a multi-worktree workspace), but the underlying file actions only need a
 * `GitRevisionReference`-shaped target — they don't require a fully-hydrated `GitCommit`.
 */
function makeWipRef(repoPath: string): GitRevisionReference {
	return { refType: 'revision', name: 'Working Tree', ref: uncommitted, sha: uncommitted, repoPath: repoPath };
}

export class FilesService {
	constructor(private readonly container: Container) {}

	/**
	 * Open a file at its commit revision (or working tree for uncommitted).
	 *
	 * Resolves the commit from `file.repoPath` + `ref`, then opens the file
	 * via the working-file command.
	 */
	async openFile(file: GitFileChangeShape, showOptions?: FileShowOptions, ref?: string): Promise<void> {
		if (file.repoPath != null && ref === uncommitted) {
			void openFile(file, makeWipRef(file.repoPath), { preserveFocus: true, preview: true, ...showOptions });
			return;
		}

		const [commit, resolved] = await this.#getFileCommit(file, ref);
		if (commit == null) return;

		void openFile(resolved, commit, { preserveFocus: true, preview: true, ...showOptions });
	}

	/**
	 * Open a file on the remote provider (GitHub, GitLab, etc.).
	 *
	 * Resolves the commit from `file.repoPath` + `ref`, then opens
	 * the file on the remote via the openFileOnRemote command.
	 */
	async openFileOnRemote(file: GitFileChangeShape, ref?: string): Promise<void> {
		const [commit, resolved] = await this.#getFileCommit(file, ref);
		if (commit == null) return;

		void openFileOnRemote(resolved, commit);
	}

	/**
	 * Compare a file with its working tree version.
	 *
	 * Resolves the commit from `file.repoPath` + `ref`, then opens a
	 * diff view comparing the committed version with working tree.
	 */
	async openFileCompareWorking(file: GitFileChangeShape, showOptions?: FileShowOptions, ref?: string): Promise<void> {
		if (file.repoPath != null && ref === uncommitted) {
			void openChangesWithWorking(file, makeWipRef(file.repoPath), {
				preserveFocus: true,
				preview: true,
				...showOptions,
			});
			return;
		}

		const [commit, resolved] = await this.#getFileCommit(file, ref);
		if (commit == null) return;

		void openChangesWithWorking(resolved, commit, { preserveFocus: true, preview: true, ...showOptions });
	}

	/**
	 * Compare a file with its previous revision.
	 *
	 * Resolves the commit from `file.repoPath` + `ref`, then opens a
	 * diff view comparing the current revision with the previous one.
	 */
	async openFileComparePrevious(
		file: GitFileChangeShape,
		showOptions?: FileShowOptions,
		ref?: string,
	): Promise<void> {
		if (file.repoPath != null && ref === uncommitted) {
			// "Previous" for the working tree means HEAD vs working tree — `openChanges` with
			// rhs='' and lhs='HEAD' delegates to `openChangesWithWorking` with the HEAD ref.
			void openChanges(
				file,
				{ repoPath: file.repoPath, lhs: 'HEAD', rhs: '' },
				{ preserveFocus: true, preview: true, ...showOptions },
			);
			return;
		}

		const [commit, resolved] = await this.#getFileCommit(file, ref);
		if (commit == null) return;

		void openChanges(resolved, commit, { preserveFocus: true, preview: true, ...showOptions });
	}

	/**
	 * Compare a file between two specific refs (e.g. for commit range comparisons).
	 *
	 * Opens a diff editor showing the file at `lhsRef` vs `rhsRef`.
	 */
	// eslint-disable-next-line @typescript-eslint/require-await
	async openFileCompareBetween(
		file: GitFileChangeShape,
		showOptions?: FileShowOptions,
		lhsRef?: string,
		rhsRef?: string,
	): Promise<void> {
		if (file.repoPath == null || lhsRef == null || rhsRef == null) return;

		const lhsUri = GitUri.fromFile(file.originalPath ?? file.path, file.repoPath, lhsRef);
		const rhsUri = GitUri.fromFile(file, file.repoPath, rhsRef);

		void executeCommand('gitlens.diffWith', {
			repoPath: file.repoPath,
			lhs: { sha: lhsRef, uri: lhsUri },
			rhs: { sha: rhsRef, uri: rhsUri },
			showOptions: { preserveFocus: true, preview: true, ...showOptions },
		});
	}

	/**
	 * Open a file's changes between two refs as a diff editor, scrolled to a specific line on the rhs.
	 *
	 * `line` and `lineEnd` are 1-based to match the AI's diff line numbers; the resulting
	 * selection is anchored on the rhs (the AI's "after" reference frame).
	 */
	// eslint-disable-next-line @typescript-eslint/require-await
	async openFileChanges(
		repoPath: string,
		path: string,
		lhsRef: string,
		rhsRef: string,
		options?: { line?: number; lineEnd?: number; showOptions?: FileShowOptions },
	): Promise<void> {
		const svc = this.container.git.getRepositoryService(repoPath);
		const fileUri = svc.getAbsoluteUri(path, repoPath);

		const range: DiffRange | undefined =
			options?.line != null && options.line > 0
				? {
						startLine: options.line,
						startCharacter: 1,
						endLine: options.lineEnd ?? options.line,
						endCharacter: 1,
						active: 'start',
					}
				: undefined;

		void executeCommand<DiffWithCommandArgs>('gitlens.diffWith', {
			repoPath: repoPath,
			lhs: { sha: lhsRef, uri: fileUri },
			rhs: { sha: rhsRef, uri: fileUri },
			range: range,
			showOptions: { preserveFocus: true, preview: true, ...options?.showOptions },
		});
	}

	/**
	 * Show the file actions quick pick menu.
	 *
	 * Resolves the commit from `file.repoPath` + `ref`, then shows
	 * the details quick pick with all available file actions.
	 */
	async executeFileAction(file: GitFileChangeShape, showOptions?: FileShowOptions, ref?: string): Promise<void> {
		void showOptions; // Reserved for future use (e.g. viewColumn context)
		const [commit, resolved] = await this.#getFileCommit(file, ref);
		if (commit == null) return;

		void showDetailsQuickPick(commit, resolved);
	}

	/**
	 * Open all files in VS Code's native multi-diff editor.
	 *
	 * Forces `openIndividually: false` so the multi-diff path is always taken,
	 * bypassing the `views.openChangesInMultiDiffEditor` setting. The large-set
	 * threshold warning still applies.
	 */
	async openMultipleChanges(args: OpenMultipleChangesArgs): Promise<void> {
		if (!args.files.length) return;

		// WIP mode: route per-file so a path that appears as both staged and unstaged
		// yields two entries with different diffs (HEAD↔index and index↔working) instead
		// of two identical HEAD↔working-tree entries.
		if (args.rhs === '') {
			await openWipMultipleChanges(
				this.container,
				args.files,
				args.repoPath,
				args.title != null ? { title: args.title } : undefined,
			);
			return;
		}

		await openMultipleChanges(
			this.container,
			args.files,
			{ repoPath: args.repoPath, lhs: args.lhs, rhs: args.rhs },
			false,
			args.title != null ? { title: args.title } : undefined,
		);
	}

	// ============================================================
	// Virtual refs (pre-commit / ephemeral content)
	// ============================================================

	/**
	 * Open a file at a virtual ref in a text editor. The virtual FS provider synthesizes content
	 * on demand from the registered handler's session state.
	 */
	async openVirtualFile(ref: VirtualRef, file: GitFileChangeShape, showOptions?: FileShowOptions): Promise<void> {
		const uri = this.container.virtualFs.getUri(ref, file.path);
		await openTextEditor(uri, { preserveFocus: true, preview: true, ...showOptions });
	}

	/**
	 * Compare a virtual ref's file against its parent (previous virtual commit, or the real base
	 * commit for the chain's first entry). Falls back to an error if the handler does not expose
	 * a parent relation — callers should use the pairwise {@link openVirtualFileCompare} instead.
	 */
	async openVirtualFileComparePrevious(
		ref: VirtualRef,
		file: GitFileChangeShape,
		showOptions?: FileShowOptions,
	): Promise<void> {
		const args = await this.container.virtualFs.getComparePreviousUris(ref, file);
		await openDiffEditor(args.lhs, args.rhs, args.title, {
			preserveFocus: true,
			preview: true,
			...showOptions,
		});
	}

	/**
	 * Open multiple virtual files in VS Code's native multi-diff editor, comparing each against
	 * the parent of `ref`. Mirrors {@link openMultipleChanges} but for virtual sessions — paths
	 * resolve through the registered `VirtualContentProvider` rather than the git object store.
	 */
	async openVirtualMultipleChanges(
		ref: VirtualRef,
		files: readonly GitFileChangeShape[],
		showOptions?: FileShowOptions,
	): Promise<void> {
		if (!files.length) return;

		const { resources, title } = await this.container.virtualFs.getComparePreviousMultiDiffResources(ref, files);
		await openChangesEditor(resources, title, {
			preserveFocus: true,
			preview: true,
			...showOptions,
		});
	}

	// ============================================================
	// Private Helpers
	// ============================================================

	async #getFileCommit(
		file: GitFileChangeShape,
		ref?: string,
	): Promise<[commit: GitCommit, file: GitFileChange] | [commit?: undefined, file?: undefined]> {
		if (file.repoPath == null) return [];
		return getCommitAndFileByPath(file.repoPath, file.path, ref, file.staged);
	}
}
