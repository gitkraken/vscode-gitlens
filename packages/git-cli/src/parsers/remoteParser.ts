import type { GitRemoteType } from '@gitlens/git/models/remote.js';
import { GitRemote } from '@gitlens/git/models/remote.js';
import type { RemoteProviderMatcher } from '@gitlens/git/models/remoteProvider.js';
import { parseGitRemoteUrl } from '@gitlens/git/utils/remote.utils.js';
import { maybeStopWatch } from '@gitlens/utils/stopwatch.js';
import { iterateByDelimiter } from '@gitlens/utils/string.js';

export function parseGitRemotes(
	data: string,
	repoPath: string,
	remoteProviderMatcher: RemoteProviderMatcher | undefined,
	defaultRemoteName?: string,
): GitRemote[] {
	using sw = maybeStopWatch(`Git.parseRemotes(${repoPath})`, { log: { onlyExit: true, level: 'debug' } });
	if (!data) {
		sw?.stop({ suffix: ` no data` });
		return [];
	}

	// Format: <name>\t<url> (<type>)

	const remotes = new Map<string, GitRemote>();

	let name: string;
	let url: string;
	let type: GitRemoteType;

	let scheme: string;
	let domain: string;
	let path: string;

	let remote: GitRemote | undefined;

	let startIndex: number;
	let endIndex: number;

	for (let line of iterateByDelimiter(data, '\n')) {
		line = line.trim();
		if (!line) continue;

		// Parse name
		startIndex = 0;
		endIndex = line.indexOf('\t');
		if (endIndex === -1) continue;

		name = line.substring(startIndex, endIndex);

		// Parse url
		startIndex = endIndex + 1;
		endIndex = line.lastIndexOf(' (');
		if (endIndex === -1) continue;

		url = line.substring(startIndex, endIndex);

		// Parse type
		startIndex = endIndex + 2;
		endIndex = line.lastIndexOf(')');
		if (endIndex === -1) continue;

		type = line.substring(startIndex, endIndex) as GitRemoteType;

		[scheme, domain, path] = parseGitRemoteUrl(url);

		const isDefault = name === defaultRemoteName;

		remote = remotes.get(name);
		if (remote == null) {
			const provider = remoteProviderMatcher?.(url, domain, path, scheme);
			remote = new GitRemote(
				repoPath,
				name,
				scheme,
				domain,
				path,
				[{ url: url, type: type }],
				provider,
				isDefault,
			);
			remotes.set(name, remote);
		} else {
			remote.urls.push({ url: url, type: type });
			if (remote.provider != null && type !== 'push') continue;

			const provider = remoteProviderMatcher?.(url, domain, path, scheme);
			if (provider == null) continue;

			remote = new GitRemote(repoPath, name, scheme, domain, path, remote.urls, provider, isDefault);
			remotes.set(name, remote);
		}
	}

	sw?.stop({ suffix: ` parsed ${remotes.size} remotes` });

	return [...remotes.values()];
}
