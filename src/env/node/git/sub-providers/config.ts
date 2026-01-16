import { hostname, userInfo } from 'os';
import { env as process_env } from 'process';
import { Uri } from 'vscode';
import type { DeprecatedGitConfigKeys, GitConfigKeys, GitCoreConfigKeys } from '../../../../constants.js';
import type { Container } from '../../../../container.js';
import type { GitCache } from '../../../../git/cache.js';
import { GitErrorHandling } from '../../../../git/commandOptions.js';
import type { GitConfigSubProvider, GitDir } from '../../../../git/gitProvider.js';
import type { SigningConfig, SigningFormat, ValidationResult } from '../../../../git/models/signature.js';
import type { GitUser } from '../../../../git/models/user.js';
import { getBestPath } from '../../../../system/-webview/path.js';
import { gate } from '../../../../system/decorators/gate.js';
import { debug, log } from '../../../../system/decorators/log.js';
import { Logger } from '../../../../system/logger.js';
import { getLogScope } from '../../../../system/logger.scope.js';
import type { Git } from '../git.js';
import type { LocalGitProvider } from '../localGitProvider.js';

const userConfigRegex = /^user\.(name|email) (.*)$/gm;
const mappedAuthorRegex = /(.+)\s<(.+)>/;

export class ConfigGitSubProvider implements GitConfigSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly cache: GitCache,
		private readonly provider: LocalGitProvider,
	) {}

	@debug()
	getConfig(
		repoPath: string,
		key: GitCoreConfigKeys | GitConfigKeys | DeprecatedGitConfigKeys,
	): Promise<string | undefined> {
		return this.git.config__get(key, repoPath);
	}

	@log()
	async setConfig(
		repoPath: string,
		key: GitCoreConfigKeys | GitConfigKeys,
		value: string | undefined,
	): Promise<void> {
		await this.git.exec(
			{ cwd: repoPath ?? '', local: true },
			'config',
			'--local',
			...(value == null ? ['--unset', key] : [key, value]),
		);
	}

	@gate()
	@log()
	async getCurrentUser(repoPath: string): Promise<GitUser | undefined> {
		if (!repoPath) return undefined;

		const scope = getLogScope();

		const repo = this.cache.repoInfo.get(repoPath);

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
					this.cache.repoInfo.set(repoPath, { ...repo, user: null });
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
			const result = await this.git.exec(
				{ cwd: repoPath, errors: GitErrorHandling.Ignore },
				'check-mailmap',
				author,
			);

			if (result.stdout && result.stdout !== author) {
				const match = mappedAuthorRegex.exec(result.stdout);
				if (match != null) {
					[, user.name, user.email] = match;
				}
			}

			this.cache.repoInfo.set(repoPath, { ...repo, user: user });
			return user;
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;

			// Mark it so we won't bother trying again
			this.cache.repoInfo.set(repoPath, { ...repo, user: null });
			return undefined;
		}
	}

	@gate()
	@debug<NonNullable<ConfigGitSubProvider>['getDefaultWorktreePath']>({ exit: r => `returned ${r}` })
	async getDefaultWorktreePath(repoPath: string): Promise<string | undefined> {
		const gitDir = await this.getGitDir(repoPath);
		return getBestPath(Uri.joinPath(gitDir.commonUri ?? gitDir.uri, '..'));
	}

	@gate()
	@debug<NonNullable<ConfigGitSubProvider>['getGitDir']>({
		exit: r => `returned ${r.uri.toString(true)}, commonUri=${r.commonUri?.toString(true)}`,
	})
	async getGitDir(repoPath: string): Promise<GitDir> {
		const repo = this.cache.repoInfo.get(repoPath);
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
		this.cache.repoInfo.set(repoPath, { ...repo, gitDir: gitDir });

		return gitDir;
	}

	@log()
	async getSigningConfig(repoPath: string): Promise<SigningConfig> {
		const [enabled, format, signingKey, gpgProgram, sshProgram, allowedSignersFile] = await Promise.all([
			this.getConfig(repoPath, 'commit.gpgsign'),
			this.getConfig(repoPath, 'gpg.format'),
			this.getConfig(repoPath, 'user.signingkey'),
			this.getConfig(repoPath, 'gpg.program'),
			this.getConfig(repoPath, 'gpg.ssh.program'),
			this.getConfig(repoPath, 'gpg.ssh.allowedSignersFile'),
		]);

		return {
			enabled: enabled === 'true',
			format: (format as SigningFormat) ?? 'gpg',
			signingKey: signingKey,
			gpgProgram: gpgProgram,
			sshProgram: sshProgram,
			allowedSignersFile: allowedSignersFile,
		};
	}

	@log()
	async validateSigningSetup(repoPath: string): Promise<ValidationResult> {
		const config = await this.getSigningConfig(repoPath);

		if (!config.signingKey) {
			return { valid: false, error: 'No signing key configured' };
		}

		// Basic validation: just check that a signing key is configured
		// Git will handle the actual validation when signing commits
		return { valid: true };
	}

	@log()
	async setSigningConfig(repoPath: string, config: Partial<SigningConfig>): Promise<void> {
		const updates: Promise<void>[] = [];

		if (config.enabled !== undefined) {
			updates.push(this.setConfig(repoPath, 'commit.gpgsign', config.enabled ? 'true' : 'false'));
		}
		if (config.format !== undefined) {
			updates.push(this.setConfig(repoPath, 'gpg.format', config.format));
		}
		if (config.signingKey !== undefined) {
			updates.push(this.setConfig(repoPath, 'user.signingkey', config.signingKey));
		}
		if (config.gpgProgram !== undefined) {
			updates.push(this.setConfig(repoPath, 'gpg.program', config.gpgProgram));
		}
		if (config.sshProgram !== undefined) {
			updates.push(this.setConfig(repoPath, 'gpg.ssh.program', config.sshProgram));
		}
		if (config.allowedSignersFile !== undefined) {
			updates.push(this.setConfig(repoPath, 'gpg.ssh.allowedSignersFile', config.allowedSignersFile));
		}

		await Promise.all(updates);
	}

	getSigningConfigFlags(config: SigningConfig): string[] {
		const flags: string[] = [];

		if (config.gpgProgram) {
			flags.push('-c', `gpg.program=${config.gpgProgram}`);
		}
		if (config.format && config.format !== 'gpg') {
			flags.push('-c', `gpg.format=${config.format}`);
		}
		if (config.sshProgram) {
			flags.push('-c', `gpg.ssh.program=${config.sshProgram}`);
		}
		if (config.allowedSignersFile) {
			flags.push('-c', `gpg.ssh.allowedSignersFile=${config.allowedSignersFile}`);
		}

		return flags;
	}
}
