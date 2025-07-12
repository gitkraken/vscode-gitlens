import type { CancellationToken } from 'vscode';
import type { GitConfigKeys } from '../../../constants';
import type { Container } from '../../../container';
import type { GitConfigEntityIdentifier } from '../../../plus/integrations/providers/models';
import {
	decodeEntityIdentifiersFromGitConfig,
	encodeIssueOrPullRequestForGitConfig,
	getIssueFromGitConfigEntityIdentifier,
} from '../../../plus/integrations/providers/utils';
import { Logger } from '../../../system/logger';
import type { MaybePausedResult } from '../../../system/promise';
import { getSettledValue, pauseOnCancelOrTimeout } from '../../../system/promise';
import type { GitBranch } from '../../models/branch';
import type { Issue } from '../../models/issue';
import type { GitBranchReference } from '../../models/reference';
import type { IssueResourceDescriptor, RepositoryDescriptor } from '../../models/resourceDescriptor';

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
			.config.setConfig?.(key, JSON.stringify(associatedIssues));
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
			await container.git.getRepositoryService(branch.repoPath).config.setConfig?.(key, undefined);
		} else {
			await container.git
				.getRepositoryService(branch.repoPath)
				.config.setConfig?.(key, JSON.stringify(associatedIssues));
		}
	} catch (ex) {
		Logger.error(ex, 'removeAssociatedIssueFromBranch');
	}
}

async function getConfigKeyAndEncodedAssociatedIssuesForBranch(
	container: Container,
	branch: GitBranchReference,
): Promise<{ key: GitConfigKeys; encoded: string | undefined }> {
	const key = `branch.${branch.name}.gk-associated-issues` satisfies GitConfigKeys;
	const encoded = await container.git.getRepositoryService(branch.repoPath).config.getConfig?.(key);
	return { key: key, encoded: encoded };
}
