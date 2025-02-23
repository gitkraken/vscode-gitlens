import type { Container } from '../../../../container';
import type { GitCache } from '../../../../git/cache';
import { GitErrorHandling } from '../../../../git/commandOptions';
import type { GitRevisionSubProvider } from '../../../../git/gitProvider';
import type { GitTreeEntry } from '../../../../git/models/tree';
import { parseGitLsFiles, parseGitTree } from '../../../../git/parsers/treeParser';
import { isUncommittedStaged } from '../../../../git/utils/revision.utils';
import { splitPath } from '../../../../system/-webview/path';
import { gate } from '../../../../system/decorators/-webview/gate';
import { log } from '../../../../system/decorators/log';
import type { Git } from '../git';
import type { LocalGitProvider } from '../localGitProvider';

export class RevisionGitSubProvider implements GitRevisionSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly cache: GitCache,
		private readonly provider: LocalGitProvider,
	) {}

	@gate()
	@log()
	getRevisionContent(repoPath: string, rev: string, path: string): Promise<Uint8Array | undefined> {
		const [relativePath, root] = splitPath(path, repoPath);

		return this.git.show__content<Buffer>(root, relativePath, rev, { encoding: 'buffer' }) as Promise<
			Uint8Array | undefined
		>;
	}

	@gate()
	@log()
	async getTreeEntryForRevision(repoPath: string, rev: string, path: string): Promise<GitTreeEntry | undefined> {
		if (repoPath == null || !path) return undefined;

		const [relativePath, root] = splitPath(path, repoPath);

		if (isUncommittedStaged(rev)) {
			let data = await this.git.ls_files(root, relativePath, { rev: rev });
			const [result] = parseGitLsFiles(data);
			if (result == null) return undefined;

			data = (await this.git.exec({ cwd: repoPath }, 'cat-file', '-s', result.oid))?.trim();
			const size = data.length ? parseInt(data, 10) : 0;

			return {
				ref: rev,
				oid: result.oid,
				path: relativePath,
				size: size,
				type: 'blob',
			};
		}

		const entries = await this.getTreeForRevisionCore(repoPath, rev, path);
		return entries[0];
	}

	@gate()
	@log()
	async getTreeForRevision(repoPath: string, rev: string): Promise<GitTreeEntry[]> {
		if (repoPath == null) return [];

		return this.getTreeForRevisionCore(repoPath, rev);
	}

	@gate()
	private async getTreeForRevisionCore(repoPath: string, rev: string, path?: string): Promise<GitTreeEntry[]> {
		const args = path ? ['-l', rev, '--', path] : ['-lrt', rev, '--'];
		const data = (
			await this.git.exec({ cwd: repoPath, errors: GitErrorHandling.Ignore }, 'ls-tree', ...args)
		)?.trim();
		if (!data) return [];

		return parseGitTree(data, rev);
	}
}
