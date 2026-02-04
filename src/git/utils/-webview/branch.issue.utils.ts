import type { CancellationToken } from 'vscode';
import type { GkConfigKeys } from '../../../constants.js';
import type { Container } from '../../../container.js';
import type { GitConfigEntityIdentifier } from '../../../plus/integrations/providers/models.js';
import {
	decodeEntityIdentifiersFromGitConfig,
	encodeIssueOrPullRequestForGitConfig,
	getIssueFromGitConfigEntityIdentifier,
} from '../../../plus/integrations/providers/utils.js';
import { Logger } from '../../../system/logger.js';
import type { MaybePausedResult } from '../../../system/promise.js';
import { getSettledValue, pauseOnCancelOrTimeout } from '../../../system/promise.js';
import type { GitBranch } from '../../models/branch.js';
import type { Issue } from '../../models/issue.js';
import type { GitBranchReference } from '../../models/reference.js';
import type { IssueResourceDescriptor, RepositoryDescriptor } from '../../models/resourceDescriptor.js';

export async function addAssociatedIssueToBranch(
	container: Container,
	branch: GitBranchReference,
	issue: Issue,
	owner: RepositoryDescriptor | IssueResourceDescriptor,
	options?: {
		cancellation?: CancellationToken;
	},
): Promise<void> {
	const { key, encoded } = await getConfigKeyAndEncodedAssociatedIssuesForBranch(container, branch);
	if (options?.cancellation?.isCancellationRequested) return;
	try {
		const associatedIssues: GitConfigEntityIdentifier[] = encoded
			? (JSON.parse(encoded) as GitConfigEntityIdentifier[])
			: [];
		if (associatedIssues.some(i => i.entityId === issue.nodeId)) {
			return;
		}
		associatedIssues.push(encodeIssueOrPullRequestForGitConfig(issue, owner));
		await container.git
			.getRepositoryService(branch.repoPath)
			.config.setGkConfig?.(key, JSON.stringify(associatedIssues));
	} catch (ex) {
		Logger.error(ex, 'addAssociatedIssueToBranch');
	}
}

export async function getAssociatedIssuesForBranch(
	container: Container,
	branch: GitBranch,
	options?: {
		cancellation?: CancellationToken;
		timeout?: number;
	},
): Promise<MaybePausedResult<Issue[] | undefined>> {
	const { encoded } = await getConfigKeyAndEncodedAssociatedIssuesForBranch(container, branch);
	if (options?.cancellation?.isCancellationRequested) return { value: undefined, paused: false };

	let associatedIssues: GitConfigEntityIdentifier[] | undefined;
	if (encoded) {
		try {
			associatedIssues = decodeEntityIdentifiersFromGitConfig(encoded);
		} catch (ex) {
			Logger.error(ex, 'getAssociatedIssuesForBranch');
			return { value: undefined, paused: false };
		}

		if (associatedIssues != null) {
			return pauseOnCancelOrTimeout(
				(async () => {
					return (
						await Promise.allSettled(
							(associatedIssues ?? []).map(i => getIssueFromGitConfigEntityIdentifier(container, i)),
						)
					)
						.map(r => getSettledValue(r))
						.filter((i): i is Issue => i != null);
				})(),
				options?.cancellation,
				options?.timeout,
			);
		}
	}

	return { value: undefined, paused: false };
}

export async function removeAssociatedIssueFromBranch(
	container: Container,
	branch: GitBranchReference,
	id: string,
	options?: {
		cancellation?: CancellationToken;
	},
): Promise<void> {
	const { key, encoded } = await getConfigKeyAndEncodedAssociatedIssuesForBranch(container, branch);
	if (options?.cancellation?.isCancellationRequested) return;
	try {
		let associatedIssues: GitConfigEntityIdentifier[] = encoded
			? (JSON.parse(encoded) as GitConfigEntityIdentifier[])
			: [];
		associatedIssues = associatedIssues.filter(i => i.entityId !== id);
		if (associatedIssues.length === 0) {
			await container.git.getRepositoryService(branch.repoPath).config.setGkConfig?.(key, undefined);
		} else {
			await container.git
				.getRepositoryService(branch.repoPath)
				.config.setGkConfig?.(key, JSON.stringify(associatedIssues));
		}
	} catch (ex) {
		Logger.error(ex, 'removeAssociatedIssueFromBranch');
	}
}

async function getConfigKeyAndEncodedAssociatedIssuesForBranch(
	container: Container,
	branch: GitBranchReference,
): Promise<{ key: GkConfigKeys; encoded: string | undefined }> {
	const key = `branch.${branch.name}.gk-associated-issues` satisfies GkConfigKeys;
	const encoded = await container.git.getRepositoryService(branch.repoPath).config.getGkConfig?.(key);
	return { key: key, encoded: encoded };
}
