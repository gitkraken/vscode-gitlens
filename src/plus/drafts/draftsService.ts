import type { Disposable } from 'vscode';
import type { Container } from '../../container';
import type { GitCloudPatch } from '../../git/models/patch';
import { isSha } from '../../git/models/reference';
import type { GitUser } from '../../git/models/user';
import type {
	CreateDraftChange,
	CreateDraftChangesetRequest,
	CreateDraftChangesetResponse,
	CreateDraftPatchRequest,
	CreateDraftRequest,
	CreateDraftResponse,
	Draft,
	DraftChangeset,
	DraftChangesetResponse,
	DraftPatch,
	DraftPatchResponse,
	DraftResponse,
} from '../../gk/models/drafts';
import type { RepositoryIdentityRequest } from '../../gk/models/repositoryIdentities';
import { log } from '../../system/decorators/log';
import { Logger } from '../../system/logger';
import { getLogScope } from '../../system/logger.scope';
import { getSettledValue } from '../../system/promise';
import type { ServerConnection } from '../gk/serverConnection';

export class DraftService implements Disposable {
	constructor(
		private readonly container: Container,
		private readonly connection: ServerConnection,
	) {}

	dispose(): void {}

	// @log({ args: { 2: false } })
	// async createDraft2(
	// 	type: 'patch' | 'stash',
	// 	title: string,
	// 	changes: { contents: string; baseSha: string; branchName: string; repository: Repository }[],
	// 	options?: { description?: string },
	// ): Promise<Draft | undefined> {
	// 	const scope = getLogScope();

	// 	try {
	// 	} catch (ex) {
	// 		debugger;
	// 		Logger.error(ex, scope);

	// 		throw ex;
	// 	}
	// }

	private async getCreateDraftPatchRequest(
		change: CreateDraftChange,
	): Promise<{ change: CreateDraftChange; patch: CreateDraftPatchRequest; user: GitUser | undefined }> {
		const [remoteResult, userResult, branchResult, firstShaResult] = await Promise.allSettled([
			this.container.git.getBestRemoteWithProvider(change.repository.uri),
			this.container.git.getCurrentUser(change.repository.uri),
			change.repository.getBranch(),
			this.container.git.getFirstCommitSha(change.repository.path),
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

		const user = getSettledValue(userResult);

		const branch = getSettledValue(branchResult);
		const branchName = branch?.name ?? '';
		let baseSha = change.baseSha;
		if (!isSha(change.baseSha)) {
			const commit = await change.repository.getCommit(change.baseSha);
			if (commit == null) throw new Error(`No commit found for ${change.baseSha}`);

			baseSha = commit.sha;
		}

		return {
			change: change,
			patch: {
				baseCommitSha: baseSha,
				baseBranchName: branchName,
				gitRepoData: repoData,
			},
			user: user,
		};
	}

	@log({ args: { 2: false } })
	async createDraft(
		type: 'patch' | 'stash',
		title: string,
		changes: CreateDraftChange[],
		options?: { description?: string; organizationId?: string },
	): Promise<Draft | undefined> {
		const scope = getLogScope();

		try {
			const patchesPromise = Promise.allSettled(changes.map(c => this.getCreateDraftPatchRequest(c)));

			type DraftResult = { data: CreateDraftResponse };

			// POST v1/drafts
			const createDraftRsp = await this.connection.fetchGkDevApi('v1/drafts', {
				method: 'POST',
				body: JSON.stringify({
					type: type,
					title: title,
					description: options?.description,
					isPublic: true /*organizationId: undefined,*/,
				} satisfies CreateDraftRequest),
			});

			const createDraft = ((await createDraftRsp.json()) as DraftResult).data;
			const draftId = createDraft.id;

			const results = await patchesPromise;
			const failed = results.filter(
				(r: PromiseSettledResult<any>): r is PromiseRejectedResult => r.status === 'rejected',
			);
			if (failed.length) {
				debugger;
				throw new AggregateError(
					failed.map(r => r.reason as Error),
					'Unable to create draft',
				);
			}

			const user = getSettledValue(results.find(r => getSettledValue(r)?.user != null))?.user;
			const patches = results.map(r => {
				const { change, patch } = getSettledValue(r)!;
				return [change, patch] as const;
			});

			type ChangesetResult = { data: CreateDraftChangesetResponse };

			// POST /v1/drafts/:draftId/changesets
			const createChangesetRsp = await this.connection.fetchGkDevApi(`v1/drafts/${draftId}/changesets`, {
				method: 'POST',
				body: JSON.stringify({
					// parentChangesetId: null,
					gitUserName: user?.name,
					gitUserEmail: user?.email,
					patches: patches.map(([, p]) => p),
				} satisfies CreateDraftChangesetRequest),
			});

			const createChangeset = ((await createChangesetRsp.json()) as ChangesetResult).data;

			const patchResults: GitCloudPatch[] = [];

			let i = 0;
			for (const patch of createChangeset.patches) {
				const { url, method, headers } = patch.secureUploadData;

				const { contents, repository } = patches[i++][0];
				if (contents == null) {
					debugger;
					throw new Error(`No contents found for ${patch.baseCommitSha}`);
				}

				// Upload patch to returned S3 url
				await this.connection.fetchRaw(url, {
					method: method,
					headers: {
						'Content-Type': 'plain/text',
						Host: headers?.['Host']?.['0'] ?? '',
					},
					body: contents,
				});

				patchResults.push({
					type: 'cloud',
					id: patch.id,
					changesetId: patch.changesetId,
					userId: createChangeset.userId,
					baseBranchName: patch.baseBranchName,
					baseCommitSha: patch.baseCommitSha,

					contents: contents,
					repo: repository,
				});
			}

			// POST /v1/drafts/:draftId/publish
			const publishRsp = await this.connection.fetchGkDevApi(`v1/drafts/${draftId}/publish`, {
				method: 'POST',
			});
			if (!publishRsp.ok) throw new Error(`Failed to publish draft: ${publishRsp.statusText}`);

			type Result = { data: DraftResponse };

			const draftRsp = await this.connection.fetchGkDevApi(`v1/drafts/${draftId}`, { method: 'GET' });

			const draft = ((await draftRsp.json()) as Result).data;

			return {
				draftType: 'cloud',
				type: draft.type,
				id: draftId,
				createdBy: draft.createdBy,
				organizationId: draft.organizationId,
				deepLinkUrl: createDraft.deepLink,
				isPublic: draft.isPublic,
				latestChangesetId: draft.latestChangesetId,

				createdAt: new Date(draft.createdAt),
				updatedAt: new Date(draft.updatedAt),

				title: draft.title,
				description: draft.description,

				changesets: [
					{
						id: createChangeset.id,
						draftId: createChangeset.draftId,
						parentChangesetId: createChangeset.parentChangesetId,
						userId: createChangeset.userId,
						gitUserName: createChangeset.gitUserName,
						gitUserEmail: createChangeset.gitUserEmail,
						deepLinkUrl: createChangeset.deepLink,
						createdAt: new Date(createChangeset.createdAt),
						updatedAt: new Date(createChangeset.updatedAt),
						patches: patchResults,
					},
				],
			} satisfies Draft;
		} catch (ex) {
			debugger;
			Logger.error(ex, scope);

			throw ex;
		}
	}

	@log()
	async deleteDraft(id: string): Promise<void> {
		await this.connection.fetchGkDevApi(`v1/drafts/${id}`, {
			method: 'DELETE',
		});
	}

	@log()
	async getDraft(id: string): Promise<Draft> {
		type Result = { data: DraftResponse };

		const rsp = await this.connection.fetchGkDevApi(`v1/drafts/${id}`, {
			method: 'GET',
		});

		if (!rsp.ok) {
			Logger.error(undefined, `Getting draft failed: (${rsp.status}) ${rsp.statusText}`);
			throw new Error(rsp.statusText);
		}

		const draft = ((await rsp.json()) as Result).data;
		const changesets = await this.getChangesets(id);
		return {
			draftType: 'cloud',
			type: draft.type,
			id: draft.id,
			createdBy: draft.createdBy,
			organizationId: draft.organizationId,
			deepLinkUrl: draft.deepLink,
			isPublic: draft.isPublic,
			latestChangesetId: draft.latestChangesetId,
			createdAt: new Date(draft.createdAt),
			updatedAt: new Date(draft.updatedAt),
			title: draft.title,
			description: draft.description,
			changesets: changesets ?? [],
		};
	}

	@log()
	async getDrafts(): Promise<Draft[]> {
		type Result = { data: DraftResponse[] };

		const rsp = await this.connection.fetchGkDevApi('/v1/drafts', {
			method: 'GET',
		});

		const draft = ((await rsp.json()) as Result).data;
		return draft.map(
			(d): Draft => ({
				draftType: 'cloud',
				type: d.type,
				id: d.id,
				createdBy: d.createdBy,
				organizationId: d.organizationId,
				deepLinkUrl: d.deepLink,
				isPublic: d.isPublic,
				latestChangesetId: d.latestChangesetId,
				createdAt: new Date(d.createdAt),
				updatedAt: new Date(d.updatedAt),
				title: d.title,
				description: d.description,
			}),
		);
	}

	@log()
	async getChangesets(id: string): Promise<DraftChangeset[]> {
		type Result = { data: DraftChangesetResponse[] };

		const rsp = await this.connection.fetchGkDevApi(`/v1/drafts/${id}/changesets`, {
			method: 'GET',
		});

		const changeset = ((await rsp.json()) as Result).data;

		const changesets: DraftChangeset[] = [];
		for (const c of changeset) {
			const patches: GitCloudPatch[] = [];

			for (const p of c.patches) {
				const repoData = await this.container.repositoryIdentity.getRepositoryIdentity(p.gitRepositoryId);
				const repo = await this.container.git.findMatchingRepository({
					firstSha: repoData.initialCommitSha,
					remoteUrl: repoData.remote?.url,
				});

				patches.push({
					type: 'cloud',
					id: p.id,
					changesetId: p.changesetId,
					userId: c.userId,
					baseBranchName: p.baseBranchName,
					baseCommitSha: p.baseCommitSha,
					contents: undefined!,

					// TODO@eamodio FIX THIS
					repo: repo,
					repoData: repoData,
				});
			}

			changesets.push({
				id: c.id,
				draftId: c.draftId,
				parentChangesetId: c.parentChangesetId,
				userId: c.userId,
				gitUserName: c.gitUserName,
				gitUserEmail: c.gitUserEmail,
				deepLinkUrl: c.deepLink,
				createdAt: new Date(c.createdAt),
				updatedAt: new Date(c.updatedAt),
				patches: patches,
			});
		}

		return changesets;
	}

	// TODO: Remove this. /drafts/{id}/patches is no longer a valid route - patches come from a changeset
	// now (see getChangesets function above). We can maybe implement getPatchContentsCore there and add
	// an includeContents option to use it.
	@log()
	async getPatches(id: string, options?: { includeContents?: boolean }): Promise<DraftPatch[]> {
		type Result = { data: DraftPatchResponse[] };

		const rsp = await this.connection.fetchGkDevApi(`/v1/drafts/${id}/patches`, {
			method: 'GET',
		});

		const data = ((await rsp.json()) as Result).data;
		const patches = await Promise.allSettled(
			data.map(async (d): Promise<DraftPatch> => {
				let contents = undefined;
				if (options?.includeContents) {
					try {
						contents = await this.getPatchContentsCore(d.secureDownloadData);
					} catch (ex) {
						debugger;
					}
				}

				return {
					id: d.id,
					// draftId: d.draftId,
					changesetId: d.changesetId,
					userId: d.userId,
					baseBranchName: d.baseBranchName,
					baseCommitSha: d.baseCommitSha,
					contents: contents,
				};
			}),
		);

		return patches
			.filter(
				(p: PromiseSettledResult<DraftPatch>): p is PromiseFulfilledResult<DraftPatch> =>
					p.status === 'fulfilled',
			)
			.map(p => p.value);
	}

	@log()
	async getPatch(id: string): Promise<DraftPatch | undefined> {
		type Result = { data: DraftPatchResponse };

		const rsp = await this.connection.fetchGkDevApi(`/v1/patches/${id}`, {
			method: 'GET',
		});

		const data = ((await rsp.json()) as Result).data;
		const contents = await this.getPatchContentsCore(data.secureDownloadData);

		return {
			id: data.id,
			// draftId: data.draftId,
			changesetId: data.changesetId,
			userId: data.userId,
			baseBranchName: data.baseBranchName,
			baseCommitSha: data.baseCommitSha,
			contents: contents,
		};
	}

	@log()
	async getPatchContents(id: string): Promise<string | undefined> {
		type Result = { data: DraftPatchResponse };

		// GET /v1/patches/:patchId
		const rsp = await this.connection.fetchGkDevApi(`/v1/patches/${id}`, {
			method: 'GET',
		});

		const data = ((await rsp.json()) as Result).data;
		return this.getPatchContentsCore(data.secureDownloadData);
	}

	private async getPatchContentsCore(
		secureLink: DraftPatchResponse['secureDownloadData'],
	): Promise<string | undefined> {
		const { url, method, headers } = secureLink;

		// Download patch from returned S3 url
		const contentsRsp = await this.connection.fetchRaw(url, {
			method: method,
			headers: {
				Accept: 'text/plain',
				Host: headers?.['Host']?.['0'] ?? '',
			},
		});

		return contentsRsp.text();
	}

	// async getRepositoryData(id: string): Promise<GitRepositoryData> {
	// 	type Result = { data: GitRepositoryData };

	// 	const rsp = await this.connection.fetchGkDevApi(`/v1/git-repositories/${id}`, {
	// 		method: 'GET',
	// 	});

	// 	const data = ((await rsp.json()) as Result).data;
	// 	return data;
	// }
}

// type BaseGitRepositoryDataRequest = {
// 	initialCommitSha?: string;
// };

// type BaseGitRepositoryDataRequestWithCommitSha = BaseGitRepositoryDataRequest & {
// 	initialCommitSha: string;
// };

// type BaseGitRepositoryDataRequestWithRemote = BaseGitRepositoryDataRequest & {
// 	remote: { url: string; domain: string; path: string };
// };

// type BaseGitRepositoryDataRequestWithRemoteProvider = BaseGitRepositoryDataRequestWithRemote & {
// 	provider: {
// 		id: GkProviderId;
// 		repoDomain: string;
// 		repoName: string;
// 		repoOwnerDomain?: string;
// 	};
// };

// type BaseGitRepositoryDataRequestWithoutRemoteProvider = BaseGitRepositoryDataRequestWithRemote & {
// 	provider?: never;
// };

// type GitRepositoryDataRequest =
// 	| BaseGitRepositoryDataRequestWithCommitSha
// 	| BaseGitRepositoryDataRequestWithRemote
// 	| BaseGitRepositoryDataRequestWithRemoteProvider
// 	| BaseGitRepositoryDataRequestWithoutRemoteProvider;
