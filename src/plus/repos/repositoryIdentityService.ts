import type { Disposable } from 'vscode';
import type { Container } from '../../container';
import type { Repository } from '../../git/models/repository';
import type { GkRepositoryId, RepositoryIdentity } from '../../gk/models/repositoryIdentities';
import { log } from '../../system/decorators/log';
import type { ServerConnection } from '../gk/serverConnection';

export class RepositoryIdentityService implements Disposable {
	constructor(
		private readonly container: Container,
		private readonly connection: ServerConnection,
	) {}

	dispose(): void {}

	@log()
	async getRepository(id: GkRepositoryId): Promise<Repository | undefined> {
		const identity = await this.getRepositoryIdentity(id);
		return this.container.git.findMatchingRepository({
			firstSha: identity.initialCommitSha,
			remoteUrl: identity.remote?.url,
		});
	}

	@log()
	async getRepositoryIdentity(id: GkRepositoryId): Promise<RepositoryIdentity> {
		type Result = { data: RepositoryIdentity };

		const rsp = await this.connection.fetchGkDevApi(`/v1/git-repositories/${id}`, { method: 'GET' });

		const data = ((await rsp.json()) as Result).data;
		return data;
	}
}
