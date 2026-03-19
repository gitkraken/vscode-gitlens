import { FileType } from '@gitlens/git/context.js';
import { deletedOrMissing } from '@gitlens/git/models/revision.js';
import type { GitTreeEntry } from '@gitlens/git/models/tree.js';
import type { GitRevisionSubProvider, ResolvedRevision } from '@gitlens/git/providers/revision.js';
import {
	isRevisionWithSuffix,
	isSha,
	isUncommitted,
	isUncommittedWithParentSuffix,
	stripOrigin,
} from '@gitlens/git/utils/revision.utils.js';
import { gate } from '@gitlens/utils/decorators/gate.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import type { Uri } from '@gitlens/utils/uri.js';
import { toTokenInfo } from '../../api/tokenUtils.js';
import type { GitHubGitProviderInternal } from '../githubProvider.js';

export class RevisionGitSubProvider implements GitRevisionSubProvider {
	constructor(private readonly provider: GitHubGitProviderInternal) {}

	@gate()
	@debug()
	getRevisionContent(repoPath: string, rev: string, path: string): Promise<Uint8Array | undefined> {
		const uri = rev
			? this.provider.createProviderUri(repoPath, rev, path)
			: this.provider.createVirtualUri(repoPath, rev, path);

		return this.provider.context.fs.readFile(uri);
	}

	@gate()
	@debug()
	async getTreeEntryForRevision(repoPath: string, rev: string, path: string): Promise<GitTreeEntry | undefined> {
		if (repoPath == null || !path) return undefined;

		if (path) {
			path = this.provider.getRelativePath(path, repoPath);
		}

		if (rev === 'HEAD') {
			const context = await this.provider.ensureRepositoryContext(repoPath);
			if (context == null) return undefined;

			const revision = await context.metadata.getRevision();
			rev = revision?.revision;
		}

		const uri = rev
			? this.provider.createProviderUri(repoPath, rev, path)
			: this.provider.createVirtualUri(repoPath, rev, path);

		const stats = await this.provider.context.fs.stat(uri);
		if (stats == null) return undefined;

		return {
			ref: rev,
			oid: '',
			path: this.provider.getRelativePath(uri, repoPath),
			size: stats.size,
			type: (stats.type & FileType.Directory) !== 0 ? 'tree' : 'blob',
		};
	}

	@debug()
	async getTrackedFiles(repoPath: string): Promise<string[]> {
		const tree = await this.getTreeForRevision(repoPath, 'HEAD');
		return tree.filter(f => f.type === 'blob').map(f => f.path);
	}

	@gate()
	@debug()
	async getTreeForRevision(repoPath: string, rev: string): Promise<GitTreeEntry[]> {
		if (repoPath == null) return [];

		if (rev === 'HEAD') {
			const context = await this.provider.ensureRepositoryContext(repoPath);
			if (context == null) return [];

			const revision = await context.metadata.getRevision();
			rev = revision?.revision;
		}

		const baseUri = rev
			? this.provider.createProviderUri(repoPath, rev)
			: this.provider.createVirtualUri(repoPath, rev);

		const entries = await this.provider.context.fs.readDirectory(baseUri);
		if (entries == null) return [];

		const result: GitTreeEntry[] = [];
		for (const [path, type] of entries) {
			result.push({
				ref: rev,
				oid: '',
				path: path,
				size: 0,
				type: (type & FileType.Directory) !== 0 ? 'tree' : 'blob',
			});
		}

		// TODO@eamodio: Implement this
		return [];
	}

	@debug()
	async resolveRevision(repoPath: string, ref: string, pathOrUri?: string | Uri): Promise<ResolvedRevision> {
		if (!ref || ref === deletedOrMissing) return { sha: ref, revision: ref };

		let relativePath;
		if (pathOrUri == null) {
			if (isSha(ref)) return { sha: ref, revision: ref };
			if (ref.endsWith('^3')) return { sha: ref, revision: ref };
		} else {
			if (isUncommittedWithParentSuffix(ref)) {
				ref = 'HEAD';
			}
			if (isUncommitted(ref)) return { sha: ref, revision: ref };

			relativePath = this.provider.getRelativePath(pathOrUri, repoPath);
		}

		const context = await this.provider.ensureRepositoryContext(repoPath);
		if (context == null) return { sha: ref, revision: ref };

		const { metadata, github, session } = context;

		const sha = await github.resolveReference(
			toTokenInfo(this.provider.authenticationProviderId, session),
			metadata.repo.owner,
			metadata.repo.name,
			stripOrigin(ref),
			relativePath,
		);

		if (sha == null) {
			return { sha: relativePath ? deletedOrMissing : ref, revision: ref };
		}
		// If it looks like non-sha like then preserve it as the friendly name
		return { sha: sha, revision: isRevisionWithSuffix(ref) ? sha : ref };
	}
}
