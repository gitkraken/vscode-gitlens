import type { CancellationToken, Uri } from 'vscode';
import type { Container } from '../../../../container.js';
import { isCancellationError } from '../../../../errors.js';
import type { GitCache } from '../../../../git/cache.js';
import type { GitRefsSubProvider } from '../../../../git/gitProvider.js';
import type { GitBranch } from '../../../../git/models/branch.js';
import type { GitReference } from '../../../../git/models/reference.js';
import { deletedOrMissing } from '../../../../git/models/revision.js';
import type { GitTag } from '../../../../git/models/tag.js';
import { createReference } from '../../../../git/utils/reference.utils.js';
import { isShaWithOptionalRevisionSuffix, isUncommitted } from '../../../../git/utils/revision.utils.js';
import { debug, trace } from '../../../../system/decorators/log.js';
import { getScopedLogger } from '../../../../system/logger.scope.js';
import type { Git } from '../git.js';
import type { LocalGitProviderInternal } from '../localGitProvider.js';

export class RefsGitSubProvider implements GitRefsSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly cache: GitCache,
		private readonly provider: LocalGitProviderInternal,
	) {}

	@debug()
	async checkIfCouldBeValidBranchOrTagName(repoPath: string, ref: string): Promise<boolean> {
		try {
			const result = await this.git.exec({ cwd: repoPath, errors: 'throw' }, 'check-ref-format', '--branch', ref);
			return Boolean(result.stdout.trim());
		} catch {
			return false;
		}
	}

	@debug()
	async getMergeBase(
		repoPath: string,
		ref1: string,
		ref2: string,
		options?: { forkPoint?: boolean },
		cancellation?: CancellationToken,
	): Promise<string | undefined> {
		const scope = getScopedLogger();

		try {
			const result = await this.git.exec(
				{ cwd: repoPath, cancellation: cancellation },
				'merge-base',
				options?.forkPoint ? '--fork-point' : undefined,
				ref1,
				ref2,
			);
			if (!result.stdout) return undefined;

			return result.stdout.split('\n')[0].trim() || undefined;
		} catch (ex) {
			scope?.error(ex);
			if (isCancellationError(ex)) throw ex;

			return undefined;
		}
	}

	@debug()
	async getReference(
		repoPath: string,
		ref: string,
		cancellation?: CancellationToken,
	): Promise<GitReference | undefined> {
		if (!ref || ref === deletedOrMissing) return undefined;

		if (!(await this.isValidReference(repoPath, ref, undefined, cancellation))) return undefined;

		if (ref !== 'HEAD' && !isShaWithOptionalRevisionSuffix(ref)) {
			const branch = await this.provider.branches.getBranch(repoPath, ref, cancellation);
			if (branch != null) {
				return createReference(branch.ref, repoPath, {
					id: branch.id,
					refType: 'branch',
					name: branch.name,
					remote: branch.remote,
					upstream: branch.upstream,
				});
			}

			const tag = await this.provider.tags.getTag(repoPath, ref, cancellation);
			if (tag != null) {
				return createReference(tag.ref, repoPath, {
					id: tag.id,
					refType: 'tag',
					name: tag.name,
				});
			}
		}

		return createReference(ref, repoPath, { refType: 'revision' });
	}

	@debug()
	async getSymbolicReferenceName(
		repoPath: string,
		ref: string,
		cancellation?: CancellationToken,
	): Promise<string | undefined> {
		const supportsEndOfOptions = await this.git.supports('git:rev-parse:end-of-options');

		const result = await this.git.exec(
			{ cwd: repoPath, cancellation: cancellation, errors: 'ignore' },
			'rev-parse',
			'--verify',
			'--quiet',
			'--symbolic-full-name',
			'--abbrev-ref',
			supportsEndOfOptions ? '--end-of-options' : undefined,
			ref,
		);
		return result.stdout.trim() || undefined;
	}

	@debug({ args: repoPath => ({ repoPath: repoPath }) })
	async hasBranchOrTag(
		repoPath: string | undefined,
		options?: {
			filter?: { branches?: (b: GitBranch) => boolean; tags?: (t: GitTag) => boolean };
		},
		cancellation?: CancellationToken,
	): Promise<boolean> {
		if (repoPath == null) return false;

		const [{ values: branches }, { values: tags }] = await Promise.all([
			this.provider.branches.getBranches(
				repoPath,
				{ filter: options?.filter?.branches, sort: false },
				cancellation,
			),
			this.provider.tags.getTags(repoPath, { filter: options?.filter?.tags, sort: false }, cancellation),
		]);

		return branches.length !== 0 || tags.length !== 0;
	}

	@debug()
	async isValidReference(
		repoPath: string,
		ref: string,
		pathOrUri?: string | Uri,
		cancellation?: CancellationToken,
	): Promise<boolean> {
		const relativePath = pathOrUri ? this.provider.getRelativePath(pathOrUri, repoPath) : undefined;
		return Boolean((await this.validateReference(repoPath, ref, relativePath, cancellation))?.length);
	}

	@trace()
	async validateReference(
		repoPath: string,
		ref: string,
		relativePath?: string,
		cancellation?: CancellationToken,
	): Promise<string | undefined> {
		if (!ref) return undefined;
		if (ref === deletedOrMissing || isUncommitted(ref)) return ref;

		const supportsEndOfOptions = await this.git.supports('git:rev-parse:end-of-options');

		const result = await this.git.exec(
			{ cwd: repoPath, cancellation: cancellation, errors: 'ignore' },
			'rev-parse',
			'--verify',
			supportsEndOfOptions ? '--end-of-options' : undefined,
			relativePath ? `${ref}:./${relativePath}` : `${ref}^{commit}`,
		);
		return result.stdout.trim() || undefined;
	}

	@debug()
	async updateReference(
		repoPath: string,
		ref: string,
		newRef: string,
		cancellation?: CancellationToken,
	): Promise<void> {
		const scope = getScopedLogger();

		try {
			await this.git.exec({ cwd: repoPath, cancellation: cancellation }, 'update-ref', ref, newRef);
		} catch (ex) {
			scope?.error(ex);
			if (isCancellationError(ex)) throw ex;
		}
	}
}
