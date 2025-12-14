import type { CancellationToken, Uri } from 'vscode';
import type { Container } from '../../../../container';
import { isCancellationError } from '../../../../errors';
import type { GitCache } from '../../../../git/cache';
import { GitErrorHandling } from '../../../../git/commandOptions';
import type { GitRefsSubProvider } from '../../../../git/gitProvider';
import type { GitBranch } from '../../../../git/models/branch';
import type { GitReference } from '../../../../git/models/reference';
import { deletedOrMissing } from '../../../../git/models/revision';
import type { GitTag } from '../../../../git/models/tag';
import { createReference } from '../../../../git/utils/reference.utils';
import { isShaWithOptionalRevisionSuffix, isUncommitted } from '../../../../git/utils/revision.utils';
import { debug, log } from '../../../../system/decorators/log';
import { Logger } from '../../../../system/logger';
import { getLogScope } from '../../../../system/logger.scope';
import type { Git } from '../git';
import type { LocalGitProvider } from '../localGitProvider';

export class RefsGitSubProvider implements GitRefsSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly cache: GitCache,
		private readonly provider: LocalGitProvider,
	) {}

	@log()
	async checkIfCouldBeValidBranchOrTagName(repoPath: string, ref: string): Promise<boolean> {
		try {
			const result = await this.git.exec(
				{ cwd: repoPath, errors: GitErrorHandling.Throw },
				'check-ref-format',
				'--branch',
				ref,
			);
			return Boolean(result.stdout.trim());
		} catch {
			return false;
		}
	}

	@log()
	async getMergeBase(
		repoPath: string,
		ref1: string,
		ref2: string,
		options?: { forkPoint?: boolean },
		cancellation?: CancellationToken,
	): Promise<string | undefined> {
		const scope = getLogScope();

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
			Logger.error(ex, scope);
			if (isCancellationError(ex)) throw ex;

			return undefined;
		}
	}

	@log()
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

	@log()
	async getSymbolicReferenceName(
		repoPath: string,
		ref: string,
		cancellation?: CancellationToken,
	): Promise<string | undefined> {
		const supportsEndOfOptions = await this.git.supports('git:rev-parse:end-of-options');

		const result = await this.git.exec(
			{ cwd: repoPath, cancellation: cancellation, errors: GitErrorHandling.Ignore },
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

	@log({ args: { 1: false } })
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

	@log()
	async isValidReference(
		repoPath: string,
		ref: string,
		pathOrUri?: string | Uri,
		cancellation?: CancellationToken,
	): Promise<boolean> {
		const relativePath = pathOrUri ? this.provider.getRelativePath(pathOrUri, repoPath) : undefined;
		return Boolean((await this.validateReference(repoPath, ref, relativePath, cancellation))?.length);
	}

	@debug()
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
			{ cwd: repoPath, cancellation: cancellation, errors: GitErrorHandling.Ignore },
			'rev-parse',
			'--verify',
			supportsEndOfOptions ? '--end-of-options' : undefined,
			relativePath ? `${ref}:./${relativePath}` : `${ref}^{commit}`,
		);
		return result.stdout.trim() || undefined;
	}

	@log()
	async updateReference(
		repoPath: string,
		ref: string,
		newRef: string,
		cancellation?: CancellationToken,
	): Promise<void> {
		const scope = getLogScope();

		try {
			await this.git.exec({ cwd: repoPath, cancellation: cancellation }, 'update-ref', ref, newRef);
		} catch (ex) {
			Logger.error(ex, scope);
			if (isCancellationError(ex)) throw ex;
		}
	}
}
