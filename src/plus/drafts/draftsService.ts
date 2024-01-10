import type { Disposable } from 'vscode';
import type { Container } from '../../container';
import { isSha, isUncommitted } from '../../git/models/reference';
import { isRepository } from '../../git/models/repository';
import type { GitUser } from '../../git/models/user';
import type {
	CreateDraftChange,
	CreateDraftPatchRequestFromChange,
	CreateDraftRequest,
	CreateDraftResponse,
	Draft,
	DraftChangeset,
	DraftChangesetCreateRequest,
	DraftChangesetCreateResponse,
	DraftChangesetResponse,
	DraftPatch,
	DraftPatchDetails,
	DraftPatchResponse,
	DraftPendingUser,
	DraftResponse,
	DraftUser,
	DraftVisibility,
} from '../../gk/models/drafts';
import type { RepositoryIdentityRequest } from '../../gk/models/repositoryIdentities';
import { log } from '../../system/decorators/log';
import { Logger } from '../../system/logger';
import type { LogScope } from '../../system/logger.scope';
import { getLogScope } from '../../system/logger.scope';
import { getSettledValue } from '../../system/promise';
import type { ServerConnection } from '../gk/serverConnection';

export class DraftService implements Disposable {
	constructor(
		private readonly container: Container,
		private readonly connection: ServerConnection,
	) {}

	dispose(): void {}

	@log({ args: { 2: false } })
	async createDraft(
		type: 'patch' | 'stash',
		title: string,
		changes: CreateDraftChange[],
		options?: { description?: string; visibility?: DraftVisibility },
	): Promise<Draft> {
		const scope = getLogScope();

		try {
			const results = await Promise.allSettled(changes.map(c => this.getCreateDraftPatchRequestFromChange(c)));
			if (!results.length) throw new Error('No changes found');

			const patchRequests: CreateDraftPatchRequestFromChange[] = [];
			const failed: Error[] = [];
			let user: GitUser | undefined;

			for (const r of results) {
				if (r.status === 'fulfilled') {
					// Don't include empty patches -- happens when there are changes in a range that undo each other
					if (r.value.contents) {
						patchRequests.push(r.value);
						if (user == null) {
							user = r.value.user;
						}
					}
				} else {
					failed.push(r.reason);
				}
			}

			if (failed.length) {
				debugger;
				throw new AggregateError(failed, 'Unable to create draft');
			}

			type DraftResult = { data: CreateDraftResponse };

			// POST v1/drafts
			const createDraftRsp = await this.connection.fetchGkDevApi('v1/drafts', {
				method: 'POST',
				body: JSON.stringify({
					type: type,
					title: title,
					description: options?.description,
					visibility: options?.visibility ?? 'public',
				} satisfies CreateDraftRequest),
			});

			if (!createDraftRsp.ok) {
				await handleBadDraftResponse('Unable to create draft', createDraftRsp, scope);
			}

			const createDraft = ((await createDraftRsp.json()) as DraftResult).data;
			const draftId = createDraft.id;

			type ChangesetResult = { data: DraftChangesetCreateResponse };

			// POST /v1/drafts/:draftId/changesets
			const createChangesetRsp = await this.connection.fetchGkDevApi(`v1/drafts/${draftId}/changesets`, {
				method: 'POST',
				body: JSON.stringify({
					// parentChangesetId: null,
					gitUserName: user?.name,
					gitUserEmail: user?.email,
					patches: patchRequests.map(p => p.patch),
				} satisfies DraftChangesetCreateRequest),
			});

			if (!createChangesetRsp.ok) {
				await handleBadDraftResponse(
					`Unable to create changeset for draft '${draftId}'`,
					createChangesetRsp,
					scope,
				);
			}

			const createChangeset = ((await createChangesetRsp.json()) as ChangesetResult).data;

			const patches: DraftPatch[] = [];

			let i = 0;
			for (const patch of createChangeset.patches) {
				const { url, method, headers } = patch.secureUploadData;

				const { contents, repository } = patchRequests[i++];
				if (contents == null) {
					debugger;
					throw new Error(`No contents found for ${patch.baseCommitSha}`);
				}

				const diffFiles = await this.container.git.getDiffFiles(repository.path, contents);
				const files = diffFiles?.files.map(f => ({ ...f, gkRepositoryId: patch.gitRepositoryId })) ?? [];

				// Upload patch to returned S3 url
				await this.connection.fetch(url, {
					method: method,
					headers: {
						'Content-Type': 'text/plain',
						Host: headers?.['Host']?.['0'] ?? '',
					},
					body: contents,
				});

				patches.push({
					type: 'cloud',
					id: patch.id,
					createdAt: new Date(patch.createdAt),
					updatedAt: new Date(patch.updatedAt ?? patch.createdAt),
					draftId: patch.draftId,
					changesetId: patch.changesetId,
					userId: createChangeset.userId,

					baseBranchName: patch.baseBranchName,
					baseRef: patch.baseCommitSha,
					gkRepositoryId: patch.gitRepositoryId,
					secureLink: undefined!, // patch.secureDownloadData,

					contents: contents,
					files: files,
					repository: repository,
				});
			}

			// POST /v1/drafts/:draftId/publish
			const publishRsp = await this.connection.fetchGkDevApi(`v1/drafts/${draftId}/publish`, { method: 'POST' });
			if (!publishRsp.ok) {
				await handleBadDraftResponse(`Failed to publish draft '${draftId}'`, publishRsp, scope);
			}

			type Result = { data: DraftResponse };

			const draftRsp = await this.connection.fetchGkDevApi(`v1/drafts/${draftId}`, { method: 'GET' });

			if (!draftRsp.ok) {
				await handleBadDraftResponse(`Unable to open draft '${draftId}'`, draftRsp, scope);
			}

			const draft = ((await draftRsp.json()) as Result).data;

			const author: Draft['author'] = {
				id: draft.createdBy,
				name: undefined!,
				email: undefined,
			};

			const { account } = await this.container.subscription.getSubscription();
			if (draft.createdBy === account?.id) {
				author.name = `${account.name} (you)`;
				author.email = account.email;
			}

			return {
				draftType: 'cloud',
				type: draft.type,
				id: draftId,
				createdAt: new Date(draft.createdAt),
				updatedAt: new Date(draft.updatedAt ?? draft.createdAt),
				author: author,
				isMine: true,
				organizationId: draft.organizationId || undefined,
				role: draft.role,
				isPublished: draft.isPublished,

				title: draft.title,
				description: draft.description,

				deepLinkUrl: createDraft.deepLink,
				visibility: draft.visibility,

				latestChangesetId: draft.latestChangesetId,
				changesets: [
					{
						id: createChangeset.id,
						createdAt: new Date(createChangeset.createdAt),
						updatedAt: new Date(createChangeset.updatedAt ?? createChangeset.createdAt),
						draftId: createChangeset.draftId,
						parentChangesetId: createChangeset.parentChangesetId,
						userId: createChangeset.userId,

						gitUserName: createChangeset.gitUserName,
						gitUserEmail: createChangeset.gitUserEmail,
						deepLinkUrl: createChangeset.deepLink,

						patches: patches,
					},
				],
			} satisfies Draft;
		} catch (ex) {
			debugger;
			Logger.error(ex, scope);

			throw ex;
		}
	}

	private async getCreateDraftPatchRequestFromChange(
		change: CreateDraftChange,
	): Promise<CreateDraftPatchRequestFromChange> {
		const isWIP = isUncommitted(change.revision.to);

		const [branchNamesResult, diffResult, firstShaResult, remoteResult, userResult] = await Promise.allSettled([
			isWIP
				? this.container.git.getBranch(change.repository.uri).then(b => (b != null ? [b.name] : undefined))
				: this.container.git
						.getCommitBranches(change.repository.uri, change.revision.to)
						.then(branches =>
							branches.length
								? branches
								: this.container.git.getCommitBranches(change.repository.uri, change.revision.from),
						),
			change.contents == null
				? this.container.git.getDiff(change.repository.path, change.revision.to, change.revision.from)
				: undefined,
			this.container.git.getFirstCommitSha(change.repository.uri),
			this.container.git.getBestRemoteWithProvider(change.repository.uri),
			this.container.git.getCurrentUser(change.repository.uri),
		]);

		const firstSha = getSettledValue(firstShaResult);
		// TODO: what happens if there are multiple remotes -- which one should we use? Do we need to ask? See more notes below
		const remote = getSettledValue(remoteResult);

		let repoData: RepositoryIdentityRequest;
		if (remote == null) {
			if (firstSha == null) throw new Error('No remote or initial commit found');

			repoData = {
				initialCommitSha: firstSha,
			};
		} else {
			repoData = {
				initialCommitSha: firstSha,
				remote: {
					url: remote.url,
					domain: remote.domain,
					path: remote.path,
				},
				provider:
					remote.provider.gkProviderId != null
						? {
								id: remote.provider.gkProviderId,
								repoDomain: remote.provider.domain,
								repoName: remote.provider.path,
								// repoOwnerDomain: ??
						  }
						: undefined,
			};
		}

		const diff = getSettledValue(diffResult);
		const contents = change.contents ?? diff?.contents;
		if (contents == null) throw new Error(`Unable to diff ${change.revision.from} and ${change.revision.to}`);

		const user = getSettledValue(userResult);

		// We need to get the branch name from the baseSha if the change is a stash.
		const branchNames = getSettledValue(branchNamesResult);
		const branchName = branchNames?.[0] ?? '';

		let baseSha = change.revision.from;
		if (!isSha(baseSha)) {
			const commit = await this.container.git.getCommit(change.repository.uri, baseSha);
			if (commit != null) {
				baseSha = commit.sha;
			} else {
				debugger;
			}
		}

		return {
			patch: {
				baseCommitSha: baseSha,
				baseBranchName: branchName,
				gitRepoData: repoData,
			},
			contents: contents,
			repository: change.repository,
			user: user,
		};
	}

	@log()
	async deleteDraft(id: string): Promise<void> {
		await this.connection.fetchGkDevApi(`v1/drafts/${id}`, { method: 'DELETE' });
	}

	@log()
	async getDraft(id: string): Promise<Draft> {
		const scope = getLogScope();

		type Result = { data: DraftResponse };

		const [rspResult, changesetsResult] = await Promise.allSettled([
			this.connection.fetchGkDevApi(`v1/drafts/${id}`, { method: 'GET' }),
			this.getChangesets(id),
		]);

		if (rspResult.status === 'rejected') {
			Logger.error(rspResult.reason, scope, `Unable to open draft '${id}': ${rspResult.reason}`);
			throw new Error(`Unable to open draft '${id}': ${rspResult.reason}`);
		}

		if (changesetsResult.status === 'rejected') {
			Logger.error(
				changesetsResult.reason,
				scope,
				`Unable to open changeset for draft '${id}': ${changesetsResult.reason}`,
			);
			throw new Error(`Unable to open changesets for draft '${id}': ${changesetsResult.reason}`);
		}

		const rsp = getSettledValue(rspResult)!;
		if (!rsp?.ok) {
			await handleBadDraftResponse(`Unable to open draft '${id}'`, rsp, scope);
		}

		const draft = ((await rsp.json()) as Result).data;
		const changesets = getSettledValue(changesetsResult)!;

		const author: Draft['author'] = {
			id: draft.createdBy,
			name: undefined!,
			email: undefined,
		};

		let isMine = false;
		const { account } = await this.container.subscription.getSubscription();
		if (draft.createdBy === account?.id) {
			author.name = `${account.name} (you)`;
			author.email = account.email;
			isMine = true;
		}

		return {
			draftType: 'cloud',
			type: draft.type,
			id: draft.id,
			createdAt: new Date(draft.createdAt),
			updatedAt: new Date(draft.updatedAt ?? draft.createdAt),
			author: author,
			isMine: isMine,
			organizationId: draft.organizationId || undefined,
			role: draft.role,
			isPublished: draft.isPublished,

			title: draft.title,
			description: draft.description,

			deepLinkUrl: draft.deepLink,
			visibility: draft.visibility,

			latestChangesetId: draft.latestChangesetId,
			changesets: changesets,
		};
	}

	@log()
	async getDrafts(): Promise<Draft[]> {
		const scope = getLogScope();
		type Result = { data: DraftResponse[] };

		const rsp = await this.connection.fetchGkDevApi('/v1/drafts', { method: 'GET' });

		if (!rsp.ok) {
			await handleBadDraftResponse('Unable to open drafts', rsp, scope);
		}

		const draft = ((await rsp.json()) as Result).data;
		const { account } = await this.container.subscription.getSubscription();

		return draft.map((d): Draft => {
			const isMine = d.createdBy === account?.id;
			return {
				draftType: 'cloud',
				type: d.type,
				id: d.id,
				author: isMine
					? { id: d.createdBy, name: `${account.name} (you)`, email: account.email }
					: { id: d.createdBy, name: 'Unknown', email: undefined },
				isMine: isMine,
				organizationId: d.organizationId || undefined,
				role: d.role,
				isPublished: d.isPublished,

				title: d.title,
				description: d.description,

				deepLinkUrl: d.deepLink,
				visibility: d.visibility,

				createdAt: new Date(d.createdAt),
				updatedAt: new Date(d.updatedAt ?? d.createdAt),

				latestChangesetId: d.latestChangesetId,
			};
		});
	}

	@log()
	async getChangesets(id: string): Promise<DraftChangeset[]> {
		const scope = getLogScope();

		type Result = { data: DraftChangesetResponse[] };

		try {
			const rsp = await this.connection.fetchGkDevApi(`/v1/drafts/${id}/changesets`, { method: 'GET' });
			if (!rsp.ok) {
				await handleBadDraftResponse(`Unable to open changesets for draft '${id}'`, rsp, scope);
			}

			const changeset = ((await rsp.json()) as Result).data;

			const changesets: DraftChangeset[] = [];
			for (const c of changeset) {
				const patches: DraftPatch[] = [];

				// const repoPromises = Promise.allSettled(c.patches.map(p => this.getRepositoryForGkId(p.gitRepositoryId)));

				for (const p of c.patches) {
					// const repoData = await this.getRepositoryData(p.gitRepositoryId);
					// const repo = await this.container.git.findMatchingRepository({
					// 	firstSha: repoData.initialCommitSha,
					// 	remoteUrl: repoData.remote?.url,
					// });

					patches.push({
						type: 'cloud',
						id: p.id,
						createdAt: new Date(p.createdAt),
						updatedAt: new Date(p.updatedAt ?? p.createdAt),
						draftId: p.draftId,
						changesetId: p.changesetId,
						userId: c.userId,

						baseBranchName: p.baseBranchName,
						baseRef: p.baseCommitSha,
						gkRepositoryId: p.gitRepositoryId,
						secureLink: p.secureDownloadData,

						// // TODO@eamodio FIX THIS
						// repository: repo,
						// repoData: repoData,
					});
				}

				changesets.push({
					id: c.id,
					createdAt: new Date(c.createdAt),
					updatedAt: new Date(c.updatedAt ?? c.createdAt),
					draftId: c.draftId,
					parentChangesetId: c.parentChangesetId,
					userId: c.userId,

					gitUserName: c.gitUserName,
					gitUserEmail: c.gitUserEmail,

					deepLinkUrl: c.deepLink,
					patches: patches,
				});
			}

			return changesets;
		} catch (ex) {
			Logger.error(ex, scope);

			throw ex;
		}
	}

	@log()
	async getPatch(id: string): Promise<DraftPatch> {
		const patch = await this.getPatchCore(id);

		const details = await this.getPatchDetails(patch);
		patch.contents = details.contents;
		patch.files = details.files;
		patch.repository = details.repository;

		return patch;
	}

	private async getPatchCore(id: string): Promise<DraftPatch> {
		const scope = getLogScope();
		type Result = { data: DraftPatchResponse };

		// GET /v1/patches/:patchId
		const rsp = await this.connection.fetchGkDevApi(`/v1/patches/${id}`, { method: 'GET' });

		if (!rsp.ok) {
			await handleBadDraftResponse(`Unable to open patch '${id}'`, rsp, scope);
		}

		const data = ((await rsp.json()) as Result).data;
		return {
			type: 'cloud',
			id: data.id,
			createdAt: new Date(data.createdAt),
			updatedAt: new Date(data.updatedAt ?? data.createdAt),
			draftId: data.draftId,
			changesetId: data.changesetId,
			userId: data.userId,

			baseBranchName: data.baseBranchName,
			baseRef: data.baseCommitSha,
			gkRepositoryId: data.gitRepositoryId,
			secureLink: data.secureDownloadData,
		};
	}

	async getPatchDetails(id: string): Promise<DraftPatchDetails>;
	async getPatchDetails(patch: DraftPatch): Promise<DraftPatchDetails>;
	@log<DraftService['getPatchDetails']>({
		args: { 0: idOrPatch => (typeof idOrPatch === 'string' ? idOrPatch : idOrPatch.id) },
	})
	async getPatchDetails(idOrPatch: string | DraftPatch): Promise<DraftPatchDetails> {
		const patch = typeof idOrPatch === 'string' ? await this.getPatchCore(idOrPatch) : idOrPatch;

		const [contentsResult, repositoryResult] = await Promise.allSettled([
			this.getPatchContentsCore(patch.secureLink),
			this.container.repositoryIdentity.getRepositoryOrIdentity(patch.gkRepositoryId, {
				openIfNeeded: true,
				skipRefValidation: true,
			}),
		]);

		const contents = getSettledValue(contentsResult)!;
		const repositoryOrIdentity = getSettledValue(repositoryResult)!;

		let repoPath = '';
		if (isRepository(repositoryOrIdentity)) {
			repoPath = repositoryOrIdentity.path;
		}

		const diffFiles = await this.container.git.getDiffFiles(repoPath, contents);
		const files = diffFiles?.files.map(f => ({ ...f, gkRepositoryId: patch.gkRepositoryId })) ?? [];

		return {
			id: patch.id,
			contents: contents,
			files: files,
			repository: repositoryOrIdentity,
		};
	}

	private async getPatchContentsCore(
		secureLink: DraftPatchResponse['secureDownloadData'],
	): Promise<string | undefined> {
		const { url, method, headers } = secureLink;

		// Download patch from returned S3 url
		const contentsRsp = await this.connection.fetch(url, {
			method: method,
			headers: {
				Accept: 'text/plain',
				Host: headers?.['Host']?.['0'] ?? '',
			},
		});

		return contentsRsp.text();
	}

	@log()
	async addDraftUsers(id: string, userAndRoles: DraftPendingUser[]): Promise<DraftUser[]> {
		const scope = getLogScope();

		type Result = { data: DraftUser[] };
		type Request = { id: string; users: DraftPendingUser[] };

		try {
			const rsp = await this.connection.fetchGkDevApi(`/v1/drafts/${id}/users`, {
				method: 'POST',
				body: JSON.stringify({
					id: id,
					users: userAndRoles,
				} as Request),
			});

			if (rsp?.ok === false) {
				await handleBadDraftResponse(`Unable to add users for draft '${id}'`, rsp, scope);
			}

			const users: DraftUser[] = ((await rsp.json()) as Result).data;

			return users;
		} catch (ex) {
			Logger.error(ex, scope);

			throw ex;
		}
	}
}

async function handleBadDraftResponse(message: string, rsp?: any, scope?: LogScope) {
	let json: { error?: { message?: string } } | { error?: string } | undefined;
	try {
		json = (await rsp?.json()) as { error?: { message?: string } } | { error?: string } | undefined;
	} catch {}
	const rspErrorMessage = typeof json?.error === 'string' ? json.error : json?.error?.message ?? rsp?.statusText;
	const errorMessage = rsp != null ? `${message}: (${rsp?.status}) ${rspErrorMessage}` : message;
	Logger.error(undefined, scope, errorMessage);
	throw new Error(errorMessage);
}
