import type { CancellationToken } from 'vscode';
import type { Container } from '../../../container';
import { CancellationError } from '../../../errors';
import type { MaybePausedResult } from '../../../system/promise';
import { getSettledValue, pauseOnCancelOrTimeout } from '../../../system/promise';
import type { BranchTargetInfo, GitBranch } from '../../models/branch';
import type { PullRequest } from '../../models/pullRequest';

export async function getBranchMergeTargetInfo(
	container: Container,
	branch: GitBranch,
	options?: {
		associatedPullRequest?: Promise<PullRequest | undefined>;
		cancellation?: CancellationToken;
		detectedOnly?: boolean;
		timeout?: number;
	},
): Promise<BranchTargetInfo> {
	const [targetResult, baseResult, defaultResult] = await Promise.allSettled([
		getMergeTargetBranchName(container, branch, {
			cancellation: options?.cancellation,
			detectedOnly: options?.detectedOnly,
			timeout: options?.timeout,
		}),
		container.git.branches(branch.repoPath).getBaseBranchName?.(branch.name, options?.cancellation),
		getDefaultBranchName(container, branch.repoPath, branch.getRemoteName(), {
			cancellation: options?.cancellation,
		}),
	]);

	if (options?.cancellation?.isCancellationRequested) throw new CancellationError();

	return {
		mergeTargetBranch: getSettledValue(targetResult) ?? { value: undefined, paused: false },
		baseBranch: getSettledValue(baseResult),
		defaultBranch: getSettledValue(defaultResult),
	};
}

export async function getDefaultBranchName(
	container: Container,
	repoPath: string,
	remoteName?: string,
	options?: { cancellation?: CancellationToken },
): Promise<string | undefined> {
	const name = await container.git.branches(repoPath).getDefaultBranchName(remoteName, options?.cancellation);
	return name ?? getDefaultBranchNameFromIntegration(container, repoPath, options);
}

export async function getDefaultBranchNameFromIntegration(
	container: Container,
	repoPath: string,
	options?: { cancellation?: CancellationToken },
): Promise<string | undefined> {
	const remote = await container.git.remotes(repoPath).getBestRemoteWithIntegration(undefined, options?.cancellation);
	if (remote == null) return undefined;

	const integration = await remote.getIntegration();
	const defaultBranch = await integration?.getDefaultBranch?.(remote.provider.repoDesc, options);
	return defaultBranch && `${remote.name}/${defaultBranch?.name}`;
}

export async function getMergeTargetBranchName(
	container: Container,
	branch: GitBranch,
	options?: {
		associatedPullRequest?: Promise<PullRequest | undefined>;
		cancellation?: CancellationToken;
		detectedOnly?: boolean;
		timeout?: number;
	},
): Promise<MaybePausedResult<string | undefined>> {
	const targetBranch = options?.detectedOnly
		? await container.git.branches(branch.repoPath).getStoredDetectedMergeTargetBranchName?.(branch.name)
		: await container.git.branches(branch.repoPath).getStoredMergeTargetBranchName?.(branch.name);
	if (targetBranch) {
		const validated = await container.git
			.refs(branch.repoPath)
			.getSymbolicReferenceName?.(targetBranch, options?.cancellation);
		return { value: validated || targetBranch, paused: false };
	}

	if (options?.cancellation?.isCancellationRequested) return { value: undefined, paused: false };

	return pauseOnCancelOrTimeout(
		(options?.associatedPullRequest ?? branch?.getAssociatedPullRequest())?.then(pr => {
			if (pr?.refs?.base == null) return undefined;

			const name = `${branch.getRemoteName()}/${pr.refs.base.branch}`;
			void container.git.branches(branch.repoPath).storeMergeTargetBranchName?.(branch.name, name);

			return name;
		}),
		options?.cancellation,
		options?.timeout,
	);
}
