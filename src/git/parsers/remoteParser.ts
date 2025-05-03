import type { Container } from '../../container';
import { maybeStopWatch } from '../../system/stopwatch';
import { iterateByDelimiter } from '../../system/string';
import type { GitRemoteType } from '../models/remote';
import { GitRemote } from '../models/remote';
import type { getRemoteProviderMatcher } from '../remotes/remoteProviders';

export function parseGitRemotes(
	container: Container,
	data: string,
	repoPath: string,
	remoteProviderMatcher: Awaited<ReturnType<typeof getRemoteProviderMatcher>>,
): GitRemote[] {
	using sw = maybeStopWatch(`Git.parseRemotes(${repoPath})`, { log: false, logLevel: 'debug' });
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

	let startIndex = 0;
	let endIndex = 0;

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

		remote = remotes.get(name);
		if (remote == null) {
			remote = new GitRemote(
				container,
				repoPath,
				name,
				scheme,
				domain,
				path,
				remoteProviderMatcher(url, domain, path, scheme),
				[{ url: url, type: type }],
			);
			remotes.set(name, remote);
		} else {
			remote.urls.push({ url: url, type: type });
			if (remote.provider != null && type !== 'push') continue;

			const provider = remoteProviderMatcher(url, domain, path, scheme);
			if (provider == null) continue;

			remote = new GitRemote(container, repoPath, name, scheme, domain, path, provider, remote.urls);
			remotes.set(name, remote);
		}
	}

	sw?.stop({ suffix: ` parsed ${remotes.size} remotes` });

	return [...remotes.values()];
}

// Test git urls
/*
http://host.xz/user/project.git
http://host.xz/path/to/repo.git
http://host.xz/path/to/repo.git/
http://username@host.xz/user/project.git
http://username:password@host.xz/user/project.git
https://host.xz/user/project.git
https://host.xz/path/to/repo.git
https://host.xz/path/to/repo.git/
https://username@host.xz/user/project.git
https://username:password@host.xz/user/project.git

git@host.xz:user/project.git
git://host.xz/path/to/repo.git/
git://host.xz/~user/path/to/repo.git/

ssh://host.xz/project.git
ssh://host.xz/path/to/repo.git
ssh://host.xz/path/to/repo.git/
ssh://host.xz:~project.git
ssh://host.xz:port/path/to/repo.git/
ssh://user@host.xz/project.git
ssh://user@host.xz/path/to/repo.git
ssh://user@host.xz/path/to/repo.git/
ssh://user@host.xz:port/path/to/repo.git/
ssh://user:password@host.xz/project.git
ssh://user:password@host.xz/path/to/repo.git
ssh://user:password@host.xz/path/to/repo.git/

user@host.xz:project.git
user@host.xz:path/to/repo.git
user@host.xz:/path/to/repo.git/
user:password@host.xz:project.git
user:password@host.xz:/path/to/repo.git
user:password@host.xz:/path/to/repo.git/
*/
export const remoteUrlRegex =
	/^(?:(git:\/\/)(.*?)\/|(https?:\/\/)(?:.*?@)?(.*?)\/|git@(.*):|(ssh:\/\/)(?:.*@)?(.*?)(?::.*?)?(?:\/|(?=~))|(?:.*?@)(.*?):)(.*)$/;

export function parseGitRemoteUrl(url: string): [scheme: string, domain: string, path: string] {
	const match = remoteUrlRegex.exec(url);
	if (match == null) return ['', '', url];

	return [
		match[1] || match[3] || match[6],
		match[2] || match[4] || match[5] || match[7] || match[8],
		match[9].replace(/\.git\/?$/, ''),
	];
}
