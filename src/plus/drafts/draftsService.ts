import { EntityIdentifierUtils } from '@gitkraken/provider-apis';
import type { Disposable } from 'vscode';
import type { HeadersInit } from '@env/fetch';
import type { Container } from '../../container';
import type { PullRequest } from '../../git/models/pullRequest';
import { isSha, isUncommitted, shortenRevision } from '../../git/models/reference';
import type { Repository } from '../../git/models/repository';
import { isRepository } from '../../git/models/repository';
import type { GitUser } from '../../git/models/user';
import { getRemoteProviderMatcher } from '../../git/remotes/remoteProviders';
import type {
	CodeSuggestionCounts,
	CodeSuggestionCountsResponse,
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
	DraftType,
	DraftUser,
	DraftVisibility,
} from '../../gk/models/drafts';
import type {
	GkRepositoryId,
	RepositoryIdentity,
	RepositoryIdentityRequest,
	RepositoryIdentityResponse,
} from '../../gk/models/repositoryIdentities';
import { log } from '../../system/decorators/log';
import { Logger } from '../../system/logger';
import type { LogScope } from '../../system/logger.scope';
import { getLogScope } from '../../system/logger.scope';
import { getSettledValue } from '../../system/promise';
import type { FocusItem } from '../focus/focusProvider';
import type { ServerConnection } from '../gk/serverConnection';
import type { IntegrationId } from '../integrations/providers/models';
import { providersMetadata } from '../integrations/providers/models';
import { getEntityIdentifierInput } from '../integrations/providers/utils';

export class DraftService implements Disposable {
	constructor(
		private readonly container: Container,
		private readonly connection: ServerConnection,
	) {}

	dispose(): void {}

	@log({ args: { 2: false } })
	async createDraft(
		type: DraftType,
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

			let providerAuthHeader: HeadersInit | undefined;
			if (type === 'suggested_pr_change') {
				const repo = patchRequests[0].repository;
				const providerAuth = await this.getProviderAuthFromRepository(repo);
				if (providerAuth == null) {
					throw new Error('No provider integration found');
				}
				providerAuthHeader = {
					'Provider-Auth': Buffer.from(JSON.stringify(providerAuth)).toString('base64'),
				};
			}

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
				headers: providerAuthHeader,
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
						...headers,
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
			const publishRsp = await this.connection.fetchGkDevApi(`v1/drafts/${draftId}/publish`, {
				method: 'POST',
				headers: providerAuthHeader,
			});
			if (!publishRsp.ok) {
				await handleBadDraftResponse(`Failed to publish draft '${draftId}'`, publishRsp, scope);
			}

			type Result = { data: DraftResponse };

			const draftRsp = await this.connection.fetchGkDevApi(`v1/drafts/${draftId}`, {
				method: 'GET',
				headers: providerAuthHeader,
			});

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

				isArchived: draft.isArchived,
				archivedBy: draft.archivedBy,
				archivedReason: draft.archivedReason,
				archivedAt: draft.archivedAt != null ? new Date(draft.archivedAt) : draft.archivedAt,

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
				: this.container.git.getCommitBranches(change.repository.uri, [
						change.revision.to,
						change.revision.from,
				  ]),
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

		// We need to get the branch name if possible, otherwise default to HEAD
		const branchNames = getSettledValue(branchNamesResult);
		const branchName = branchNames?.[0] ?? 'HEAD';

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
				prEntityId: change.prEntityId,
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

			isArchived: draft.isArchived,
			archivedBy: draft.archivedBy,
			archivedReason: draft.archivedReason,
			archivedAt: draft.archivedAt != null ? new Date(draft.archivedAt) : draft.archivedAt,

			latestChangesetId: draft.latestChangesetId,
			changesets: changesets,
		};
	}

	@log()
	async getDrafts(isArchived?: boolean): Promise<Draft[]> {
		return this.getDraftsCore(isArchived ? { isArchived: isArchived } : undefined);
	}

	@log()
	async getDraftsCore(options?: { prEntityId?: string; providerAuth?: any; isArchived?: boolean }): Promise<Draft[]> {
		const scope = getLogScope();
		type Result = { data: DraftResponse[] };

		const queryStrings = [];
		if (options?.prEntityId != null) {
			if (options.providerAuth == null) {
				throw new Error('No provider integration found');
			}
			queryStrings.push(`prEntityId=${encodeURIComponent(options.prEntityId)}`);
		}

		if (options?.isArchived) {
			queryStrings.push('archived=true');
		}

		let headers;
		if (options?.providerAuth) {
			headers = {
				'Provider-Auth': Buffer.from(JSON.stringify(options.providerAuth)).toString('base64'),
			};
		}

		const rsp = await this.connection.fetchGkDevApi(
			'/v1/drafts',
			{
				method: 'GET',
				headers: headers,
			},
			{
				query: queryStrings.length ? queryStrings.join('&') : undefined,
			},
		);

		if (!rsp.ok) {
			await handleBadDraftResponse('Unable to open drafts', rsp, scope);
		}

		const drafts = ((await rsp.json()) as Result).data;
		const { account } = await this.container.subscription.getSubscription();

		return drafts.map((d): Draft => {
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

				isArchived: d.isArchived,
				archivedBy: d.archivedBy,
				archivedReason: d.archivedReason,
				archivedAt: d.archivedAt != null ? new Date(d.archivedAt) : d.archivedAt,

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
			this.getRepositoryOrIdentity(patch.draftId, patch.gkRepositoryId, {
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
				...headers,
			},
		});

		return contentsRsp.text();
	}

	@log()
	async updateDraftVisibility(id: string, visibility: DraftVisibility): Promise<Draft> {
		const scope = getLogScope();

		type Result = { data: Draft };

		try {
			const rsp = await this.connection.fetchGkDevApi(`/v1/drafts/${id}`, {
				method: 'PATCH',
				body: JSON.stringify({ visibility: visibility }),
			});

			if (rsp?.ok === false) {
				await handleBadDraftResponse(`Unable to update draft '${id}'`, rsp, scope);
			}

			const draft = ((await rsp.json()) as Result).data;

			return draft;
		} catch (ex) {
			Logger.error(ex, scope);

			throw ex;
		}
	}

	@log()
	async getDraftUsers(id: string): Promise<DraftUser[]> {
		const scope = getLogScope();

		type Result = { data: DraftUser[] };

		try {
			const rsp = await this.connection.fetchGkDevApi(`/v1/drafts/${id}/users`, { method: 'GET' });

			if (rsp?.ok === false) {
				await handleBadDraftResponse(`Unable to get users for draft '${id}'`, rsp, scope);
			}

			const users: DraftUser[] = ((await rsp.json()) as Result).data;

			return users;
		} catch (ex) {
			Logger.error(ex, scope);

			throw ex;
		}
	}

	@log()
	async addDraftUsers(id: string, pendingUsers: DraftPendingUser[]): Promise<DraftUser[]> {
		const scope = getLogScope();

		type Result = { data: DraftUser[] };
		type Request = { id: string; users: DraftPendingUser[] };

		try {
			if (pendingUsers.length === 0) {
				throw new Error('No changes found');
			}

			const rsp = await this.connection.fetchGkDevApi(`/v1/drafts/${id}/users`, {
				method: 'POST',
				body: JSON.stringify({
					id: id,
					users: pendingUsers,
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

	@log()
	async removeDraftUser(id: string, userId: DraftUser['userId']): Promise<boolean> {
		const scope = getLogScope();
		try {
			const rsp = await this.connection.fetchGkDevApi(`/v1/drafts/${id}/users/${userId}`, { method: 'DELETE' });

			if (rsp?.ok === false) {
				await handleBadDraftResponse(`Unable to update user ${userId} for draft '${id}'`, rsp, scope);
			}

			return true;
		} catch (ex) {
			Logger.error(ex, scope);

			throw ex;
		}
	}

	@log()
	async getRepositoryOrIdentity(
		draftId: Draft['id'],
		repoId: GkRepositoryId,
		options?: { openIfNeeded?: boolean; keepOpen?: boolean; prompt?: boolean; skipRefValidation?: boolean },
	): Promise<Repository | RepositoryIdentity> {
		const identity = await this.getRepositoryIdentity(draftId, repoId);
		return (await this.container.repositoryIdentity.getRepository(identity, options)) ?? identity;
	}

	@log()
	async getRepositoryIdentity(draftId: Draft['id'], repoId: GkRepositoryId): Promise<RepositoryIdentity> {
		type Result = { data: RepositoryIdentityResponse };

		const rsp = await this.connection.fetchGkDevApi(`/v1/drafts/${draftId}/git-repositories/${repoId}`, {
			method: 'GET',
		});
		const data = ((await rsp.json()) as Result).data;

		let name: string;
		if ('name' in data && typeof data.name === 'string') {
			name = data.name;
		} else if (data.provider?.repoName != null) {
			name = data.provider.repoName;
		} else if (data.remote?.url != null && data.remote?.domain != null && data.remote?.path != null) {
			const matcher = getRemoteProviderMatcher(this.container);
			const provider = matcher(data.remote.url, data.remote.domain, data.remote.path);
			name = provider?.repoName ?? data.remote.path;
		} else {
			name =
				data.remote?.path ??
				`Unknown ${data.initialCommitSha ? ` (${shortenRevision(data.initialCommitSha)})` : ''}`;
		}

		return {
			id: data.id,
			createdAt: new Date(data.createdAt),
			updatedAt: new Date(data.updatedAt),
			name: name,
			initialCommitSha: data.initialCommitSha,
			remote: data.remote,
			provider: data.provider,
		};
	}

	async getProviderAuthFromRepository(
		repository: Repository,
	): Promise<{ provider: IntegrationId; token: string } | undefined> {
		const remoteProvider = await repository.getBestRemoteWithIntegration();
		if (remoteProvider == null) return undefined;

		const integration = await remoteProvider.getIntegration();
		if (integration == null) return undefined;

		const session = await this.container.integrationAuthentication.getSession(
			integration.id,
			integration.authProviderDescriptor,
		);
		if (session == null) return undefined;

		return {
			provider: integration.authProvider.id,
			token: session.accessToken,
		};
	}

	async getProviderAuthForIntegration(
		integrationId: IntegrationId,
	): Promise<{ provider: IntegrationId; token: string } | undefined> {
		const metadata = providersMetadata[integrationId];
		if (metadata == null) return undefined;
		const session = await this.container.integrationAuthentication.getSession(integrationId, {
			domain: metadata.domain,
			scopes: metadata.scopes,
		});
		if (session == null) return undefined;

		return {
			provider: integrationId,
			token: session.accessToken,
		};
	}

	async getCodeSuggestions(pullRequest: PullRequest, repository: Repository): Promise<Draft[]>;
	async getCodeSuggestions(focusItem: FocusItem, integrationId: IntegrationId): Promise<Draft[]>;
	async getCodeSuggestions(
		item: PullRequest | FocusItem,
		repositoryOrIntegrationId: Repository | IntegrationId,
	): Promise<Draft[]> {
		const entityIdentifier = getEntityIdentifierInput(item);
		const prEntityId = EntityIdentifierUtils.encode(entityIdentifier);
		const providerAuth = isRepository(repositoryOrIntegrationId)
			? await this.getProviderAuthFromRepository(repositoryOrIntegrationId)
			: await this.getProviderAuthForIntegration(repositoryOrIntegrationId);

		// swallowing this error as we don't need to fail here
		try {
			const drafts = await this.getDraftsCore({
				prEntityId: prEntityId,
				providerAuth: providerAuth,
				isArchived: true,
			});
			return drafts;
		} catch (e) {
			return [];
		}
	}

	@log()
	async getCodeSuggestionCounts(pullRequests: PullRequest[]): Promise<CodeSuggestionCounts> {
		const scope = getLogScope();

		type Result = { data: CodeSuggestionCountsResponse };

		const prEntityIds = pullRequests.map(pr => {
			return EntityIdentifierUtils.encode(getEntityIdentifierInput(pr));
		});

		const body = JSON.stringify({
			prEntityIds: prEntityIds,
		});

		try {
			const rsp = await this.connection.fetchGkDevApi(
				'v1/drafts/counts',
				{
					method: 'POST',
					body: body,
				},
				{
					query: 'type=suggested_pr_change',
				},
			);

			if (!rsp.ok) {
				await handleBadDraftResponse('Unable to open code suggestion counts', rsp, scope);
			}

			return ((await rsp.json()) as Result).data.counts;
		} catch (ex) {
			debugger;
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
