import { FileType, workspace } from 'vscode';
import type { Container } from '../../../../../container';
import type { GitRevisionSubProvider } from '../../../../../git/gitProvider';
import type { GitTreeEntry } from '../../../../../git/models/tree';
import { gate } from '../../../../../system/decorators/-webview/gate';
import { log } from '../../../../../system/decorators/log';
import type { GitHubGitProviderInternal } from '../githubGitProvider';

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
}
