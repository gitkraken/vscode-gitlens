import { debug } from '../../system/decorators/log';
import type { GitRemoteType } from '../models/remote';
import { GitRemote } from '../models/remote';
import type { getRemoteProviderMatcher } from '../remotes/remoteProviders';

const emptyStr = '';

const remoteRegex = /^(.*)\t(.*)\s\((.*)\)$/gm;

// eslint-disable-next-line @typescript-eslint/no-extraneous-class
export class GitRemoteParser {
	@debug({ args: false, singleLine: true })
	static parse(
		data: string,
		repoPath: string,
		remoteProviderMatcher: ReturnType<typeof getRemoteProviderMatcher>,
	): GitRemote[] | undefined {
		if (!data) return undefined;

		const remotes: GitRemote[] = [];
		const groups = Object.create(null) as Record<string, GitRemote | undefined>;

		let name;
		let url;
		let type;

		let scheme;
		let domain;
		let path;

		let uniqueness;
		let remote: GitRemote | undefined;

		let match;
		do {
			match = remoteRegex.exec(data);
			if (match == null) break;

			[, name, url, type] = match;

			// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
			url = ` ${url}`.substr(1);

			[scheme, domain, path] = parseGitRemoteUrl(url);

			uniqueness = `${domain ? `${domain}/` : ''}${path}`;
			remote = groups[uniqueness];
			if (remote === undefined) {
				const provider = remoteProviderMatcher(url, domain, path);

				remote = new GitRemote(
					repoPath,
					uniqueness,
					// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
					` ${name}`.substr(1),
					scheme,
					provider !== undefined ? provider.domain : domain,
					provider !== undefined ? provider.path : path,
					provider,
					// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
					[{ url: url, type: ` ${type}`.substr(1) as GitRemoteType }],
				);
				remotes.push(remote);
				groups[uniqueness] = remote;
			} else {
				// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
				remote.urls.push({ url: url, type: ` ${type}`.substr(1) as GitRemoteType });
			}
		} while (true);

		return remotes;
	}
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
	if (match == null) return [emptyStr, emptyStr, url];

	return [
		match[1] || match[3] || match[6],
		match[2] || match[4] || match[5] || match[7] || match[8],
		match[9].replace(/\.git\/?$/, emptyStr),
	];
}
