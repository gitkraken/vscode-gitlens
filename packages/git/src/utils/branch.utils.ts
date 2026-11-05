import { getRemoteNameSlashIndex } from '@gitlens/utils/gitRefs.js';
import type { PageableResult } from '@gitlens/utils/paging.js';
import type { BranchMetadata, BranchMetadataGkConfigKey, GitBranch, GitTrackingUpstream } from '../models/branch.js';
import type { GitBranchReference, GitReference } from '../models/reference.js';
import { shortenRevision } from './revision.utils.js';

/**
 * The names git uses where a branch name would go when HEAD isn't on a branch — `(HEAD detached
 * at|from <rev>)`, `(no branch)`, `(no branch, rebasing <name>)`, `(no branch, bisect started on
 * <name>)`, and `git status --porcelain=v2`'s `branch.head` token `(detached)` — plus bare `HEAD`
 * and our own {@link formatDetachedHeadName} output (`(<rev>...)`).
 *
 * Deliberately NOT "anything parenthesized": parentheses are legal in ref names, so `(release)`,
 * `v1.0(rc)` and `feat/(wip)` are all real branches a user can be on. Matching those made
 * `GitBranch` rewrite a genuine branch's `name` to the synthesized `(sha…)` label and re-key its
 * `id` by SHA, which corrupts its identity for every downstream consumer.
 */
const detachedHEADRegex = /^(?:HEAD|\(detached\)|\(HEAD detached (?:at|from) .+\)|\(no branch.*\)|\(.+\.\.\.\))$/;

export function formatDetachedHeadName(sha: string): string {
	return `(${shortenRevision(sha)}...)`;
}

export function getBranchNameAndRemote(ref: GitBranchReference): [name: string, remote: string | undefined] {
	if (ref.remote) {
		const index = getRemoteNameSlashIndex(ref.name);
		if (index === -1) return [ref.name, undefined];

		return [ref.name.substring(index + 1), ref.name.substring(0, index)];
	}

	if (ref.upstream?.local) return [ref.name, undefined];
	if (ref.upstream?.remote) return [ref.name, ref.upstream.remote];

	if (ref.upstream?.name != null) {
		const index = getRemoteNameSlashIndex(ref.upstream.name);
		if (index === -1) return [ref.name, undefined];

		return [ref.name, ref.upstream.name.substring(0, index)];
	}

	return [ref.name, undefined];
}

/**
 * The upstream's branch name on its remote. The name git reports (`branch.<name>.merge`) wins over stripping the local
 * remote-tracking name, which a custom fetch refspec makes differ (`origin` fetching into `refs/remotes/mirror/*`).
 *
 * A remote-tracking branch tracks nothing. The Graph's remote refs carry the remote's own name in `upstream`, which
 * read as a tracking name would fetch a branch named after the remote (`git fetch upstream upstream`)
 */
export function getBranchTrackingWithoutRemote(ref: GitBranchReference): string | undefined {
	if (ref.remote || ref.upstream == null) return undefined;

	const { name, remote, remoteBranch, local } = ref.upstream;
	if (local) return name;
	if (remoteBranch) return remoteBranch;
	if (remote && name.startsWith(`${remote}/`)) return name.substring(remote.length + 1);

	return name.substring(getRemoteNameSlashIndex(name) + 1);
}

/**
 * Splits `name` at the longest of `remoteNames` that prefixes it, so a remote whose own name contains a `/` resolves
 * whole. A leading `remotes/` is stripped only when no remote matches the name as given
 */
export function splitRemoteBranchName(
	name: string,
	remoteNames: Iterable<string>,
): [remote: string, branch: string] | undefined {
	const names = Array.isArray(remoteNames) ? remoteNames : [...remoteNames];

	const split = splitAtLongestRemote(name, names);
	if (split != null || !name.startsWith('remotes/')) return split;

	return splitAtLongestRemote(name.substring(8), names);
}

function splitAtLongestRemote(
	name: string,
	remoteNames: Iterable<string>,
): [remote: string, branch: string] | undefined {
	let match: string | undefined;
	for (const remote of remoteNames) {
		if (
			name.length > remote.length + 1 &&
			name.charCodeAt(remote.length) === 47 /* '/' */ &&
			name.startsWith(remote) &&
			(match == null || remote.length > match.length)
		) {
			match = remote;
		}
	}

	return match != null ? [match, name.substring(match.length + 1)] : undefined;
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
const remoteHEADRegex = /^(refs\/)?remotes\/(.*\/)HEAD$/i;

export function isRemoteBranch(refName: string): boolean {
	return remoteBranchesPrefixRegex.test(refName);
}

export function isRemoteHEAD(refName: string): boolean {
	return remoteHEADRegex.test(refName);
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

const trackingStateRegex = /(?:\[(?:ahead ([0-9]+))?[,\s]*(?:behind ([0-9]+))?]|\[(gone)])/;

/**
 * @param remote - `%(upstream:remotename)`; `.` is a local upstream, and empty means git reported none. A reported
 * remote always wins, even when a custom fetch refspec puts its branches under `refs/heads/`; only when none was
 * reported (git < 2.23) is an upstream under `refs/heads/` taken as local
 * @param remoteRef - `%(upstream:remoteref)`; the upstream's ref on `remote`, read as its branch name
 */
export function parseUpstream(
	upstream: string,
	tracking: string,
	remote?: string,
	remoteRef?: string,
): GitTrackingUpstream | undefined {
	if (!upstream) return undefined;

	const { name } = parseRefName(upstream);
	const local = remote ? remote === '.' : upstream.startsWith('refs/heads/');
	const localProp = local ? { local: true } : undefined;
	const remoteProp =
		remote && remote !== '.'
			? { remote: remote, ...(remoteRef ? { remoteBranch: remoteRef.replace(/^refs\/heads\//, '') } : undefined) }
			: undefined;

	const match = trackingStateRegex.exec(tracking);
	if (match == null) {
		return { name: name, missing: false, state: { ahead: 0, behind: 0 }, ...remoteProp, ...localProp };
	}

	const ahead = match[1] == null ? 0 : Number(match[1]);
	const behind = match[2] == null ? 0 : Number(match[2]);

	return {
		name: name,
		missing: match[3] != null,
		state: { ahead: isNaN(ahead) ? 0 : ahead, behind: isNaN(behind) ? 0 : behind },
		...remoteProp,
		...localProp,
	};
}

const branchMetadataGkConfigKeyRegex =
	/^branch\.(.+)\.(gk-(?:last-accessed|last-modified|agent-last-activity|disposition))$/;

/** Splits a `branch.<name>.<key>` gk config key that a branch's {@link BranchMetadata} is read from, or `undefined` for any other key */
export function parseBranchMetadataGkConfigKey(
	key: string,
): { branch: string; key: BranchMetadataGkConfigKey } | undefined {
	const match = branchMetadataGkConfigKeyRegex.exec(key);
	if (match == null) return undefined;

	return { branch: match[1], key: match[2] as BranchMetadataGkConfigKey };
}

/** Sets the field `key` is read into to `value`, or removes it for `undefined`, exactly as a fresh read of the key would */
export function setBranchMetadataValue(
	metadata: BranchMetadata,
	key: BranchMetadataGkConfigKey,
	value: string | undefined,
): void {
	switch (key) {
		case 'gk-last-accessed':
			if (value != null) {
				metadata.lastAccessedAt = value;
			} else {
				delete metadata.lastAccessedAt;
			}
			break;
		case 'gk-last-modified':
			if (value != null) {
				metadata.lastModifiedAt = value;
			} else {
				delete metadata.lastModifiedAt;
			}
			break;
		case 'gk-agent-last-activity':
			if (value != null) {
				metadata.agentLastActivityAt = value;
			} else {
				delete metadata.agentLastActivityAt;
			}
			break;
		case 'gk-disposition':
			if (value === 'starred' || value === 'archived') {
				metadata.disposition = value;
			} else {
				delete metadata.disposition;
			}
			break;
	}
}
