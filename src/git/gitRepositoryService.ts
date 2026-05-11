import type { Uri } from 'vscode';
import { ProgressLocation, window } from 'vscode';
import { CheckoutError, FetchError, PullError, PushError, SigningError } from '@gitlens/git/errors.js';
import type { GitExecOptions, GitResult } from '@gitlens/git/exec.types.js';
import type { GitFile } from '@gitlens/git/models/file.js';
import type { GitBranchReference, GitReference } from '@gitlens/git/models/reference.js';
import { deletedOrMissing } from '@gitlens/git/models/revision.js';
import type { GitProviderDescriptor } from '@gitlens/git/providers/types.js';
import type { RepositoryService } from '@gitlens/git/repositoryService.js';
import { isBranchReference } from '@gitlens/git/utils/reference.utils.js';
import { getRemoteThemeIconString } from '@gitlens/git/utils/remote.utils.js';
import { debug, trace } from '@gitlens/utils/decorators/log.js';
import { groupByFilterMap } from '@gitlens/utils/iterable.js';
import { Logger } from '@gitlens/utils/logger.js';
import { getSettledValue } from '@gitlens/utils/promise.js';
import { GlyphChars, Schemes } from '../constants.js';
import type { Source } from '../constants.telemetry.js';
import type { EventBus } from '../eventBus.js';
import type { FeatureAccess, Features, PlusFeatures } from '../features.js';
import { showGitErrorMessage } from '../messages.js';
import { configuration } from '../system/-webview/configuration.js';
import { exists } from '../system/-webview/vscode/uris.js';
import { gate } from '../system/decorators/gate.js';
import type { GlGitProvider, RevisionUriOptions, ScmRepository } from './gitProvider.js';
import type { GitProviderService } from './gitProviderService.js';
import { GitUri } from './gitUri.js';
import type { GlRepository } from './models/repository.js';

// Merge the RepositoryService sub-provider interface onto GitRepositoryService
// so that sub-provider properties (branches, commits, etc.) are recognized by TypeScript.
// The actual property descriptors are copied from RepositoryService at construction time.
// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export interface GitRepositoryService extends RepositoryService {}

const skipOverlappingProperties = new Set(['path', 'provider', 'getAbsoluteUri', 'exec']);

// eslint-disable-next-line @typescript-eslint/no-unsafe-declaration-merging
export class GitRepositoryService {
	constructor(
		private readonly _svc: GitProviderService,
		private readonly _provider: GlGitProvider,
		readonly path: string,
		repoService: RepositoryService,
		private readonly _events: EventBus,
	) {
		this.getAbsoluteUri = _svc.getAbsoluteUri.bind(_svc);
		this.getRelativePath = _svc.getRelativePath.bind(_svc);
		this.getRepository = _svc.getRepository.bind(_svc, path);

		// Absorb RepositoryService sub-provider getters directly onto this instance.
		// This copies the lazy proxy getters so that sub-provider access (e.g. this.branches)
		// resolves directly without an intermediate object.
		const descriptors = Object.getOwnPropertyDescriptors(repoService);
		for (const key of Object.keys(descriptors)) {
			// Skip properties already defined on GitRepositoryService
			if (skipOverlappingProperties.has(key)) continue;
			Object.defineProperty(this, key, descriptors[key]);
		}
	}

	@debug({ args: uris => ({ uris: uris.length }) })
	excludeIgnoredUris(uris: Uri[]): Promise<Uri[]> {
		return this._provider.excludeIgnoredUris(this.path, uris);
	}

	exec(args: readonly string[], options?: GitExecOptions): Promise<GitResult> {
		return this._svc.exec(this.path, args, options);
	}

	@trace()
	getIgnoredUrisFilter(): Promise<(uri: Uri) => boolean> {
		return this._provider.getIgnoredUrisFilter(this.path);
	}

	getAbsoluteUri: GitProviderService['getAbsoluteUri'];

	@debug()
	async getBestRevisionUri(pathOrUri: string | Uri, rev: string | undefined): Promise<Uri | undefined> {
		if (rev === deletedOrMissing) return undefined;

		// If the URI is already a gitlens:// revision URI (e.g., for submodule diffs), use it directly
		if (typeof pathOrUri !== 'string' && pathOrUri.scheme === Schemes.GitLens) {
			return pathOrUri;
		}

		const path = typeof pathOrUri === 'string' ? pathOrUri : pathOrUri.fsPath;
		return this._provider.getBestRevisionUri(this.path, this._provider.getRelativePath(path, this.path), rev);
	}

	@debug()
	async getBranchesAndTagsTipsLookup(
		suppressName?: string,
	): Promise<
		(
			sha: string,
			options?: { compact?: boolean; icons?: boolean; pills?: boolean | { cssClass: string } },
		) => string | undefined
	> {
		if (this.path == null) return () => undefined;

		type Tip = { name: string; icon: string; compactName: string | undefined; type: 'branch' | 'tag' };

		const [branchesResult, tagsResult, remotesResult] = await Promise.allSettled([
			this.branches.getBranches(),
			this.tags.getTags(),
			this.remotes.getRemotes(),
		]);

		const branches = getSettledValue(branchesResult)?.values ?? [];
		const tags = getSettledValue(tagsResult)?.values ?? [];
		const remotes = getSettledValue(remotesResult) ?? [];

		const branchesAndTagsBySha = groupByFilterMap(
			[...branches, ...tags],
			bt => bt.sha,
			bt => {
				let icon;
				if (bt.refType === 'branch') {
					if (bt.remote) {
						const remote = remotes.find(r => r.name === bt.remoteName);
						icon = `$(${getRemoteThemeIconString(remote)}) `;
					} else {
						icon = bt.current ? '$(target) ' : '$(git-branch) ';
					}
				} else {
					icon = '$(tag) ';
				}

				return {
					name: bt.name,
					icon: icon,
					compactName:
						suppressName && bt.refType === 'branch' && bt.nameWithoutRemote === suppressName
							? bt.remoteName
							: undefined,
					type: bt.refType,
				} satisfies Tip;
			},
		);

		return (
			sha: string,
			options?: { compact?: boolean; icons?: boolean; pills?: boolean | { cssClass: string } },
		): string | undefined => {
			const branchesAndTags = branchesAndTagsBySha.get(sha);
			if (!branchesAndTags?.length) return undefined;

			const tips =
				suppressName && options?.compact
					? branchesAndTags.filter(bt => bt.name !== suppressName)
					: branchesAndTags;

			function getIconAndLabel(tip: Tip) {
				const label = (options?.compact ? tip.compactName : undefined) ?? tip.name;
				return `${options?.icons ? `${tip.icon}${options?.pills ? '&nbsp;' : ' '}` : ''}${label}`;
			}

			let results;
			if (options?.compact) {
				if (!tips.length) return undefined;

				const [bt] = tips;
				results = [`${getIconAndLabel(bt)}${tips.length > 1 ? `, ${GlyphChars.Ellipsis}` : ''}`];
			} else {
				results = tips.map(getIconAndLabel);
			}

			if (options?.pills) {
				return results
					.map(
						t =>
							/*html*/ `<span style="color:#ffffff;background-color:#1d76db;border-radius:3px;"${
								typeof options.pills === 'object' ? ` class="${options.pills.cssClass}"` : ''
							}>&nbsp;${t}&nbsp;&nbsp;</span>`,
					)
					.join('&nbsp;&nbsp;');
			}
			return results.join(', ');
		};
	}

	@trace({ exit: true })
	getLastFetchedTimestamp(): Promise<number | undefined> {
		return this._provider.getLastFetchedTimestamp(this.path);
	}

	getRelativePath: GitProviderService['getRelativePath'];
	getRepository: () => GlRepository | undefined;

	@debug()
	getRevisionUri(rev: string, pathOrFile: string | GitFile, options?: RevisionUriOptions): Uri {
		const path = typeof pathOrFile === 'string' ? pathOrFile : (pathOrFile?.originalPath ?? pathOrFile?.path ?? '');
		return this._provider.getRevisionUri(this.path, rev, this._provider.getRelativePath(path, this.path), options);
	}

	@debug()
	getScmRepository(): Promise<ScmRepository | undefined> {
		return this._provider.getScmRepository(this.path);
	}

	@debug()
	getOrOpenScmRepository(source?: Source): Promise<ScmRepository | undefined> {
		return this._provider.getOrOpenScmRepository(this.path, source);
	}

	@debug({ exit: true })
	async getUniqueRepositoryId(): Promise<string | undefined> {
		return this.commits.getInitialCommitSha?.();
	}

	@debug()
	getWorkingUri(uri: Uri): Promise<Uri | undefined> {
		return this._provider.getWorkingUri(this.path, uri);
	}

	@debug({ exit: true })
	isFolderUri(uri: Uri): Promise<boolean> {
		return this._provider.isFolderUri(this.path, uri);
	}

	/**
	 * For submodule URIs, extracts the working SHA and looks up the base SHA to construct diff URIs.
	 * Returns undefined for regular file URIs.
	 */
	@debug()
	async getSubmoduleDiffUris(
		workingUri: Uri,
		relativePath: string,
		baseRev: string | undefined,
	): Promise<{ lhsUri: Uri; rhsUri: Uri; lhsSha: string; rhsSha: string } | undefined> {
		if (workingUri.scheme !== Schemes.GitLens) return undefined;

		const workingGitUri = new GitUri(workingUri);
		if (!workingGitUri.submoduleSha) return undefined;

		const rhsSha = workingGitUri.submoduleSha;

		// Look up the committed submodule SHA at the base revision (must be a gitlink commit, not a blob/tree)
		const treeEntry = baseRev ? await this.revision.getTreeEntryForRevision(relativePath, baseRev) : undefined;
		const lhsSha = treeEntry?.type === 'commit' ? treeEntry.oid : undefined;
		if (lhsSha == null) return undefined;

		return {
			lhsUri: this.getRevisionUri(lhsSha, relativePath, { submoduleSha: lhsSha }),
			rhsUri: workingUri,
			lhsSha: lhsSha,
			rhsSha: rhsSha,
		};
	}

	@trace({ exit: true })
	supports(feature: Features): Promise<boolean> {
		return this._provider.supports(feature);
	}

	get provider(): GitProviderDescriptor {
		return this._provider.descriptor;
	}

	@debug()
	access(feature?: PlusFeatures): Promise<FeatureAccess> {
		return this._svc.access(feature, this.getRepository()?.uri);
	}

	containsUri(uri: Uri): boolean {
		return this.getRepository() === this._svc.getRepository(uri);
	}

	async getAbsoluteOrBestRevisionUri(path: string, rev: string | undefined): Promise<Uri | undefined> {
		const repo = this.getRepository();
		const uri = this.getAbsoluteUri(path, repo?.uri);
		if (uri != null && repo === this._svc.getRepository(uri) && (await exists(uri))) return uri;

		return rev != null ? this.getBestRevisionUri(path, rev) : undefined;
	}

	@debug({ exit: true })
	getCommonRepository(): GlRepository | undefined {
		const repo = this.getRepository();
		if (repo == null) return undefined;

		const { commonUri } = repo;
		if (commonUri == null) return repo;

		return this._svc.getRepository(commonUri);
	}

	@gate()
	@debug({ exit: true })
	async getOrOpenCommonRepository(): Promise<GlRepository | undefined> {
		const repo = this.getRepository();
		if (repo == null) return undefined;

		const { commonUri } = repo;
		if (commonUri == null) return repo;

		// If the repository isn't already opened, then open it as a "closed" repo (won't show up in the UI)
		return this._svc.getOrOpenRepository(commonUri, { detectNested: false, force: true, closeOnOpen: true });
	}

	@gate()
	@debug()
	async fetch(options?: {
		all?: boolean;
		branch?: GitBranchReference;
		progress?: boolean;
		prune?: boolean;
		pull?: boolean;
		remote?: string;
	}): Promise<void> {
		const { progress, ...opts } = { progress: true, ...options };
		if (!progress) return this.fetchCore(opts);

		const repo = this.getRepository();
		return window.withProgress(
			{
				location: ProgressLocation.Notification,
				title:
					opts.branch != null
						? `${opts.pull ? 'Pulling' : 'Fetching'} ${opts.branch.name}...`
						: `Fetching ${opts.remote ? `${opts.remote} of ` : ''}${repo?.name ?? ''}...`,
			},
			() => this.fetchCore(opts),
		);
	}

	private async fetchCore(options?: {
		all?: boolean;
		branch?: GitBranchReference;
		prune?: boolean;
		pull?: boolean;
		remote?: string;
	}) {
		try {
			await this.ops?.fetch(options);
		} catch (ex) {
			Logger.error(ex);

			if (FetchError.is(ex)) {
				void showGitErrorMessage(ex);
			} else {
				void showGitErrorMessage(ex, 'Unable to fetch');
			}
		}
	}

	@gate()
	@debug()
	async pull(options?: { progress?: boolean; rebase?: boolean }): Promise<void> {
		const { progress, ...opts } = { progress: true, ...options };
		if (!progress) return this.pullCore(opts);

		const repo = this.getRepository();
		return window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Pulling ${repo?.name ?? ''}...`,
			},
			() => this.pullCore(opts),
		);
	}

	private async pullCore(options?: { rebase?: boolean }) {
		const repo = this.getRepository();
		try {
			const withTags = configuration.getCore('git.pullTags', repo?.uri);
			if (configuration.getCore('git.fetchOnPull', repo?.uri)) {
				await this.ops?.fetch();
			}

			await this.ops?.pull({ ...options, tags: withTags });
		} catch (ex) {
			Logger.error(ex);

			if (PullError.is(ex) || SigningError.is(ex)) {
				void showGitErrorMessage(ex);
			} else {
				void showGitErrorMessage(ex, 'Unable to pull');
			}
		}
	}

	@gate()
	@debug()
	async push(options?: {
		force?: boolean;
		progress?: boolean;
		reference?: GitReference;
		publish?: { remote: string };
	}): Promise<void> {
		const { progress, ...opts } = { progress: true, ...options };
		if (!progress) return this.pushCore(opts);

		const repo = this.getRepository();
		return window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: isBranchReference(opts.reference)
					? `${opts.publish != null ? 'Publishing ' : 'Pushing '}${opts.reference.name}...`
					: `Pushing ${repo?.name ?? ''}...`,
			},
			() => this.pushCore(opts),
		);
	}

	private async pushCore(options?: { force?: boolean; reference?: GitReference; publish?: { remote: string } }) {
		try {
			await this.ops?.push({
				reference: options?.reference,
				force: options?.force,
				publish: options?.publish,
			});

			if (this.ops != null && isBranchReference(options?.reference) && options?.publish != null) {
				this._events.fireAsync('git:publish', {
					repoPath: this.path,
					remote: options.publish.remote,
					branch: options.reference,
				});
			}
		} catch (ex) {
			Logger.error(ex);

			if (PushError.is(ex)) {
				void showGitErrorMessage(ex);
			} else {
				void showGitErrorMessage(ex, 'Unable to push');
			}
		}
	}

	@gate()
	@debug()
	async switch(ref: string, options?: { createBranch?: string | undefined; progress?: boolean }): Promise<void> {
		const { progress, ...opts } = { progress: true, ...options };
		if (!progress) return this.switchCore(ref, opts);

		const repo = this.getRepository();
		return window.withProgress(
			{
				location: ProgressLocation.Notification,
				title: `Switching ${repo?.name ?? ''} to ${ref}...`,
				cancellable: false,
			},
			() => this.switchCore(ref, opts),
		);
	}

	private async switchCore(ref: string, options?: { createBranch?: string }) {
		try {
			await this.ops?.checkout(ref, options);
		} catch (ex) {
			Logger.error(ex);

			if (CheckoutError.is(ex)) {
				void showGitErrorMessage(ex);
			} else {
				void showGitErrorMessage(ex, 'Unable to switch to reference');
			}
		}
	}
}
