import type { Uri } from 'vscode';
import type { Container } from '../../../../container';
import type { GitCache } from '../../../../git/cache';
import { GitErrorHandling } from '../../../../git/commandOptions';
import type { GitRefsSubProvider } from '../../../../git/gitProvider';
import type { GitBranch } from '../../../../git/models/branch';
import type { GitReference } from '../../../../git/models/reference';
import { deletedOrMissing } from '../../../../git/models/revision';
import type { GitTag } from '../../../../git/models/tag';
import { createReference } from '../../../../git/utils/reference.utils';
import {
	isSha,
	isShaWithOptionalRevisionSuffix,
	isUncommitted,
	isUncommittedWithParentSuffix,
} from '../../../../git/utils/revision.utils';
import { TimedCancellationSource } from '../../../../system/-webview/cancellation';
import { log } from '../../../../system/decorators/log';
import { Logger } from '../../../../system/logger';
import { getLogScope } from '../../../../system/logger.scope';
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

	@log()
	async checkIfCouldBeValidBranchOrTagName(repoPath: string, ref: string): Promise<boolean> {
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
	async getMergeBase(
		repoPath: string,
		ref1: string,
		ref2: string,
		options?: { forkPoint?: boolean },
	): Promise<string | undefined> {
		const scope = getLogScope();

		try {
			const data = await this.git.exec(
				{ cwd: repoPath },
				'merge-base',
				options?.forkPoint ? '--fork-point' : undefined,
				ref1,
				ref2,
			);
			if (!data) return undefined;

			return data.split('\n')[0].trim() || undefined;
		} catch (ex) {
			Logger.error(ex, scope);
			return undefined;
		}
	}

	@log()
	async getReference(repoPath: string, ref: string): Promise<GitReference | undefined> {
		if (!ref || ref === deletedOrMissing) return undefined;

		if (!(await this.isValidReference(repoPath, ref))) return undefined;

		if (ref !== 'HEAD' && !isShaWithOptionalRevisionSuffix(ref)) {
			const branch = await this.provider.branches.getBranch(repoPath, ref);
			if (branch != null) {
				return createReference(branch.ref, repoPath, {
					id: branch.id,
					refType: 'branch',
					name: branch.name,
					remote: branch.remote,
					upstream: branch.upstream,
				});
			}

			const tag = await this.provider.tags.getTag(repoPath, ref);
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
	async getSymbolicReferenceName(repoPath: string, ref: string): Promise<string | undefined> {
		const supportsEndOfOptions = await this.git.supports('git:rev-parse:end-of-options');

		const data = await this.git.exec(
			{ cwd: repoPath, errors: GitErrorHandling.Ignore },
			'rev-parse',
			'--verify',
			'--quiet',
			'--symbolic-full-name',
			'--abbrev-ref',
			supportsEndOfOptions ? '--end-of-options' : undefined,
			ref,
		);
		return data?.trim() || undefined;
	}

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
	async isValidReference(repoPath: string, ref: string, pathOrUri?: string | Uri): Promise<boolean> {
		const relativePath = pathOrUri ? this.provider.getRelativePath(pathOrUri, repoPath) : undefined;
		return Boolean((await this.validateReference(repoPath, ref, relativePath))?.length);
	}

	@log()
	async resolveReference(
		repoPath: string,
		ref: string,
		pathOrUri?: string | Uri,
		options?: { force?: boolean; timeout?: number },
	): Promise<string> {
		if (pathOrUri != null && isUncommittedWithParentSuffix(ref)) {
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
			if ((!options?.force && !isShaWithOptionalRevisionSuffix(ref)) || ref.endsWith('^3')) return ref;

			return (await this.validateReference(repoPath, ref)) ?? ref;
		}

		const relativePath = this.provider.getRelativePath(pathOrUri, repoPath);

		let cancellation: TimedCancellationSource | undefined;
		if (options?.timeout != null) {
			cancellation = new TimedCancellationSource(options.timeout);
		}

		const [verifiedResult, resolvedResult] = await Promise.allSettled([
			this.validateReference(repoPath, ref, relativePath),
			this.git.log__file_recent(repoPath, relativePath, {
				ref: ref,
				cancellation: cancellation?.token,
			}),
		]);

		const verified = getSettledValue(verifiedResult);
		if (!verified) return deletedOrMissing;

		const resolved = getSettledValue(resolvedResult);

		const cancelled = cancellation?.token.isCancellationRequested;
		cancellation?.dispose();

		return cancelled ? ref : resolved ?? ref;
	}

	private async validateReference(repoPath: string, ref: string, relativePath?: string): Promise<string | undefined> {
		if (!ref) return undefined;
		if (ref === deletedOrMissing || isUncommitted(ref)) return ref;

		const supportsEndOfOptions = await this.git.supports('git:rev-parse:end-of-options');

		const data = await this.git.exec(
			{ cwd: repoPath, errors: GitErrorHandling.Ignore },
			'rev-parse',
			'--verify',
			supportsEndOfOptions ? '--end-of-options' : undefined,
			relativePath ? `${ref}:./${relativePath}` : `${ref}^{commit}`,
		);
		return data?.trim() || undefined;
	}
}
