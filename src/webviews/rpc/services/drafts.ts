/**
 * Drafts service — draft/patch operations for webviews.
 *
 * Provides shared draft operations (code suggestions, patch creation,
 * suggest changes) that any webview can reuse.
 */

import { EntityIdentifierUtils } from '@gitkraken/provider-apis/entity-identifiers';
import { env, window } from 'vscode';
import type { PullRequest } from '@gitlens/git/models/pullRequest.js';
import { uncommitted, uncommittedStaged } from '@gitlens/git/models/revision.js';
import { Logger } from '@gitlens/utils/logger.js';
import { getAvatarUri } from '../../../avatars.js';
import type { Sources } from '../../../constants.telemetry.js';
import type { Container } from '../../../container.js';
import type { GlRepository } from '../../../git/models/repository.js';
import { getBranchAssociatedPullRequest } from '../../../git/utils/-webview/branch.utils.js';
import { showPatchesView } from '../../../plus/drafts/actions.js';
import type { CreateDraftChange, Draft, DraftVisibility } from '../../../plus/drafts/models/drafts.js';
import { confirmDraftStorage } from '../../../plus/drafts/utils/-webview/drafts.utils.js';
import { ensureAccount } from '../../../plus/gk/utils/-webview/acount.utils.js';
import { supportsCodeSuggest } from '../../../plus/integrations/providers/models.js';
import { getEntityIdentifierInput } from '../../../plus/integrations/providers/utils.js';
import { getContext } from '../../../system/-webview/context.js';
import type { Change, DraftUserSelection } from '../../plus/patchDetails/protocol.js';
import type { RpcServiceHost, WipChange } from './types.js';

export class DraftsService {
	constructor(
		private readonly container: Container,
		private readonly host: RpcServiceHost,
	) {}

	/**
	 * Get code suggestions for a repository's current branch PR.
	 *
	 * Returns empty array if no PR exists, code suggest isn't supported,
	 * or drafts aren't accessible.
	 */
	async getCodeSuggestions(repoPath: string): Promise<Omit<Draft, 'changesets'>[]> {
		const repo = this.container.git.getRepository(repoPath);
		if (repo == null) return [];

		const status = await this.container.git.getRepositoryService(repoPath).status.getStatus();
		if (status?.branch == null) return [];

		const branch = await repo.git.branches.getBranch(status.branch);
		if (branch == null) return [];

		const pr = await getBranchAssociatedPullRequest(this.container, branch, {
			expiryOverride: 1000 * 60 * 5,
		});
		if (pr == null || !supportsCodeSuggest(pr.provider)) return [];

		const suggestions = await this.fetchCodeSuggestions(pr, repo);
		return suggestions.map(draft => ({
			...draft,
			changesets: undefined, // Callers don't need changesets for the draft list
		}));
	}

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
			void window.showInformationMessage("Copied patch — use 'Apply Copied Patch' in another window to apply it");
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
	 * Suggest changes (create a draft).
	 *
	 * Creates a code suggestion draft from the given changesets and
	 * shows a notification with options to view or copy the link.
	 */
	async suggestChanges(params: {
		repoPath: string;
		title: string;
		description?: string;
		visibility: DraftVisibility;
		changesets: Record<string, Change>;
		userSelections: DraftUserSelection[] | undefined;
	}): Promise<void> {
		if (
			!(await ensureAccount(this.container, 'Code Suggestions are a Preview feature and require an account.', {
				source: 'code-suggest',
				detail: 'create',
			})) ||
			!(await confirmDraftStorage(this.container))
		) {
			return;
		}

		const repository = this.container.git.getRepository(params.repoPath);
		if (repository == null) return;

		// Compute the PR entity ID on the host where EntityIdentifierUtils is available
		const prEntityId = await this.getEncodedPrEntityId(params.repoPath);
		if (prEntityId == null) return;

		const createChanges: CreateDraftChange[] = [];

		const changes = Object.entries(params.changesets);
		const ignoreChecked = changes.length === 1;
		let createFileCount = 0;

		for (const [_, change] of changes) {
			if (!ignoreChecked && change.checked === false) continue;

			// we only support a single repo for now
			if (repository.path !== change.repository.path) continue;

			const { checked } = change;
			let changeRevision = { to: uncommitted, from: 'HEAD' };
			if (checked === 'staged') {
				changeRevision = { ...changeRevision, to: uncommittedStaged };
			}

			if (change.files && change.files.length > 0) {
				if (checked === 'staged') {
					createFileCount += change.files.filter(f => f.staged === true).length;
				} else {
					createFileCount += change.files.length;
				}
			}

			createChanges.push({
				repository: repository,
				revision: changeRevision,
				prEntityId: prEntityId,
			});
		}

		if (createChanges.length === 0) return;

		try {
			const options = {
				description: params.description,
				visibility: 'provider_access' as DraftVisibility,
				prEntityId: prEntityId,
			};

			const draft = await this.container.drafts.createDraft(
				'suggested_pr_change',
				params.title,
				createChanges,
				options,
			);

			async function showNotification() {
				const view = { title: 'View Code Suggestions' };
				const copy = { title: 'Copy Link' };
				let copied = false;
				while (true) {
					const result = await window.showInformationMessage(
						`Code Suggestion successfully created${copied ? '\u2014 link copied to the clipboard' : ''}`,
						view,
						copy,
					);

					if (result === copy) {
						void env.clipboard.writeText(draft.deepLinkUrl);
						copied = true;
						continue;
					}

					if (result === view) {
						void showPatchesView({ mode: 'view', draft: draft, source: 'notification' });
					}

					break;
				}
			}

			void showNotification();
			// Note: inReview state is owned by webview - it will reset via RPC callback

			void this.trackCreateCodeSuggestion(draft, createFileCount, params.repoPath);
		} catch (ex) {
			debugger;

			void window.showErrorMessage(`Unable to create draft: ${ex instanceof Error ? ex.message : String(ex)}`);
		}
	}

	/**
	 * Show a code suggestion in the patches view.
	 */
	showCodeSuggestion(draft: Draft, source?: Sources): Promise<void> {
		void showPatchesView({ mode: 'view', draft: draft, source: source ?? 'inspect' });
		return Promise.resolve();
	}

	// ── Private Helpers ──

	private async canAccessDrafts(): Promise<boolean> {
		const subscription = await this.container.subscription.getSubscription();
		if (subscription?.account == null) return false;

		return getContext('gitlens:gk:organization:drafts:enabled', false);
	}

	private async fetchCodeSuggestions(pullRequest: PullRequest, repository: GlRepository): Promise<Draft[]> {
		if (!(await this.canAccessDrafts()) || !supportsCodeSuggest(pullRequest.provider)) return [];

		const results = await this.container.drafts.getCodeSuggestions(pullRequest, repository);

		for (const draft of results) {
			if (draft.author.avatarUri != null || draft.organizationId == null) continue;

			let email = draft.author.email;
			if (email == null) {
				const user = await this.container.organizations.getMemberById(draft.author.id, draft.organizationId);
				email = user?.email;
			}
			if (email == null) continue;

			draft.author.avatarUri = getAvatarUri(email);
		}

		return results;
	}

	private async getEncodedPrEntityId(repoPath: string): Promise<string | undefined> {
		const status = await this.container.git.getRepositoryService(repoPath).status.getStatus();
		if (status?.branch == null) return undefined;

		const repo = this.container.git.getRepository(repoPath);
		if (repo == null) return undefined;

		const branch = await repo.git.branches.getBranch(status.branch);
		const pr = branch != null ? await getBranchAssociatedPullRequest(this.container, branch) : undefined;
		if (pr == null) return undefined;

		const entity = getEntityIdentifierInput(pr);
		return entity != null ? EntityIdentifierUtils.encode(entity) : undefined;
	}

	private async trackCreateCodeSuggestion(draft: Draft, fileCount: number, repoPath: string) {
		const repoPrivacy = await this.container.git.visibility(repoPath);

		this.host.sendTelemetryEvent(
			'codeSuggestionCreated',
			{
				provider: 'unknown', // Provider info would need to be passed from webview if needed
				'repository.visibility': repoPrivacy,
				repoPrivacy: repoPrivacy,
				draftId: draft.id,
				draftPrivacy: draft.visibility,
				filesChanged: fileCount,
				source: 'reviewMode',
			},
			{
				source: 'inspect-overview',
				detail: { reviewMode: true },
			},
		);
	}
}
