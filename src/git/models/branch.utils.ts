import type { CancellationToken } from 'vscode';
import type { GitConfigKeys } from '../../constants';
import type { Container } from '../../container';
import type { IssueResourceDescriptor, RepositoryDescriptor } from '../../plus/integrations/integration';
import type { GitConfigEntityIdentifier } from '../../plus/integrations/providers/models';
import {
	decodeEntityIdentifiersFromGitConfig,
	encodeIssueOrPullRequestForGitConfig,
	getIssueFromGitConfigEntityIdentifier,
} from '../../plus/integrations/providers/utils';
import { Logger } from '../../system/logger';
import { PageableResult } from '../../system/paging';
import type { MaybePausedResult } from '../../system/promise';
import { getSettledValue, pauseOnCancelOrTimeout } from '../../system/promise';
import type { GitBranch } from './branch';
import type { Issue } from './issue';
import type { PullRequest } from './pullRequest';
import type { GitBranchReference, GitReference } from './reference';
import type { Repository } from './repository';
import { shortenRevision } from './revision.utils';

const detachedHEADRegex = /^(HEAD|\(.*\))$/;

export function formatDetachedHeadName(sha: string): string {
	return `(${shortenRevision(sha)}...)`;
}

export function getBranchId(repoPath: string, remote: boolean, name: string): string {
	return `${repoPath}|${remote ? 'remotes/' : 'heads/'}${name}`;
}

export function getBranchNameAndRemote(ref: GitBranchReference): [name: string, remote: string | undefined] {
	if (ref.remote) {
		const index = getRemoteNameSlashIndex(ref.name);
		if (index === -1) return [ref.name, undefined];

		return [ref.name.substring(index + 1), ref.name.substring(0, index)];
	}

	if (ref.upstream?.name != null) {
		const index = getRemoteNameSlashIndex(ref.upstream.name);
		if (index === -1) return [ref.name, undefined];

		return [ref.name, ref.upstream.name.substring(0, index)];
	}

	return [ref.name, undefined];
}

export function getBranchNameWithoutRemote(name: string): string {
	return name.substring(getRemoteNameSlashIndex(name) + 1);
}

export async function getLocalBranchUpstreamNames(branches: PageableResult<GitBranch>): Promise<Set<string>> {
	const remoteBranches = new Set<string>();

	for await (const branch of branches.values()) {
		if (!branch.remote && branch.upstream?.name != null) {
			remoteBranches.add(branch.upstream.name);
		}
	}

	return remoteBranches;
}

export function getRemoteNameFromBranchName(name: string): string {
	return name.substring(0, getRemoteNameSlashIndex(name));
}

export function getRemoteNameSlashIndex(name: string): number {
	return name.startsWith('remotes/') ? name.indexOf('/', 8) : name.indexOf('/');
}

export function isDetachedHead(name: string): boolean {
	// If there is whitespace in the name assume this is not a valid branch name
	// Deals with detached HEAD states
	name = name.trim();
	return name.length ? detachedHEADRegex.test(name) : true;
}

export function isOfBranchRefType(branch: GitReference | undefined) {
	return branch?.refType === 'branch';
}

export async function getDefaultBranchName(
	container: Container,
	repoPath: string,
	remoteName?: string,
	options?: { cancellation?: CancellationToken },
): Promise<string | undefined> {
	const name = await container.git.getDefaultBranchName(repoPath, remoteName);
	if (name != null) return name;

	const remote = await container.git.getBestRemoteWithIntegration(repoPath);
	if (remote == null) return undefined;

	const integration = await remote.getIntegration();
	const defaultBranch = await integration?.getDefaultBranch?.(remote.provider.repoDesc, options);
	return `${remote.name}/${defaultBranch?.name}`;
}

export async function getLocalBranchByUpstream(
	repo: Repository,
	remoteBranchName: string,
	branches?: PageableResult<GitBranch> | Map<unknown, GitBranch>,
): Promise<GitBranch | undefined> {
	let qualifiedRemoteBranchName;
	if (remoteBranchName.startsWith('remotes/')) {
		qualifiedRemoteBranchName = remoteBranchName;
		remoteBranchName = remoteBranchName.substring(8);
	} else {
		qualifiedRemoteBranchName = `remotes/${remoteBranchName}`;
	}

	branches ??= new PageableResult<GitBranch>(p => repo.git.getBranches(p != null ? { paging: p } : undefined));

	function matches(branch: GitBranch): boolean {
		return (
			!branch.remote &&
			branch.upstream?.name != null &&
			(branch.upstream.name === remoteBranchName || branch.upstream.name === qualifiedRemoteBranchName!)
		);
	}

	const values = branches.values();
	if (Symbol.asyncIterator in values) {
		for await (const branch of values) {
			if (matches(branch)) return branch;
		}
	} else {
		for (const branch of values) {
			if (matches(branch)) return branch;
		}
	}

	return undefined;
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
	const targetBranch = await container.git.getTargetBranchName(branch.repoPath, branch.name);
	if (targetBranch != null) return { value: targetBranch, paused: false };

	if (options?.cancellation?.isCancellationRequested) return { value: undefined, paused: false };

	return pauseOnCancelOrTimeout(
		(options?.associatedPullRequest ?? branch?.getAssociatedPullRequest())?.then(pr => {
			if (pr?.refs?.base == null) return undefined;

			const name = `${branch.getRemoteName()}/${pr.refs.base.branch}`;
			void container.git.setTargetBranchName(branch.repoPath, branch.name, name);

			return name;
		}),
		options?.cancellation,
		options?.timeout,
	);
}

export interface BranchTargetInfo {
	baseBranch: string | undefined;
	defaultBranch: string | undefined;
	targetBranch: MaybePausedResult<string | undefined>;
}

export async function getBranchTargetInfo(
	container: Container,
	current: GitBranch,
	options?: {
		associatedPullRequest?: Promise<PullRequest | undefined>;
		cancellation?: CancellationToken;
		timeout?: number;
	},
): Promise<BranchTargetInfo> {
	const [baseResult, defaultResult, targetResult] = await Promise.allSettled([
		container.git.getBaseBranchName(current.repoPath, current.name),
		getDefaultBranchName(container, current.repoPath, current.getRemoteName()),
		getTargetBranchName(container, current, {
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

export function getBranchTrackingWithoutRemote(ref: GitBranchReference) {
	return ref.upstream?.name.substring(getRemoteNameSlashIndex(ref.upstream.name) + 1);
}

export function getNameWithoutRemote(ref: GitReference) {
	if (ref.refType === 'branch') {
		return ref.remote ? getBranchNameWithoutRemote(ref.name) : ref.name;
	}
	return ref.name;
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
	if (encoded != null) {
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

export async function addAssociatedIssueToBranch(
	container: Container,
	branch: GitBranchReference,
	issue: Issue,
	owner: RepositoryDescriptor | IssueResourceDescriptor,
	options?: {
		cancellation?: CancellationToken;
	},
) {
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
		await container.git.setConfig(branch.repoPath, key, JSON.stringify(associatedIssues));
	} catch (ex) {
		Logger.error(ex, 'addAssociatedIssueToBranch');
	}
}

export async function removeAssociatedIssueFromBranch(
	container: Container,
	branch: GitBranchReference,
	id: string,
	options?: {
		cancellation?: CancellationToken;
	},
) {
	const { key, encoded } = await getConfigKeyAndEncodedAssociatedIssuesForBranch(container, branch);
	if (options?.cancellation?.isCancellationRequested) return;
	try {
		let associatedIssues: GitConfigEntityIdentifier[] = encoded
			? (JSON.parse(encoded) as GitConfigEntityIdentifier[])
			: [];
		associatedIssues = associatedIssues.filter(i => i.entityId !== id);
		if (associatedIssues.length === 0) {
			await container.git.setConfig(branch.repoPath, key, undefined);
		} else {
			await container.git.setConfig(branch.repoPath, key, JSON.stringify(associatedIssues));
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
	const encoded = await container.git.getConfig(branch.repoPath, key);
	return { key: key, encoded: encoded };
}
