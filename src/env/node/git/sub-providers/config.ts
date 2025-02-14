import { hostname, userInfo } from 'os';
import { env as process_env } from 'process';
import { Uri } from 'vscode';
import type { GitConfigKeys } from '../../../../constants';
import type { Container } from '../../../../container';
import type { GitCache } from '../../../../git/cache';
import type { GitConfigSubProvider, GitDir } from '../../../../git/gitProvider';
import type { GitUser } from '../../../../git/models/user';
import { gate } from '../../../../system/decorators/-webview/gate';
import { debug, log } from '../../../../system/decorators/log';
import { Logger } from '../../../../system/logger';
import { getLogScope } from '../../../../system/logger.scope';
import type { Git } from '../git';
import type { LocalGitProvider } from '../localGitProvider';

const userConfigRegex = /^user\.(name|email) (.*)$/gm;
const mappedAuthorRegex = /(.+)\s<(.+)>/;

export class ConfigGitSubProvider implements GitConfigSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly cache: GitCache,
		private readonly provider: LocalGitProvider,
	) {}

	getConfig(repoPath: string, key: GitConfigKeys): Promise<string | undefined> {
		return this.git.config__get(key, repoPath);
	}

	setConfig(repoPath: string, key: GitConfigKeys, value: string | undefined): Promise<void> {
		return this.git.config__set(key, value, repoPath);
	}

	@gate()
	@log()
	async getCurrentUser(repoPath: string): Promise<GitUser | undefined> {
		if (!repoPath) return undefined;

		const scope = getLogScope();

		const repo = this.cache.repoInfo?.get(repoPath);

		let user = repo?.user;
		if (user != null) return user;
		// If we found the repo, but no user data was found just return
		if (user === null) return undefined;

		user = { name: undefined, email: undefined };

		try {
			const data = await this.git.config__get_regex('^user\\.', repoPath, { local: true });
			if (data) {
				let key: string;
				let value: string;

				let match;
				do {
					match = userConfigRegex.exec(data);
					if (match == null) break;

					[, key, value] = match;
					// Stops excessive memory usage -- https://bugs.chromium.org/p/v8/issues/detail?id=2869
					user[key as 'name' | 'email'] = ` ${value}`.substring(1);
				} while (true);
			} else {
				user.name =
					process_env.GIT_AUTHOR_NAME || process_env.GIT_COMMITTER_NAME || userInfo()?.username || undefined;
				if (!user.name) {
					// If we found no user data, mark it so we won't bother trying again
					this.cache.repoInfo?.set(repoPath, { ...repo, user: null });
					return undefined;
				}

				user.email =
					process_env.GIT_AUTHOR_EMAIL ||
					process_env.GIT_COMMITTER_EMAIL ||
					process_env.EMAIL ||
					`${user.name}@${hostname()}`;
			}

			const author = `${user.name} <${user.email}>`;
			// Check if there is a mailmap for the current user
			const mappedAuthor = await this.git.check_mailmap(repoPath, author);
			if (mappedAuthor != null && mappedAuthor.length !== 0 && author !== mappedAuthor) {
				const match = mappedAuthorRegex.exec(mappedAuthor);
				if (match != null) {
					[, user.name, user.email] = match;
				}
			}

			this.cache.repoInfo?.set(repoPath, { ...repo, user: user });
			return user;
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;

			// Mark it so we won't bother trying again
			this.cache.repoInfo?.set(repoPath, { ...repo, user: null });
			return undefined;
		}
	}

	@gate()
	@debug<NonNullable<ConfigGitSubProvider>['getGitDir']>({
		exit: r => `returned ${r.uri.toString(true)}, commonUri=${r.commonUri?.toString(true)}`,
	})
	async getGitDir(repoPath: string): Promise<GitDir> {
		const repo = this.cache.repoInfo?.get(repoPath);
		if (repo?.gitDir != null) return repo.gitDir;

		const gitDirPaths = await this.git.rev_parse__git_dir(repoPath);

		let gitDir: GitDir;
		if (gitDirPaths != null) {
			gitDir = {
				uri: Uri.file(gitDirPaths.path),
				commonUri: gitDirPaths.commonPath != null ? Uri.file(gitDirPaths.commonPath) : undefined,
			};
		} else {
			gitDir = {
				uri: this.provider.getAbsoluteUri('.git', repoPath),
			};
		}
		this.cache.repoInfo?.set(repoPath, { ...repo, gitDir: gitDir });

		return gitDir;
	}
}
