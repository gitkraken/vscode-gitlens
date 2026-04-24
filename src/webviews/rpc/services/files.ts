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
import type { FileShowOptions, OpenMultipleChangesArgs } from './types.js';

export class FilesService {
	constructor(private readonly container: Container) {}

	/**
	 * Open a file at its commit revision (or working tree for uncommitted).
	 *
	 * Resolves the commit from `file.repoPath` + `ref`, then opens the file
	 * via the working-file command.
	 */
	async openFile(file: GitFileChangeShape, showOptions?: FileShowOptions, ref?: string): Promise<void> {
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
