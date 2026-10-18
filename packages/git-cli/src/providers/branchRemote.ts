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
 */
export async function resolveBranchRemote(
	provider: Pick<CliGitProviderInternal, 'remotes'>,
	repoPath: string,
	ref: GitBranchReference,
	cancellation?: AbortSignal,
): Promise<{ name: string; remote: string | undefined; upstream: string | undefined }> {
	let [name, remote] = getBranchNameAndRemote(ref);
	let upstream = getBranchTrackingWithoutRemote(ref);

	if (ref.upstream?.remote || !(ref.remote ? name : upstream)?.includes('/')) {
		return { name: name, remote: remote, upstream: upstream };
	}

	const remoteNames = (await provider.remotes.getRemotes(repoPath, undefined, cancellation)).map(r => r.name);

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

	return { name: name, remote: remote, upstream: upstream };
}
