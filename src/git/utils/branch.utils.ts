import type { PageableResult } from '../../system/paging';
import type { GitBranch, GitTrackingUpstream } from '../models/branch';
import type { GitBranchReference, GitReference } from '../models/reference';
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

export function getBranchTrackingWithoutRemote(ref: GitBranchReference): string | undefined {
	return ref.upstream?.name.substring(getRemoteNameSlashIndex(ref.upstream.name) + 1);
}

export async function getLocalBranchByUpstream(
	remoteBranchName: string,
	branches: PageableResult<GitBranch> | ReadonlyMap<unknown, GitBranch>,
): Promise<GitBranch | undefined> {
	let qualifiedRemoteBranchName;
	if (remoteBranchName.startsWith('remotes/')) {
		qualifiedRemoteBranchName = remoteBranchName;
		remoteBranchName = remoteBranchName.substring(8);
	} else {
		qualifiedRemoteBranchName = `remotes/${remoteBranchName}`;
	}

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

export function isOfBranchRefType(branch: GitReference | undefined): branch is GitBranchReference {
	return branch?.refType === 'branch';
}

const localBranchesPrefixRegex = /^(refs\/)?heads\//i;
const remoteBranchesPrefixRegex = /^(refs\/)?remotes\//i;

export function isRemoteBranch(refName: string): boolean {
	return remoteBranchesPrefixRegex.test(refName);
}

export function isRemoteHEAD(refName: string): boolean {
	return /^(refs\/)?remotes\/(.*\/)HEAD$/i.test(refName);
}

export function parseRefName(refName: string): { name: string; remote: boolean } {
	const remote = isRemoteBranch(refName);

	let name;
	if (remote) {
		// Strip off refs/remotes/
		name = refName.replace(remoteBranchesPrefixRegex, '');
	} else {
		// Strip off refs/heads/
		name = refName.replace(localBranchesPrefixRegex, '');
	}

	return { name: name, remote: remote };
}

export function parseUpstream(upstream: string, tracking: string): GitTrackingUpstream | undefined {
	if (!upstream) return undefined;

	const { name } = parseRefName(upstream);

	const match = /(?:\[(?:ahead ([0-9]+))?[,\s]*(?:behind ([0-9]+))?]|\[(gone)])/.exec(tracking);
	if (match == null) {
		return { name: name, missing: false, state: { ahead: 0, behind: 0 } };
	}

	const ahead = match[1] == null ? 0 : Number(match[1]);
	const behind = match[2] == null ? 0 : Number(match[2]);

	return {
		name: name,
		missing: match[3] != null,
		state: { ahead: isNaN(ahead) ? 0 : ahead, behind: isNaN(behind) ? 0 : behind },
	};
}
