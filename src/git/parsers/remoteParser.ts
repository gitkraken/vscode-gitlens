import gitUrlParse from 'git-url-parse';
import { debug } from '../../system/decorators/log';
import { GitRemote } from '../models';
import { GitRemoteType } from '../models/remote';
import { RemoteProvider } from '../remotes/provider';

const remoteRegex = /^(.*)\t(.*)\s\((.*)\)$/gm;

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

export interface GitRemoteUrl {
	url: string;
	protocol: string;
	domain: string;
	port?: number;
	path: string;
}

export class GitRemoteParser {
	@debug({ args: false, singleLine: true })
	static parse(
		data: string,
		repoPath: string,
		providerFactory: (gitRemoteUrl: GitRemoteUrl) => RemoteProvider | undefined,
	): GitRemote[] | undefined {
		if (!data) return undefined;

		const remotes: GitRemote[] = [];
		const groups = Object.create(null) as Record<string, GitRemote | undefined>;

		let name;
		let url;
		let type;

		let uniqueness;
		let remote: GitRemote | undefined;

		let match;
		do {
			match = remoteRegex.exec(data);
			if (match == null) break;

			[, name, url, type] = match;

			// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
			url = ` ${url}`.substr(1);

			const gitRemoteUrl = this.parseGitUrl(url);
			const { domain, path, protocol } = gitRemoteUrl;
			const scheme = `${protocol}://`;

			uniqueness = `${domain ? `${domain}/` : ''}${path}`;
			remote = groups[uniqueness];
			if (remote === undefined) {
				const provider = providerFactory(gitRemoteUrl);

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

	static parseGitUrl(url: string): GitRemoteUrl {
		const parsedUrl = gitUrlParse(url);
		return {
			url: parsedUrl.toString(),
			protocol: parsedUrl.protocol,
			domain: parsedUrl.resource,
			path: parsedUrl.full_name,
			port: parsedUrl.port !== null ? parsedUrl.port : undefined,
		};
	}
}
