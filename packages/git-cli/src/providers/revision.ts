import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import { ShowError } from '@gitlens/git/errors.js';
import type { GitFileStatus } from '@gitlens/git/models/fileStatus.js';
import { deletedOrMissing } from '@gitlens/git/models/revision.js';
import type { GitTreeEntry } from '@gitlens/git/models/tree.js';
import type { GitRevisionSubProvider, ResolvedRevision } from '@gitlens/git/providers/revision.js';
import {
	isRevisionWithSuffix,
	isSha,
	isUncommitted,
	isUncommittedStaged,
	isUncommittedWithParentSuffix,
} from '@gitlens/git/utils/revision.utils.js';
import { gate } from '@gitlens/utils/decorators/gate.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { first } from '@gitlens/utils/iterable.js';
import { splitPath } from '@gitlens/utils/path.js';
import type { Uri } from '@gitlens/utils/uri.js';
import { toFsPath } from '@gitlens/utils/uri.js';
import type { CliGitProviderInternal } from '../cliGitProvider.js';
import type { GitErrorHandling, GitExecOptions } from '../exec/exec.types.js';
import type { Git } from '../exec/git.js';
import { defaultExceptionHandler, getGitCommandError, gitConfigsLog, GitErrors } from '../exec/git.js';
import { parseGitLsFilesStaged } from '../parsers/indexParser.js';
import { getShaAndFileSummaryLogParser } from '../parsers/logParser.js';
import { parseGitTree } from '../parsers/treeParser.js';

const emptyArray: readonly GitTreeEntry[] = Object.freeze([]);

export class RevisionGitSubProvider implements GitRevisionSubProvider {
	constructor(
		private readonly context: GitServiceContext,
		private readonly git: Git,
		private readonly cache: Cache,
		private readonly provider: CliGitProviderInternal,
	) {}

	exists(repoPath: string, path: string, revOrOptions?: string | { untracked?: boolean }): Promise<boolean> {
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
	getRevisionContent(repoPath: string, path: string, rev: string): Promise<Uint8Array | undefined> {
		const [relativePath, root] = splitPath(path, repoPath);
		return this.showContentCore<Buffer>(root, relativePath, rev, { encoding: 'buffer', errors: 'throw' });
	}

	@debug()
	async getSubmoduleHead(repoPath: string, submodulePath: string): Promise<string | undefined> {
		// Verify the path is a submodule (gitlink commit) in the parent tree, not just a regular directory
		const treeEntry = await this.getTreeEntryForRevision(repoPath, submodulePath, 'HEAD');
		if (treeEntry?.type !== 'commit') return undefined;

		const [relativePath, root] = splitPath(submodulePath, repoPath);
		const submoduleFullPath = this.provider.getAbsoluteUri(relativePath, root).fsPath;

		const result = await this.git.exec({ cwd: submoduleFullPath, errors: 'ignore' }, 'rev-parse', 'HEAD');
		const sha = result.stdout.trim();
		return sha || undefined;
	}

	@gate()
	@debug()
	async getTreeEntryForRevision(repoPath: string, path: string, rev: string): Promise<GitTreeEntry | undefined> {
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

			const entries = parseGitLsFilesStaged(result.stdout, true);
			if (entries.length === 0) return undefined;

			const entry = entries[0];
			result = await this.git.exec({ cwd: root }, 'cat-file', '-s', entry.oid);
			const size = parseInt(result.stdout.trim(), 10) || 0;

			return { ref: rev, oid: entry.oid, path: relativePath, size: size, type: 'blob' };
		}

		const [entry] = await this.getTreeForRevisionCore(repoPath, rev, path);
		return entry;
	}

	@debug()
	async getTrackedFiles(repoPath: string): Promise<string[]> {
		if (!repoPath) return [];

		const result = await this.git.exec({ cwd: repoPath, errors: 'ignore' }, 'ls-files', '-z');
		const data = result.stdout;
		if (!data) return [];

		return [...new Set(data.split('\0').filter(Boolean))];
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

	private async showContentCore<T extends string | Buffer>(
		repoPath: string | undefined,
		path: string,
		rev: string,
		options?: {
			encoding?: string;
			errors?: GitErrorHandling;
		},
	): Promise<T | undefined> {
		const [file, root] = splitPath(path, repoPath, true);

		if (isUncommittedStaged(rev)) {
			rev = ':';
		}
		if (isUncommitted(rev)) throw new Error(`ref=${rev} is uncommitted`);

		const opts: GitExecOptions = {
			configs: gitConfigsLog,
			cwd: root,
			encoding: options?.encoding ?? 'utf8',
			errors: 'throw',
		};
		const args = rev.endsWith(':') ? `${rev}./${file}` : `${rev}:./${file}`;
		const params = ['show', '--textconv', args, '--'];

		try {
			const result = await this.git.exec<T>(opts, ...params);
			return result.stdout;
		} catch (ex) {
			const msg: string = ex?.toString() ?? '';
			if (rev === ':' && GitErrors.badRevision.test(msg)) {
				return this.showContentCore<T>(repoPath, path, 'HEAD:', options);
			}

			const error = getGitCommandError(
				'show',
				ex,
				reason =>
					new ShowError(
						{
							reason: reason ?? 'other',
							rev: rev,
							path: path,
							gitCommand: { repoPath: repoPath ?? '', args: params },
						},
						ex,
					),
			);
			if (options?.errors === 'throw') throw error;

			if (
				ShowError.is(error, 'invalidObject') ||
				ShowError.is(error, 'invalidRevision') ||
				ShowError.is(error, 'notFound') ||
				ShowError.is(error, 'notInRevision')
			) {
				return undefined;
			}

			defaultExceptionHandler(ex, opts.cwd);
			return '' as T;
		}
	}

	@debug()
	async resolveRevision(repoPath: string, ref: string, pathOrUri?: string | Uri): Promise<ResolvedRevision> {
		const path = pathOrUri != null ? toFsPath(pathOrUri) : undefined;
		if (!ref || ref === deletedOrMissing) return { sha: ref, revision: ref };

		if (path == null) {
			if (isSha(ref)) return { sha: ref, revision: ref };
			if (ref.endsWith('^3')) return { sha: ref, revision: ref };
		} else if (isUncommitted(ref)) {
			// Uncommitted refs depend on index/working-tree state — resolve without caching
			return this.resolveRevisionCore(repoPath, ref, path);
		}

		const key = path != null ? `${ref}|${this.provider.getRelativePath(path, repoPath)}` : ref;
		return this.cache.resolvedRevisions.getOrCreate(repoPath, key, () =>
			this.resolveRevisionCore(repoPath, ref, path),
		);
	}

	private async resolveRevisionCore(
		repoPath: string,
		ref: string,
		path: string | undefined,
	): Promise<ResolvedRevision> {
		if (path == null) {
			const sha = await this.provider.refs.validateReference(repoPath, ref);
			if (sha == null) return { sha: ref, revision: ref };

			return {
				sha: sha,
				// If it looks like non-sha like then preserve it as the friendly name
				revision: isRevisionWithSuffix(ref) ? sha : ref,
			};
		}

		if (isUncommittedWithParentSuffix(ref)) {
			ref = 'HEAD';
		}
		const relativePath = this.provider.getRelativePath(path, repoPath);

		if (isUncommitted(ref)) {
			if (!isUncommittedStaged(ref)) {
				return { sha: ref, revision: ref };
			}

			// Ensure that the file is actually staged
			const status = await this.provider.status.getStatusForFile?.(repoPath, relativePath, { renames: false });
			if (status?.indexStatus) return { sha: ref, revision: ref };

			ref = 'HEAD';
		}

		const resolvedRevisionCaching = { cache: this.cache.gitResults, options: { accessTTL: 5 * 60 * 1000 } };

		const parser = getShaAndFileSummaryLogParser();
		let result = await this.git.exec(
			{ cwd: repoPath, errors: 'ignore', caching: resolvedRevisionCaching },
			'log',
			...parser.arguments,
			'-n1',
			ref,
			'--',
			relativePath,
		);

		let commit = first(parser.parse(result.stdout));
		let file = commit?.files.find(f => f.path === relativePath);
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
				{ cwd: repoPath, errors: 'ignore', caching: resolvedRevisionCaching },
				'log',
				...parser.arguments,
				'-n1',

				commit!.sha,
				'--',
			);

			commit = first(parser.parse(result.stdout));
			file = commit?.files.find(f => f.path === relativePath || f.originalPath === relativePath);
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
				status: file.status as GitFileStatus,
				path: file.path,
				originalPath: file.originalPath,
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
