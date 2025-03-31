import type { CancellationToken } from 'vscode';
import type { Container } from '../../../container';
import type { MaybePausedResult } from '../../../system/promise';
import { getSettledValue, pauseOnCancelOrTimeout } from '../../../system/promise';
import type { BranchTargetInfo, GitBranch } from '../../models/branch';
import type { PullRequest } from '../../models/pullRequest';

export async function getBranchTargetInfo(
	container: Container,
	branch: GitBranch,
	options?: {
		associatedPullRequest?: Promise<PullRequest | undefined>;
		cancellation?: CancellationToken;
		timeout?: number;
	},
): Promise<BranchTargetInfo> {
	const [baseResult, defaultResult, targetResult] = await Promise.allSettled([
		container.git.branches(branch.repoPath).getBaseBranchName?.(branch.name),
		getDefaultBranchName(container, branch.repoPath, branch.getRemoteName()),
		getTargetBranchName(container, branch, {
			cancellation: options?.cancellation,
			timeout: options?.timeout,
		}),
	]);

	const baseBranchName = getSettledValue(baseResult);
	const defaultBranchName = getSettledValue(defaultResult);
	const targetMaybeResult = getSettledValue(targetResult);

	return {
		baseBranch: baseBranchName,
		defaultBranch: defaultBranchName,
		targetBranch: targetMaybeResult ?? { value: undefined, paused: false },
	};
}

export async function getDefaultBranchName(
	container: Container,
	repoPath: string,
	remoteName?: string,
	options?: { cancellation?: CancellationToken },
): Promise<string | undefined> {
	const name = await container.git.branches(repoPath).getDefaultBranchName(remoteName);
	if (name != null) return name;

	const remote = await container.git.remotes(repoPath).getBestRemoteWithIntegration();
	if (remote == null) return undefined;

	const integration = await remote.getIntegration();
	const defaultBranch = await integration?.getDefaultBranch?.(remote.provider.repoDesc, options);
	return defaultBranch && `${remote.name}/${defaultBranch?.name}`;
}

export async function getTargetBranchName(
	container: Container,
	branch: GitBranch,
	options?: {
		associatedPullRequest?: Promise<PullRequest | undefined>;
		cancellation?: CancellationToken;
		timeout?: number;
	},
): Promise<MaybePausedResult<string | undefined>> {
	const targetBranch = await container.git.branches(branch.repoPath).getTargetBranchName?.(branch.name);
	if (targetBranch != null) return { value: targetBranch, paused: false };

	if (options?.cancellation?.isCancellationRequested) return { value: undefined, paused: false };

	return pauseOnCancelOrTimeout(
		(options?.associatedPullRequest ?? branch?.getAssociatedPullRequest())?.then(pr => {
			if (pr?.refs?.base == null) return undefined;

			const name = `${branch.getRemoteName()}/${pr.refs.base.branch}`;
			void container.git.branches(branch.repoPath).setTargetBranchName?.(branch.name, name);

			return name;
		}),
		options?.cancellation,
		options?.timeout,
	);
}
