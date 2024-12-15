import type { CancellationToken } from 'vscode';
import type { GitConfigKeys } from '../../constants';
import type { Container } from '../../container';
import { PageableResult } from '../../system/paging';
import type { MaybePausedResult } from '../../system/promise';
import { pauseOnCancelOrTimeout } from '../../system/promise';
import type { GitBranch } from './branch';
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
	const targetBaseConfigKey: GitConfigKeys = `branch.${branch.name}.gk-target-base`;

	const targetBase = await container.git.getConfig(branch.repoPath, targetBaseConfigKey);

	if (options?.cancellation?.isCancellationRequested) return { value: undefined, paused: false };

	if (targetBase != null) {
		const targetBranch = await container.git.getBranch(branch.repoPath, targetBase);
		if (targetBranch != null) return { value: targetBranch.name, paused: false };
	}

	if (options?.cancellation?.isCancellationRequested) return { value: undefined, paused: false };

	return pauseOnCancelOrTimeout(
		(options?.associatedPullRequest ?? branch?.getAssociatedPullRequest())?.then(pr => {
			if (pr?.refs?.base == null) return undefined;

			const name = `${branch.getRemoteName()}/${pr.refs.base.branch}`;
			void container.git.setConfig(branch.repoPath, targetBaseConfigKey, name);

			return name;
		}),
		options?.cancellation,
		options?.timeout,
	);
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
