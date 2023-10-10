import type { Disposable } from 'vscode';
import type { Container } from '../../container';
import type { GitCloudPatch, GitPatch } from '../../git/models/patch';
import { isSha } from '../../git/models/reference';
import type { Repository } from '../../git/models/repository';
import { Logger } from '../../system/logger';
import { getLogScope } from '../../system/logger.scope';
import { getSettledValue } from '../../system/promise';
import type { ServerConnection } from '../gk/serverConnection';

export interface LocalDraft {
	readonly _brand: 'local';

	patch: GitPatch;
}

export interface Draft {
	readonly _brand: 'cloud';
	readonly type: 'patch' | 'stash';
	readonly id: string;

	readonly createdBy: string; // userId of creator
	readonly organizationId?: string;

	readonly deepLinkUrl: string;
	readonly isPublic: boolean;
	readonly latestChangesetId: string;

	readonly createdAt: Date;
	readonly updatedAt: Date;

	readonly title: string;
	readonly description?: string;

	readonly user?: {
		readonly id: string;
		readonly name: string;
		readonly email: string;
	};

	changesets?: DraftChangeset[];
}

export interface DraftChangeset {
	readonly id: string;
	readonly draftId: string;
	readonly parentChangesetId: string;

	readonly userId: string;
	readonly gitUserName: string;
	readonly gitUserEmail: string;

	readonly deepLinkUrl?: string;

	readonly createdAt: Date;
	readonly updatedAt: Date;

	readonly patches: GitCloudPatch[];
}

export interface DraftPatch {
	readonly id: string;
	// readonly draftId: string;
	readonly changesetId: string;
	readonly userId: string;

	readonly baseBranchName: string;
	readonly baseCommitSha: string;

	readonly gitRepositoryId?: string;

	contents?: string;
}

export class DraftService implements Disposable {
	constructor(
		private readonly container: Container,
		private readonly connection: ServerConnection,
	) {}

	dispose(): void {}

	async createDraft(
		type: 'patch' | 'stash',
		title: string,
		{ contents, baseSha, repository }: { contents: string; baseSha: string; repository: Repository },
		options?: { description?: string },
	): Promise<Draft | undefined> {
		const scope = getLogScope();

		try {
			const [remoteResult, userResult, branchResult, firstShaResult] = await Promise.allSettled([
				this.container.git.getBestRemoteWithProvider(repository.uri),
				this.container.git.getCurrentUser(repository.uri),
				repository.getBranch(),
				this.container.git.getFirstCommitSha(repository.path),
			]);

			const firstSha = getSettledValue(firstShaResult);
			// TODO: what happens if there are multiple remotes -- which one should we use? Do we need to ask? See more notes below
			const remote = getSettledValue(remoteResult);

			let gitRepoData: GitRepositoryDataRequest;
			if (remote == null) {
				if (firstSha == null) throw new Error('No remote or initial commit found');
				gitRepoData = {
					initialCommitSha: firstSha,
				};
			} else {
				gitRepoData = {
					initialCommitSha: firstSha,
					remoteUrl: remote.url,
					remoteDomain: remote.domain,
					remotePath: remote.path,
					remoteProvider: remote.provider.id,
					remoteProviderRepoDomain: remote.provider.domain,
					remoteProviderRepoName: remote.provider.path,
					// remoteProviderRepoOwnerDomain: ??
				};
			}

			const user = getSettledValue(userResult);

			const branch = getSettledValue(branchResult);
			const branchName = branch?.name ?? '';

			if (!isSha(baseSha)) {
				const commit = await repository.getCommit(baseSha);
				if (commit == null) throw new Error(`No commit found for ${baseSha}`);

				baseSha = commit.sha;
			}

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

			type ChangesetResult = { data: CreateDraftChangesetResponse };

			// POST /v1/drafts/:draftId/changesets
			const createChangesetRsp = await this.connection.fetchGkDevApi(`v1/drafts/${draftId}/changesets`, {
				method: 'POST',
				body: JSON.stringify({
					// parentChangesetId: null,
					gitUserName: user?.name,
					gitUserEmail: user?.email,
					patches: [
						{
							baseCommitSha: baseSha,
							baseBranchName: branchName,
							gitRepoData: gitRepoData,
						},
					],
				} satisfies CreateDraftChangesetRequest),
			});

			const createChangeset = ((await createChangesetRsp.json()) as ChangesetResult).data;
			const [patch] = createChangeset.patches;

			const { url, method, headers } = patch.secureUploadData;

			// Upload patch to returned S3 url
			await this.connection.fetchRaw(url, {
				method: method,
				headers: {
					'Content-Type': 'plain/text',
					Host: headers?.['Host']?.['0'] ?? '',
				},
				body: contents,
			});

			// POST /v1/drafts/:draftId/publish
			const publishRsp = await this.connection.fetchGkDevApi(`v1/drafts/${draftId}/publish`, { method: 'POST' });
			if (!publishRsp.ok) throw new Error(`Failed to publish draft: ${publishRsp.statusText}`);

			type Result = { data: DraftResponse };

			const draftRsp = await this.connection.fetchGkDevApi(`v1/drafts/${draftId}`, { method: 'GET' });

			const draft = ((await draftRsp.json()) as Result).data;

			return {
				_brand: 'cloud',
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
						patches: createChangeset.patches.map(p => ({
							_brand: 'cloud',
							id: p.id,
							changesetId: p.changesetId,
							userId: createChangeset.userId,
							baseBranchName: p.baseBranchName,
							baseCommitSha: p.baseCommitSha,
							contents: contents,

							repo: repository,
						})),
					},
				],
			};
		} catch (ex) {
			debugger;
			Logger.error(ex, scope);

			throw ex;
		}
	}

	async deleteDraft(id: string): Promise<void> {
		await this.connection.fetchGkDevApi(`v1/drafts/${id}`, {
			method: 'DELETE',
		});
	}

	async getDraft(id: string): Promise<Draft> {
		type Result = { data: DraftResponse };

		const rsp = await this.connection.fetchGkDevApi(`v1/drafts/${id}`, {
			method: 'GET',
		});

		const draft = ((await rsp.json()) as Result).data;
		const changeSets = await this.getChangesets(id);
		return {
			_brand: 'cloud',
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
			changesets: changeSets ?? [],
		};
	}

	async getDrafts(): Promise<Draft[]> {
		type Result = { data: DraftResponse[] };

		const rsp = await this.connection.fetchGkDevApi('/v1/drafts', {
			method: 'GET',
		});

		const draft = ((await rsp.json()) as Result).data;
		return draft.map(
			(d): Draft => ({
				_brand: 'cloud',
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
				const repoData = await this.getRepositoryData(p.gitRepositoryId);
				const repo = await this.container.git.findMatchingRepository({
					firstSha: repoData.initialCommitSha,
					remoteUrl: repoData.remoteUrl,
				});

				patches.push({
					_brand: 'cloud',
					id: p.id,
					changesetId: p.changesetId,
					userId: c.userId,
					baseBranchName: p.baseBranchName,
					baseCommitSha: p.baseCommitSha,
					contents: undefined!,

					// TODO@eamodio FIX THIS
					repo: repo ?? this.container.git.getBestRepository()!,
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

	async getRepositoryData(id: string): Promise<GitRepositoryDataResponse> {
		type Result = { data: GitRepositoryDataResponse };

		const rsp = await this.connection.fetchGkDevApi(`/v1/git-repositories/${id}`, {
			method: 'GET',
		});

		const data = ((await rsp.json()) as Result).data;
		return data;
	}
}

type BaseGitRepositoryDataRequest = {
	initialCommitSha?: string;
};

type BaseGitRepositoryDataRequestWithCommitSha = BaseGitRepositoryDataRequest & {
	initialCommitSha: string;
};

type BaseGitRepositoryDataRequestWithRemote = BaseGitRepositoryDataRequest & {
	remoteUrl: string;
	remoteDomain: string;
	remotePath: string;
};

type BaseGitRepositoryDataRequestWithRemoteProvider = BaseGitRepositoryDataRequestWithRemote & {
	remoteProvider: string;
	remoteProviderRepoDomain: string;
	remoteProviderRepoName: string;
	remoteProviderRepoOwnerDomain?: string;
};

type BaseGitRepositoryDataRequestWithoutRemoteProvider = BaseGitRepositoryDataRequestWithRemote & {
	remoteProvider?: never;
	remoteProviderRepoDomain?: never;
	remoteProviderRepoName?: never;
	remoteProviderRepoOwnerDomain?: never;
};

type GitRepositoryDataRequest =
	| BaseGitRepositoryDataRequestWithCommitSha
	| BaseGitRepositoryDataRequestWithRemote
	| BaseGitRepositoryDataRequestWithRemoteProvider
	| BaseGitRepositoryDataRequestWithoutRemoteProvider;

interface GitRepositoryDataResponse {
	readonly id: string;

	readonly initialCommitSha?: string;
	readonly remoteUrl?: string;
	readonly remoteDomain?: string;
	readonly remotePath?: string;
	readonly remoteProvider?: string;
	readonly remoteProviderRepoDomain?: string;
	readonly remoteProviderRepoName?: string;
	readonly remoteProviderRepoOwnerDomain?: string;

	readonly createdAt: string;
	readonly updatedAt: string;
}

interface CreateDraftRequest {
	type: 'patch' | 'stash';
	title: string;
	description?: string;
	isPublic: boolean;
	organizationId?: string;
}

interface CreateDraftResponse {
	id: string;
	deepLink: string;
}

interface CreateDraftChangesetRequest {
	parentChangesetId?: string | null;
	gitUserName?: string;
	gitUserEmail?: string;
	patches: CreateDraftPatchRequest[];
}

interface CreateDraftChangesetResponse {
	readonly id: string;
	readonly draftId: string;
	readonly parentChangesetId: string;

	readonly userId: string;
	readonly gitUserName: string;
	readonly gitUserEmail: string;

	readonly deepLink?: string;

	readonly createdAt: string;
	readonly updatedAt: string;
	readonly patches: CreateDraftPatchResponse[];
}

interface CreateDraftPatchRequest {
	baseCommitSha: string;
	baseBranchName: string;
	gitRepoData: GitRepositoryDataRequest;
}

interface CreateDraftPatchResponse {
	readonly id: string;
	readonly changesetId: string;

	readonly baseCommitSha: string;
	readonly baseBranchName: string;
	readonly gitRepositoryId: string;

	readonly secureUploadData: {
		readonly headers: {
			readonly Host: string[];
		};
		readonly method: string;
		readonly url: string;
	};
}

interface DraftResponse {
	readonly id: string;
	readonly type: 'patch' | 'stash';
	readonly createdBy: string;
	readonly organizationId?: string;

	readonly deepLink: string;
	readonly isPublic: boolean;
	readonly latestChangesetId: string;

	readonly createdAt: string;
	readonly updatedAt: string;

	readonly title: string;
	readonly description?: string;
}

interface DraftChangesetResponse {
	readonly id: string;
	readonly draftId: string;
	readonly parentChangesetId: string;

	readonly userId: string;
	readonly gitUserName: string;
	readonly gitUserEmail: string;

	readonly deepLink?: string;

	readonly createdAt: Date;
	readonly updatedAt: Date;

	readonly patches: DraftPatchResponse[];
}

interface DraftPatchResponse {
	readonly id: string;

	readonly changesetId: string;
	readonly userId: string;

	readonly baseCommitSha: string;
	readonly baseBranchName: string;

	readonly secureDownloadData: {
		readonly url: string;
		readonly method: string;
		readonly headers: {
			readonly Host: string[];
		};
	};

	readonly gitRepositoryId: string;
	readonly gitRepositoryData: GitRepositoryDataResponse;

	readonly createdAt: string;
	readonly updatedAt: string;
}
