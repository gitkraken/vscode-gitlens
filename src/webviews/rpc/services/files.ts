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
import { uncommitted } from '@gitlens/git/models/revision.js';
import type { Container } from '../../../container.js';
import {
	openChanges,
	openChangesWithWorking,
	openFile,
	openFileOnRemote,
	showDetailsQuickPick,
} from '../../../git/actions/commit.js';
import { getCommitForFile } from '../../../git/utils/-webview/commit.utils.js';
import type { FileShowOptions } from './types.js';

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

	// ============================================================
	// Private Helpers
	// ============================================================

	/**
	 * Resolve a `GitFileChangeShape` + optional ref into a commit and file pair.
	 *
	 * This replicates the logic from `CommitDetailsWebviewProvider.getFileCommitFromParams`
	 * but is decoupled from the webview provider instance.
	 */
	async #getFileCommit(
		file: GitFileChangeShape,
		ref?: string,
	): Promise<[commit: GitCommit, file: GitFileChange] | [commit?: undefined, file?: undefined]> {
		if (file.repoPath == null) return [];

		const svc = this.container.git.getRepositoryService(file.repoPath);

		let commit: GitCommit | undefined;
		if (ref != null && ref !== uncommitted) {
			commit = await svc.commits.getCommit(ref);
		} else {
			commit = await svc.commits.getCommit(uncommitted);
		}

		commit = commit != null ? await getCommitForFile(commit, file.path, file.staged) : undefined;
		return commit != null ? [commit, commit.file!] : [];
	}
}
