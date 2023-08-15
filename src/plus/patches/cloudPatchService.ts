import type { Disposable } from 'vscode';
import { Uri } from 'vscode';
import type { Container } from '../../container';
import type { Repository } from '../../git/models/repository';
import { getSettledValue } from '../../system/promise';
import type { ServerConnection } from '../gk/serverConnection';

export interface CloudPatch {
	id: string;
	linkUrl: string;
}

export class CloudPatchService implements Disposable {
	// private _disposable: Disposable;
	// private _subscription: Subscription | undefined;

	constructor(
		private readonly container: Container,
		private readonly connection: ServerConnection,
	) {
		// this._disposable = Disposable.from(container.subscription.onDidChange(this.onSubscriptionChanged, this));
	}

	dispose(): void {
		// this._disposable.dispose();
	}

	// private onSubscriptionChanged(_e: SubscriptionChangeEvent): void {
	// 	this._subscription = undefined;
	// }

	// private async ensureSubscription(force?: boolean) {
	// 	if (force || this._subscription == null) {
	// 		this._subscription = await this.container.subscription.getSubscription();
	// 	}
	// 	return this._subscription;
	// }

	async create(repository: Repository, baseSha: string, contents: string): Promise<CloudPatch | undefined> {
		// const subscription = await this.ensureSubscription();
		// if (subscription.account == null) return undefined;

		const [remoteResult, userResult, branchResult] = await Promise.allSettled([
			this.container.git.getBestRemoteWithProvider(repository.uri),
			this.container.git.getCurrentUser(repository.uri),
			repository.getBranch(),
		]);

		// TODO: what happens if there are multiple remotes -- which one should we use? Do we need to ask? See more notes below
		const remote = getSettledValue(remoteResult);
		if (remote?.provider == null) throw new Error('No Git provider found');

		const user = getSettledValue(userResult);
		const gitProfileId = user?.email ?? user?.name ?? '';

		const branch = getSettledValue(branchResult);
		const branchName = branch?.name ?? '';

		// POST v1/drafts
		const draftResponse = await this.connection.fetch(
			Uri.joinPath(this.connection.baseGkApiUri, 'v1/drafts').toString(),
			{
				method: 'POST',
				// body: JSON.stringify({ userId: subscription.account.id }),
			},
		);

		const draftData = (await draftResponse.json()).data;
		const draftId = draftData.id;
		const draftDeepLinkUrl = draftData.deepLink;

		// POST /v1/drafts/:draftId/patches
		const patchCreateResponse = await this.connection.fetch(
			Uri.joinPath(this.connection.baseGkApiUri, `v1/drafts/${draftId}/patches`).toString(),
			{
				method: 'POST',
				// body: JSON.stringify({ userId: subscription.account.id }),
			},
		);

		const patchCreatedData = (await patchCreateResponse.json()).data;
		const { url, method, headers } = patchCreatedData.secureUploadData;
		const patchId = patchCreatedData.id;

		// Upload patch to returned S3 url
		await this.connection.fetch(url, {
			method: method,
			headers: {
				'Content-Type': 'plain/text',
				Host: headers?.['Host']?.['0'] ?? '',
			},
			body: contents,
		});

		// PATCH /v1/patches/:patchId
		await this.connection.fetch(Uri.joinPath(this.connection.baseGkApiUri, `/v1/patches/${patchId}`).toString(), {
			method: 'PATCH',
			body: JSON.stringify({
				baseCommitSha: baseSha,
				gitProfileId: gitProfileId,
				gitProvider: remote.provider.id,
				// TODO: this is a hack and won't always work, so we probably need to plumb this through the RemoteProviders
				// BUT there is a bigger issue with repo identification here -- as we also need to know the base url of the repo (self-hosted)
				gitRepositoryName: remote.provider.path.split('/')[1],
				gitRepositoryOwner: remote.provider.owner,
				gitBranchName: branchName,
			}),
		});

		return {
			id: draftId,
			linkUrl: draftDeepLinkUrl,
		};
	}

	// eslint-disable-next-line @typescript-eslint/require-await
	async get(_id: string): Promise<CloudPatch | undefined> {
		// TODO
		return undefined;
	}

	async getPatchContents(id: string): Promise<string | undefined> {
		// const subscription = await this.ensureSubscription();
		// if (subscription.account == null) return undefined;

		// GET /v1/patches/:patchId
		const patchResponse = await this.connection.fetch(
			Uri.joinPath(this.connection.baseGkApiUri, `/v1/patches/${id}`).toString(),
			{
				method: 'GET',
			},
		);

		const patchData = (await patchResponse.json()).data;
		const { url, method, headers } = patchData.secureDownloadData;

		// Download patch from returned S3 url
		const patchDownloadResponse = await this.connection.fetch(url, {
			method: method,
			headers: {
				Accept: 'text/plain',
				Host: headers?.['Host']?.['0'] ?? '',
			},
		});

		return patchDownloadResponse.text();
	}
}
