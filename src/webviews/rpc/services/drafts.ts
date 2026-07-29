/**
 * Drafts service — patch operations for webviews.
 *
 * Provides shared patch operations that any webview can reuse.
 */

import { env, window } from 'vscode';
import { uncommitted, uncommittedStaged } from '@gitlens/git/models/revision.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { Sources } from '../../../constants.telemetry.js';
import type { Container } from '../../../container.js';
import { showPatchesView } from '../../../plus/drafts/actions.js';
import type { Draft } from '../../../plus/drafts/models/drafts.js';
import type { Change } from '../../plus/patchDetails/protocol.js';
import type { RpcServiceHost, WipChange } from './types.js';

const copiedPatchMessage = "Copied patch — use 'Apply Copied Patch' in another window to apply it";

export class DraftsService {
	constructor(
		private readonly container: Container,
		private readonly host: RpcServiceHost,
	) {}

	/**
	 * Copy a WIP patch to the clipboard for the given scope.
	 *
	 * Scope → `git diff` invocation (per `prepareToFromDiffArgs` in
	 * `packages/git-cli/src/providers/diff.ts`):
	 * - `all`      → `git diff HEAD` (working tree vs HEAD — staged + unstaged combined).
	 * - `staged`   → `git diff --staged` (HEAD vs index).
	 * - `unstaged` → `git diff` (index vs working tree). MUST pass `from: undefined` —
	 *                `to=uncommitted` + `from=uncommittedStaged` would push the sentinel literally
	 *                as a ref, producing a `fatal: ambiguous argument` error.
	 *
	 * Both `all` and `unstaged` diff against the working tree, so both temporarily `intentToAdd`-
	 * stage untracked files so they appear in the diff (mirroring `CopyPatchToClipboardCommand`,
	 * which stages whenever `to === uncommitted`). `staged` does not.
	 *
	 * `uris` (optional, repo-relative paths) is forwarded to `getDiff` as a pathspec to
	 * constrain the output to exactly those files. Used by the smart Copy button to keep
	 * the patch in sync with what Open Multi-Diff shows — especially around merge
	 * conflicts, where raw `git diff` would otherwise emit the combined-diff for an
	 * unmerged file regardless of which scope the user asked for.
	 *
	 * Surfaces the same info-toast / no-changes-warning UX as `CopyPatchToClipboardCommand`
	 * (see `src/commands/patches.ts`) so users see consistent feedback regardless of entry point.
	 */
	async copyWipPatchToClipboard(
		repoPath: string,
		scope: 'all' | 'staged' | 'unstaged',
		uris?: readonly string[],
	): Promise<void> {
		const git = this.container.git.getRepositoryService(repoPath);

		let to: string;
		let from: string | undefined;
		switch (scope) {
			case 'staged':
				to = uncommittedStaged;
				from = 'HEAD';
				break;
			case 'unstaged':
				to = uncommitted;
				from = undefined;
				break;
			default:
				to = uncommitted;
				from = 'HEAD';
				break;
		}

		// For scoped (non-`all`) copies the caller passes the scope-filtered paths as `uris`. An
		// empty list means nothing matched — falling through to `getDiff` without a pathspec would
		// copy the ENTIRE scope (all staged / all unstaged), contradicting the user's intent. Warn
		// and bail instead. (`all` intentionally passes no `uris` and must not be gated here.)
		if (scope !== 'all' && !uris?.length) {
			void window.showWarningMessage('No changes found to copy');
			return;
		}

		// Both `all` and `unstaged` diff against the working tree (`to === uncommitted`), so they
		// must surface untracked files — git won't emit them in `git diff`/`git diff HEAD` until
		// they have an index entry. Temporarily `intentToAdd`-stage every untracked file (the
		// `uris` pathspec still constrains the diff to the requested scope) and unstage in
		// `finally`. Mirrors `CopyPatchToClipboardCommand.getDiff`, which stages whenever
		// `to === uncommitted`. The `staged` scope (`to === uncommittedStaged`) skips this.
		let untrackedPaths: string[] | undefined;
		try {
			if (scope !== 'staged') {
				untrackedPaths = (await git.status?.getUntrackedFiles())?.map(f => f.path);
				if (untrackedPaths?.length) {
					try {
						await git.staging?.stageFiles(untrackedPaths, { intentToAdd: true });
					} catch (ex) {
						Logger.error(ex, `Failed to stage (${untrackedPaths.length}) untracked files for patch`);
					}
				}
			}

			const diff = await git.diff.getDiff?.(to, from, uris?.length ? { uris: [...uris] } : undefined);
			if (!diff?.contents) {
				void window.showWarningMessage('No changes found to copy');
				return;
			}

			await env.clipboard.writeText(diff.contents);
			void window.showInformationMessage(copiedPatchMessage);
		} catch (ex) {
			// `fireAndForget` at the actions.ts caller only logs rejections — surface a toast here
			// so users see *something* when the copy fails (clipboard denied, git error, etc.)
			// rather than the button appearing to no-op.
			Logger.error(ex, `Failed to copy ${scope} WIP patch to clipboard`);
			void window.showErrorMessage(`Unable to copy patch: ${ex instanceof Error ? ex.message : String(ex)}`);
		} finally {
			if (untrackedPaths?.length) {
				try {
					await git.staging?.unstageFiles(untrackedPaths);
				} catch (ex) {
					Logger.error(ex, `Failed to unstage (${untrackedPaths.length}) untracked files for patch`);
				}
			}
		}
	}

	/** Copy a commit's (or stash's) full diff (`from`→`to`, parent→commit) to the clipboard.
	 *  `from` is undefined for a root commit, where we fall back to `${to}^`. */
	async copyCommitPatchToClipboard(repoPath: string, to: string, from?: string): Promise<void> {
		const git = this.container.git.getRepositoryService(repoPath);

		try {
			const diff = await git.diff.getDiff?.(to, from ?? `${to}^`);
			if (!diff?.contents) {
				void window.showWarningMessage('No changes found to copy');
				return;
			}

			await env.clipboard.writeText(diff.contents);
			void window.showInformationMessage(copiedPatchMessage);
		} catch (ex) {
			Logger.error(ex, 'Failed to copy commit patch to clipboard');
			void window.showErrorMessage(`Unable to copy patch: ${ex instanceof Error ? ex.message : String(ex)}`);
		}
	}
	/**
	 * Create a patch from WIP changes.
	 *
	 * Opens the patches view in create mode with the WIP change.
	 */
	createPatchFromWip(changes: WipChange, checked: boolean | 'staged'): Promise<void> {
		if (changes == null) return Promise.resolve();

		const change: Change = {
			type: 'wip',
			repository: {
				name: changes.repository.name,
				path: changes.repository.path,
				uri: changes.repository.uri,
			},
			files: changes.files,
			revision: { to: uncommitted, from: 'HEAD' },
			checked: checked,
		};

		void showPatchesView({ mode: 'create', create: { changes: [change] } });
		return Promise.resolve();
	}

	/**
	 * Show a code suggestion in the patches view.
	 */
	showCodeSuggestion(draft: Draft, source?: Sources): Promise<void> {
		void showPatchesView({ mode: 'view', draft: draft, source: source ?? 'inspect' });
		return Promise.resolve();
	}
}
