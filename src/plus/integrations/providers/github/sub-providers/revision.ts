import type { Uri } from 'vscode';
import { FileType, workspace } from 'vscode';
import type { Container } from '../../../../../container';
import type { GitRevisionSubProvider, ResolvedRevision } from '../../../../../git/gitProvider';
import { deletedOrMissing } from '../../../../../git/models/revision';
import type { GitTreeEntry } from '../../../../../git/models/tree';
import {
	isRevisionWithSuffix,
	isSha,
	isUncommitted,
	isUncommittedWithParentSuffix,
} from '../../../../../git/utils/revision.utils';
import { gate } from '../../../../../system/decorators/gate';
import { log } from '../../../../../system/decorators/log';
import type { GitHubGitProviderInternal } from '../githubGitProvider';
import { stripOrigin } from '../githubGitProvider';

export class RevisionGitSubProvider implements GitRevisionSubProvider {
	constructor(
		private readonly container: Container,
		private readonly provider: GitHubGitProviderInternal,
	) {}

	@gate()
	@log()
	async getRevisionContent(repoPath: string, rev: string, path: string): Promise<Uint8Array | undefined> {
		const uri = rev
			? this.provider.createProviderUri(repoPath, rev, path)
			: this.provider.createVirtualUri(repoPath, rev, path);
		return workspace.fs.readFile(uri);
	}

	@gate()
	@log()
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

		const stats = await workspace.fs.stat(uri);
		if (stats == null) return undefined;

		return {
			ref: rev,
			oid: '',
			path: this.provider.getRelativePath(uri, repoPath),
			size: stats.size,
			type: (stats.type & FileType.Directory) === FileType.Directory ? 'tree' : 'blob',
		};
	}

	@gate()
	@log()
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

		const entries = await workspace.fs.readDirectory(baseUri);
		if (entries == null) return [];

		const result: GitTreeEntry[] = [];
		for (const [path, type] of entries) {
			const uri = this.provider.getAbsoluteUri(path, baseUri);

			// TODO:@eamodio do we care about size?
			// const stats = await workspace.fs.stat(uri);

			result.push({
				ref: rev,
				oid: '',
				path: this.provider.getRelativePath(path, uri),
				size: 0, // stats?.size,
				type: (type & FileType.Directory) === FileType.Directory ? 'tree' : 'blob',
			});
		}

		// TODO@eamodio: Implement this
		return [];
	}

	@log()
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
			session.accessToken,
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
