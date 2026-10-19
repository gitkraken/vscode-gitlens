import type { GitBranchReference } from '@gitlens/git/models/reference.js';
import {
	getBranchNameAndRemote,
	getBranchTrackingWithoutRemote,
	splitRemoteBranchName,
} from '@gitlens/git/utils/branch.utils.js';
import type { CliGitProviderInternal } from '../cliGitProvider.js';

/**
 * Splits a branch reference into its name, remote and upstream branch. A remote's own name can contain
 * a `/`, so the cheap first-`/` split only stands when it leaves no further `/` to be ambiguous.
 *
 * Git reports whether an upstream is a local branch on every version, and a local upstream never has a
 * remote, so it is never split (`release/2.0` is not remote `release`).
 *
 * A reference that carries neither `local` nor `remote` on its upstream (one a host built itself) is looked
 * up fresh in the branch list, since guessing from the name can't tell a local `release/2.0` from remote
 * `release`'s `2.0`.
 *
 * A remote a local branch's reference carries may have been removed since the reference was read, and
 * git would then take the stale name as a path, so it must be one of the repository's remotes. A failed
 * remote read (`getRemotes` answers `[]`) refuses too: a retry beats a push to a path.
 */
export async function resolveBranchRemote(
	provider: Pick<CliGitProviderInternal, 'remotes' | 'branches'>,
	repoPath: string,
	ref: GitBranchReference,
	cancellation?: AbortSignal,
): Promise<{ name: string; remote: string | undefined; upstream: string | undefined; local: boolean }> {
	if (!ref.remote && ref.upstream != null && !ref.upstream.local && ref.upstream.remote == null) {
		const fresh = await provider.branches.getBranch(repoPath, ref.name, undefined, cancellation);
		// `getBranch` matches by short name, which a remote-tracking ref can share. A missing upstream is one the
		// caller is about to set, which the branch doesn't track yet
		if (fresh != null && !fresh.remote && (fresh.upstream != null || !ref.upstream.missing)) {
			ref = fresh;
		}
	}

	let [name, remote] = getBranchNameAndRemote(ref);
	let upstream = getBranchTrackingWithoutRemote(ref);

	const local = !ref.remote && ref.upstream?.local === true;
	if (local) return { name: name, remote: undefined, upstream: upstream, local: true };

	const needsSplit = !ref.upstream?.remote && (ref.remote ? name : upstream)?.includes('/');
	const needsVerify = !ref.remote && remote != null;
	if (!needsSplit && !needsVerify) return { name: name, remote: remote, upstream: upstream, local: local };

	const remoteNames = (await provider.remotes.getRemotes(repoPath, undefined, cancellation)).map(r => r.name);

	if (needsSplit) {
		if (ref.remote) {
			const split = splitRemoteBranchName(ref.name, remoteNames);
			if (split != null) {
				[remote, name] = split;
			}
		}

		if (ref.upstream != null) {
			const split = splitRemoteBranchName(ref.upstream.name, remoteNames);
			if (split != null) {
				if (!ref.remote) {
					remote = split[0];
				}
				upstream = split[1];
			}
		}
	}

	if (!ref.remote && remote != null && !remoteNames.includes(remote)) {
		remote = undefined;
	}

	return { name: name, remote: remote, upstream: upstream, local: local };
}
