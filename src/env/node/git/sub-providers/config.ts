import { hostname, userInfo } from 'os';
import { env as process_env } from 'process';
import { Uri } from 'vscode';
import type { DeprecatedGitConfigKeys, GitConfigKeys, GitCoreConfigKeys } from '../../../../constants.js';
import type { Container } from '../../../../container.js';
import type { GitCache } from '../../../../git/cache.js';
import type { GitConfigSubProvider, GitConfigType, GitDir } from '../../../../git/gitProvider.js';
import type { SigningConfig, SigningFormat, ValidationResult } from '../../../../git/models/signature.js';
import type { GitUser } from '../../../../git/models/user.js';
import { configuration } from '../../../../system/-webview/configuration.js';
import { getBestPath } from '../../../../system/-webview/path.js';
import { gate } from '../../../../system/decorators/gate.js';
import { debug, log } from '../../../../system/decorators/log.js';
import { Logger } from '../../../../system/logger.js';
import { getLogScope } from '../../../../system/logger.scope.js';
import type { Git } from '../git.js';
import type { LocalGitProviderInternal } from '../localGitProvider.js';

const userConfigRegex = /^user\.(name|email) (.*)$/gm;
const mappedAuthorRegex = /(.+)\s<(.+)>/;

function parseGitBoolean(value: string | undefined): boolean {
	if (value == null) return false;
	const normalized = value.toLowerCase().trim();
	return normalized === 'true' || normalized === 'yes' || normalized === 'on' || normalized === '1';
}

export class ConfigGitSubProvider implements GitConfigSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly cache: GitCache,
		private readonly provider: LocalGitProviderInternal,
	) {}

	@debug()
	getConfig(
		repoPath: string | undefined,
		key: GitCoreConfigKeys | GitConfigKeys | DeprecatedGitConfigKeys,
		options?: { global?: boolean; runGitLocally?: boolean; type?: GitConfigType },
	): Promise<string | undefined> {
		const global = options?.global || repoPath == null;
		return this.cache.getConfig(global ? undefined : repoPath, key, async () => {
			const args = ['config', '--get'];
			if (global) {
				args.push('--global');
			}
			if (options?.type) {
				args.push(`--type=${options.type}`);
			}
			args.push(key);

			const result = await this.git.exec(
				{ cwd: repoPath ?? '', errors: 'ignore', runLocally: options?.runGitLocally },
				...args,
			);
			return result.stdout.trim() || undefined;
		});
	}

	@debug()
	getConfigRegex(
		repoPath: string | undefined,
		pattern: string,
		options?: { global?: boolean; runGitLocally?: boolean },
	): Promise<string | undefined> {
		const global = options?.global || repoPath == null;
		return this.cache.getConfigRegex(global ? undefined : repoPath, pattern, async () => {
			const args = ['config', '--get-regex'];
			if (global) {
				args.push('--global');
			}
			args.push(pattern);

			const result = await this.git.exec(
				{ cwd: repoPath ?? '', errors: 'ignore', runLocally: options?.runGitLocally },
				...args,
			);
			return result.stdout.trim() || undefined;
		});
	}

	@log()
	async setConfig(
		repoPath: string | undefined,
		key: GitCoreConfigKeys | GitConfigKeys,
		value: string | undefined,
		options?: { global?: boolean },
	): Promise<void> {
		const global = options?.global || repoPath == null;
		await this.git.exec(
			{ cwd: repoPath ?? '', runLocally: true },
			'config',
			global ? '--global' : '--local',
			...(value == null ? ['--unset', key] : [key, value]),
		);

		// Invalidate the cached value for this key and clear all regex patterns for this scope
		this.cache.deleteConfig(global ? undefined : repoPath, key);
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
			const data = await this.getConfigRegex(repoPath, '^user\\.', { runGitLocally: true });
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
			const result = await this.git.exec({ cwd: repoPath, errors: 'ignore' }, 'check-mailmap', author);

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
		// Fetch all signing-related config in one call
		const data = await this.getConfigRegex(
			'^(commit\\.gpgsign|gpg\\.format|user\\.signingkey|gpg\\.program|gpg\\.ssh\\.program|gpg\\.ssh\\.allowedsignersfile)$',
			repoPath,
		);

		// Parse output into a map (format: "key value" per line, keys are lowercase)
		const configMap = new Map<string, string>();
		if (data) {
			for (const line of data.split('\n')) {
				if (!line) continue;

				const spaceIndex = line.indexOf(' ');
				if (spaceIndex === -1) continue;

				configMap.set(line.substring(0, spaceIndex), line.substring(spaceIndex + 1));
			}
		}

		// Extract values (keys are lowercase in git output)
		const enabledRaw = configMap.get('commit.gpgsign');
		const format = configMap.get('gpg.format');
		const signingKey = configMap.get('user.signingkey');
		const gpgProgram = configMap.get('gpg.program');
		const sshProgram = configMap.get('gpg.ssh.program');
		const allowedSignersFile = configMap.get('gpg.ssh.allowedsignersfile');

		// Check if git config has commit signing enabled
		let isEnabled = parseGitBoolean(enabledRaw);

		// If git config doesn't have commit signing enabled, check VS Code's setting
		if (!isEnabled) {
			const vscodeEnableCommitSigning = configuration.getCore('git.enableCommitSigning', Uri.file(repoPath));
			if (vscodeEnableCommitSigning === true) {
				isEnabled = true;
			}
		}

		return {
			enabled: isEnabled,
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
	async setSigningConfig(
		repoPath: string,
		config: Partial<SigningConfig>,
		options?: { global?: boolean },
	): Promise<void> {
		const scope = getLogScope();

		try {
			if (config.enabled != null) {
				await this.setConfig(repoPath, 'commit.gpgsign', config.enabled ? 'true' : 'false', options);
			}
			if (config.format != null) {
				await this.setConfig(repoPath, 'gpg.format', config.format, options);
			}
			if (config.signingKey != null) {
				await this.setConfig(repoPath, 'user.signingkey', config.signingKey, options);
			}
			if (config.gpgProgram != null) {
				await this.setConfig(repoPath, 'gpg.program', config.gpgProgram, options);
			}
			if (config.sshProgram != null) {
				await this.setConfig(repoPath, 'gpg.ssh.program', config.sshProgram, options);
			}
			if (config.allowedSignersFile != null) {
				await this.setConfig(repoPath, 'gpg.ssh.allowedSignersFile', config.allowedSignersFile, options);
			}
		} catch (ex) {
			Logger.error(ex, scope);
			throw ex;
		}
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
