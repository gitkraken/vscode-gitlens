import type { Uri } from 'vscode';
import { Schemes } from '../../../../constants.js';
import type { Container } from '../../../../container.js';
import type { GitCache } from '../../../../git/cache.js';
import type { GitRevisionSubProvider, ResolvedRevision } from '../../../../git/gitProvider.js';
import { GitUri } from '../../../../git/gitUri.js';
import type { GitFileStatus } from '../../../../git/models/fileStatus.js';
import { deletedOrMissing } from '../../../../git/models/revision.js';
import type { GitTreeEntry } from '../../../../git/models/tree.js';
import { parseGitLsFilesStaged } from '../../../../git/parsers/indexParser.js';
import { getShaAndFileSummaryLogParser } from '../../../../git/parsers/logParser.js';
import { parseGitTree } from '../../../../git/parsers/treeParser.js';
import {
	isRevisionWithSuffix,
	isSha,
	isUncommitted,
	isUncommittedStaged,
	isUncommittedWithParentSuffix,
} from '../../../../git/utils/revision.utils.js';
import { splitPath } from '../../../../system/-webview/path.js';
import { gate } from '../../../../system/decorators/gate.js';
import { debug } from '../../../../system/decorators/log.js';
import { first } from '../../../../system/iterable.js';
import type { Git } from '../git.js';
import type { LocalGitProviderInternal } from '../localGitProvider.js';

const emptyArray: readonly any[] = Object.freeze([]);

export class RevisionGitSubProvider implements GitRevisionSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly cache: GitCache,
		private readonly provider: LocalGitProviderInternal,
	) {}

	exists(repoPath: string, path: string, rev?: string): Promise<boolean>;
	exists(repoPath: string, path: string, options?: { untracked?: boolean }): Promise<boolean>;
	async exists(repoPath: string, path: string, revOrOptions?: string | { untracked?: boolean }): Promise<boolean> {
		let rev: string | undefined;
		let untracked: boolean | undefined;
		if (typeof revOrOptions === 'string') {
			rev = revOrOptions;
		} else if (revOrOptions != null) {
			untracked = revOrOptions.untracked;
		}

		const cacheKey = `${path}\0${rev ?? ''}\0${untracked ? 'u' : ''}`;
		return this.cache.fileExistence.getOrCreate(repoPath, cacheKey, async () => {
			const args = ['ls-files'];
			if (rev) {
				if (!isUncommitted(rev)) {
					args.push(`--with-tree=${rev}`);
				} else if (isUncommittedStaged(rev)) {
					args.push('--stage');
				}
			} else if (untracked) {
				args.push('-o');
			}

			const result = await this.git.exec({ cwd: repoPath, errors: 'ignore' }, ...args, '--', path);
			return Boolean(result.stdout.trim());
		});
	}

	@gate()
	@debug()
	getRevisionContent(repoPath: string, rev: string, path: string): Promise<Uint8Array | undefined> {
		const [relativePath, root] = splitPath(path, repoPath);
		return this.git.show__content<Buffer>(root, relativePath, rev, { encoding: 'buffer', errors: 'throw' });
	}

	@debug()
	async getSubmoduleHead(repoPath: string, submodulePath: string): Promise<string | undefined> {
		// Verify the path is a submodule (gitlink commit) in the parent tree, not just a regular directory
		const treeEntry = await this.getTreeEntryForRevision(repoPath, 'HEAD', submodulePath);
		if (treeEntry?.type !== 'commit') return undefined;

		const [relativePath, root] = splitPath(submodulePath, repoPath);
		const submoduleFullPath = this.provider.getAbsoluteUri(relativePath, root).fsPath;

		const result = await this.git.exec({ cwd: submoduleFullPath, errors: 'ignore' }, 'rev-parse', 'HEAD');
		const sha = result.stdout.trim();
		return sha || undefined;
	}

	@gate()
	@debug()
	async getTreeEntryForRevision(repoPath: string, rev: string, path: string): Promise<GitTreeEntry | undefined> {
		if (!repoPath || !path) return undefined;

		const [relativePath, root] = splitPath(path, repoPath);

		if (isUncommittedStaged(rev)) {
			let result = await this.git.exec(
				{ cwd: root, errors: 'ignore' },
				'ls-files',
				'-z',
				'--stage',
				'--',
				relativePath,
			);

			const [entry] = parseGitLsFilesStaged(result.stdout, true);
			if (entry == null) return undefined;

			result = await this.git.exec({ cwd: root }, 'cat-file', '-s', entry.oid);
			const size = result ? parseInt(result.stdout.trim(), 10) : 0;

			return { ref: rev, oid: entry.oid, path: relativePath, size: size, type: 'blob' };
		}

		const [entry] = await this.getTreeForRevisionCore(repoPath, rev, path);
		return entry;
	}

	@debug()
	async getTreeForRevision(repoPath: string, rev: string): Promise<GitTreeEntry[]> {
		return repoPath ? this.getTreeForRevisionCore(repoPath, rev) : [];
	}

	@gate()
	private async getTreeForRevisionCore(repoPath: string, rev: string, path?: string): Promise<GitTreeEntry[]> {
		const hasPath = Boolean(path);
		const args = hasPath ? ['ls-tree', '-l', rev, '--', path] : ['ls-tree', '-lrt', rev, '--'];
		const result = await this.git.exec({ cwd: repoPath, errors: 'ignore' }, ...args);
		const data = result.stdout.trim();
		if (!data) return emptyArray as GitTreeEntry[];

		return parseGitTree(data, rev, hasPath);
	}

	@debug()
	async resolveRevision(repoPath: string, ref: string, pathOrUri?: string | Uri): Promise<ResolvedRevision> {
		if (!ref || ref === deletedOrMissing) return { sha: ref, revision: ref };

		if (pathOrUri == null) {
			if (isSha(ref)) return { sha: ref, revision: ref };
			if (ref.endsWith('^3')) return { sha: ref, revision: ref };

			const sha = await this.provider.refs.validateReference(repoPath, ref);
			if (sha == null) return { sha: ref, revision: ref };

			return {
				sha: sha,
				// If it looks like non-sha like then preserve it as the friendly name
				revision: isRevisionWithSuffix(ref) ? sha : ref,
			};
		} else if (typeof pathOrUri !== 'string' && pathOrUri.scheme === Schemes.GitLens) {
			// If this is a gitlens:// URI with a submoduleSha, return it directly without looking it up
			// (the sha is a submodule commit that doesn't exist in the parent repo)
			const gitUri = new GitUri(pathOrUri);
			if (gitUri.submoduleSha) {
				return { sha: gitUri.submoduleSha, revision: gitUri.submoduleSha };
			}
		}

		if (isUncommittedWithParentSuffix(ref)) {
			ref = 'HEAD';
		}
		const relativePath = this.provider.getRelativePath(pathOrUri, repoPath);

		if (isUncommitted(ref)) {
			if (!isUncommittedStaged(ref)) {
				return { sha: ref, revision: ref };
			}

			// Ensure that the file is actually staged
			const status = await this.provider.status.getStatusForFile(repoPath, relativePath, { renames: false });
			if (status?.indexStatus) return { sha: ref, revision: ref };

			ref = 'HEAD';
		}

		const parser = getShaAndFileSummaryLogParser();
		let result = await this.git.exec(
			{ cwd: repoPath, errors: 'ignore' },
			'log',
			...parser.arguments,
			'-n1',
			ref,
			'--',
			relativePath,
		);

		let commit = first(parser.parse(result.stdout));
		let file = commit?.files?.find(f => f.path === relativePath);
		if (file == null) {
			return {
				sha: commit?.sha ?? deletedOrMissing,
				// If it looks like non-sha like then preserve it as the friendly name
				revision: isRevisionWithSuffix(ref) ? (commit?.sha ?? ref) : ref,
			};
		}

		if (file.status === 'A') {
			return {
				sha: commit?.sha ?? deletedOrMissing,
				// If it looks like non-sha like then preserve it as the friendly name
				revision: isRevisionWithSuffix(ref) ? (commit?.sha ?? ref) : ref,
				status: file.status as GitFileStatus,
				originalPath: file.originalPath,
			};
		}

		if (file.status === 'D') {
			// If the file was deleted, check if it was moved or renamed
			result = await this.git.exec(
				{ cwd: repoPath, errors: 'ignore' },
				'log',
				...parser.arguments,
				'-n1',
				commit!.sha,
				'--',
			);

			commit = first(parser.parse(result.stdout));
			file = commit?.files?.find(f => f.path === relativePath || f.originalPath === relativePath);
			if (file == null) {
				return {
					sha: commit?.sha ?? deletedOrMissing,
					// If it looks like non-sha like then preserve it as the friendly name
					revision: isRevisionWithSuffix(ref) ? (commit?.sha ?? ref) : ref,
				};
			}

			return {
				sha: commit?.sha ?? deletedOrMissing,
				// If it looks like non-sha like without a suffix then preserve it as the friendly name
				revision: isRevisionWithSuffix(ref) ? (commit?.sha ?? ref) : ref,
				status: file?.status as GitFileStatus,
				path: file?.path,
				originalPath: file?.originalPath,
			};
		}

		return {
			sha: commit?.sha ?? deletedOrMissing,
			// If it looks like non-sha like then preserve it as the friendly name
			revision: isRevisionWithSuffix(ref) ? (commit?.sha ?? ref) : ref,
			status: file.status as GitFileStatus,
			originalPath: file.originalPath,
		};
	}
}
