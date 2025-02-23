import type { Uri } from 'vscode';
import type { Container } from '../../../../container';
import type { GitCache } from '../../../../git/cache';
import { GitErrorHandling } from '../../../../git/commandOptions';
import type { GitRefsSubProvider } from '../../../../git/gitProvider';
import type { GitBranch } from '../../../../git/models/branch';
import { deletedOrMissing } from '../../../../git/models/revision';
import type { GitTag } from '../../../../git/models/tag';
import { isSha, isShaLike, isUncommitted, isUncommittedParent } from '../../../../git/utils/revision.utils';
import { TimedCancellationSource } from '../../../../system/-webview/cancellation';
import { log } from '../../../../system/decorators/log';
import { getSettledValue } from '../../../../system/promise';
import type { Git } from '../git';
import type { LocalGitProvider } from '../localGitProvider';

export class RefsGitSubProvider implements GitRefsSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly cache: GitCache,
		private readonly provider: LocalGitProvider,
	) {}

	@log({ args: { 1: false } })
	async hasBranchOrTag(
		repoPath: string | undefined,
		options?: {
			filter?: { branches?: (b: GitBranch) => boolean; tags?: (t: GitTag) => boolean };
		},
	): Promise<boolean> {
		if (repoPath == null) return false;

		const [{ values: branches }, { values: tags }] = await Promise.all([
			this.provider.branches.getBranches(repoPath, {
				filter: options?.filter?.branches,
				sort: false,
			}),
			this.provider.tags.getTags(repoPath, {
				filter: options?.filter?.tags,
				sort: false,
			}),
		]);

		return branches.length !== 0 || tags.length !== 0;
	}

	@log()
	async resolveReference(
		repoPath: string,
		ref: string,
		pathOrUri?: string | Uri,
		options?: { force?: boolean; timeout?: number },
	): Promise<string> {
		if (pathOrUri != null && isUncommittedParent(ref)) {
			ref = 'HEAD';
		}

		if (
			!ref ||
			ref === deletedOrMissing ||
			(pathOrUri == null && isSha(ref)) ||
			(pathOrUri != null && isUncommitted(ref))
		) {
			return ref;
		}

		if (pathOrUri == null) {
			// If it doesn't look like a sha at all (e.g. branch name) or is a stash ref (^3) don't try to resolve it
			if ((!options?.force && !isShaLike(ref)) || ref.endsWith('^3')) return ref;

			return (await this.git.rev_parse__verify(repoPath, ref)) ?? ref;
		}

		const relativePath = this.provider.getRelativePath(pathOrUri, repoPath);

		let cancellation: TimedCancellationSource | undefined;
		if (options?.timeout != null) {
			cancellation = new TimedCancellationSource(options.timeout);
		}

		const [verifiedResult, resolvedResult] = await Promise.allSettled([
			this.git.rev_parse__verify(repoPath, ref, relativePath),
			this.git.log__file_recent(repoPath, relativePath, {
				ref: ref,
				cancellation: cancellation?.token,
			}),
		]);

		const verified = getSettledValue(verifiedResult);
		if (verified == null) return deletedOrMissing;

		const resolved = getSettledValue(resolvedResult);

		const cancelled = cancellation?.token.isCancellationRequested;
		cancellation?.dispose();

		return cancelled ? ref : resolved ?? ref;
	}

	@log()
	async validateBranchOrTagName(repoPath: string, ref: string): Promise<boolean> {
		try {
			const data = await this.git.exec(
				{ cwd: repoPath, errors: GitErrorHandling.Throw },
				'check-ref-format',
				'--branch',
				ref,
			);
			return Boolean(data.trim());
		} catch {
			return false;
		}
	}

	@log()
	async validateReference(repoPath: string, ref: string): Promise<boolean> {
		if (ref == null || ref.length === 0) return false;
		if (ref === deletedOrMissing || isUncommitted(ref)) return true;

		return (await this.git.rev_parse__verify(repoPath, ref)) != null;
	}
}
