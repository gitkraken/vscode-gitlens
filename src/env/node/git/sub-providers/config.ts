import { hostname, userInfo } from 'os';
import { env as process_env } from 'process';
import { Uri, workspace } from 'vscode';
import type { DeprecatedGkConfigKeys, GitConfigKeys, GkConfigKeys } from '../../../../constants.js';
import type { Container } from '../../../../container.js';
import type { GitCache } from '../../../../git/cache.js';
import type { GitConfigSubProvider, GitConfigType, GitDir } from '../../../../git/gitProvider.js';
import type { SigningConfig, SigningFormat, ValidationResult } from '../../../../git/models/signature.js';
import type { GitUser } from '../../../../git/models/user.js';
import { configuration } from '../../../../system/-webview/configuration.js';
import { getBestPath } from '../../../../system/-webview/path.js';
import { gate } from '../../../../system/decorators/gate.js';
import { debug, trace } from '../../../../system/decorators/log.js';
import { getScopedLogger } from '../../../../system/logger.scope.js';
import type { Git } from '../git.js';
import type { LocalGitProviderInternal } from '../localGitProvider.js';

const mappedAuthorRegex = /(.+)\s<(.+)>/;

/**
 * Parses git config --get-regex output into a Map.
 * The output format is "key value" per line, where key and value are space-separated.
 */
function parseConfigRegexOutput(data: string | undefined): Map<string, string> {
	const configMap = new Map<string, string>();
	if (!data) return configMap;

	for (const line of data.split('\n')) {
		if (!line) continue;

		const spaceIndex = line.indexOf(' ');
		if (spaceIndex === -1) continue;

		configMap.set(line.substring(0, spaceIndex), line.substring(spaceIndex + 1));
	}

	return configMap;
}

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

	@trace()
	getConfig(
		repoPath: string | undefined,
		key: GitConfigKeys,
		options?: { global?: boolean; runGitLocally?: boolean; type?: GitConfigType },
	): Promise<string | undefined> {
		const global = options?.global || repoPath == null;
		return this.cache.getConfig(global ? undefined : repoPath, key, () =>
			this.getConfigCore(repoPath, key, options),
		);
	}

	private async getConfigCore(
		repoPath: string | undefined,
		key: GitConfigKeys | GkConfigKeys | DeprecatedGkConfigKeys,
		options?: { file?: string; global?: boolean; runGitLocally?: boolean; type?: GitConfigType },
	): Promise<string | undefined> {
		const args = ['config', '--get'];
		if (options?.file) {
			args.push('-f', options.file);
		} else if (options?.global || repoPath == null) {
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
	}

	@trace()
	getConfigRegex(
		repoPath: string | undefined,
		pattern: string,
		options?: { global?: boolean; runGitLocally?: boolean },
	): Promise<Map<string, string>> {
		const global = options?.global || repoPath == null;
		return this.cache.getConfigRegex(global ? undefined : repoPath, pattern, () =>
			this.getConfigRegexCore(repoPath, pattern, options),
		);
	}

	private async getConfigRegexCore(
		repoPath: string | undefined,
		pattern: string,
		options?: { file?: string; global?: boolean; runGitLocally?: boolean },
	): Promise<Map<string, string>> {
		const args = ['config', '--get-regex'];
		if (options?.file) {
			args.push('-f', options.file);
		} else if (options?.global || repoPath == null) {
			args.push('--global');
		}
		args.push(pattern);

		const result = await this.git.exec(
			{ cwd: repoPath ?? '', errors: 'ignore', runLocally: options?.runGitLocally },
			...args,
		);
		return parseConfigRegexOutput(result.stdout.trim());
	}

	@debug()
	async setConfig(
		repoPath: string | undefined,
		key: GitConfigKeys,
		value: string | undefined,
		options?: { file?: string; global?: boolean },
	): Promise<void> {
		return this.setConfigCore(repoPath, key, value, options);
	}

	private async setConfigCore(
		repoPath: string | undefined,
		key: GitConfigKeys | GkConfigKeys | DeprecatedGkConfigKeys,
		value: string | undefined,
		options?: { file?: string; global?: boolean },
	): Promise<void> {
		const args: string[] = ['config'];

		if (options?.file) {
			args.push('-f', options.file);
		} else {
			const global = options?.global || repoPath == null;
			args.push(global ? '--global' : '--local');
		}

		if (value == null) {
			args.push('--unset', key);
		} else {
			args.push(key, value);
		}

		await this.git.exec({ cwd: repoPath ?? '', runLocally: true }, ...args);

		// Only invalidate cache when not using a custom file (custom files aren't cached)
		if (!options?.file) {
			const global = options?.global || repoPath == null;
			// Invalidate the cached value for this key and clear all regex patterns for this scope
			this.cache.deleteConfig(global ? undefined : repoPath, key);
		}
	}

	@gate()
	@debug()
	async getCurrentUser(repoPath: string): Promise<GitUser | undefined> {
		if (!repoPath) return undefined;

		const scope = getScopedLogger();

		const cached = this.cache.currentUser.get(repoPath);
		if (cached != null) return cached;
		// If we found null, user data was not found - don't bother trying again
		if (cached === null) return undefined;

		const user: GitUser = { name: undefined, email: undefined };

		try {
			const configMap = await this.getConfigRegex(repoPath, '^user\\.(name|email)$', {
				runGitLocally: true,
			});
			if (configMap.size) {
				user.name = configMap.get('user.name');
				user.email = configMap.get('user.email');
			} else {
				user.name =
					process_env.GIT_AUTHOR_NAME || process_env.GIT_COMMITTER_NAME || userInfo()?.username || undefined;
				if (!user.name) {
					// If we found no user data, mark it so we won't bother trying again
					this.cache.currentUser.set(repoPath, null);
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

			this.cache.currentUser.set(repoPath, user);
			return user;
		} catch (ex) {
			scope?.error(ex);
			debugger;

			// Mark it so we won't bother trying again
			this.cache.currentUser.set(repoPath, null);
			return undefined;
		}
	}

	@gate()
	@trace({ exit: r => `returned ${r}` })
	async getDefaultWorktreePath(repoPath: string): Promise<string | undefined> {
		const gitDir = await this.getGitDir(repoPath);
		return getBestPath(Uri.joinPath(gitDir.commonUri ?? gitDir.uri, '..'));
	}

	@gate()
	@trace({
		exit: r =>
			`returned ${r.uri.toString(true)}, commonUri=${r.commonUri?.toString(true)}, parentUri=${r.parentUri?.toString(true)}`,
	})
	async getGitDir(repoPath: string): Promise<GitDir> {
		const cached = this.cache.gitDir.get(repoPath);
		if (cached != null) return cached;

		const repoInfo = await this.git.rev_parse__repository_info(repoPath);

		let gitDir: GitDir;
		if (!Array.isArray(repoInfo) && repoInfo != null) {
			gitDir = {
				uri: Uri.file(repoInfo.gitDir),
				commonUri: repoInfo.commonGitDir ? Uri.file(repoInfo.commonGitDir) : undefined,
				parentUri: repoInfo.superprojectPath ? Uri.file(repoInfo.superprojectPath) : undefined,
			};
		} else {
			gitDir = {
				uri: this.provider.getAbsoluteUri('.git', repoPath),
			};
		}
		this.cache.gitDir.set(repoPath, gitDir);

		return gitDir;
	}

	/**
	 * Gets the path to the .git/gk/config file for storing GitKraken-specific metadata.
	 * Uses commonUri for worktrees so all worktrees share the same data.
	 */
	private async getGkConfigUri(repoPath: string): Promise<Uri> {
		const gitDir = await this.getGitDir(repoPath);
		// Use commonUri (main .git dir) for worktrees, otherwise use uri
		const baseUri = gitDir.commonUri ?? gitDir.uri;
		return Uri.joinPath(baseUri, 'gk', 'config');
	}

	@debug()
	async getGkConfig(
		repoPath: string,
		key: GkConfigKeys | DeprecatedGkConfigKeys,
		options?: { type?: GitConfigType },
	): Promise<string | undefined> {
		await this.migrateGkConfigFromGitConfig(this.cache.getCommonPath(repoPath));
		return this.cache.getGkConfig(repoPath, key, () => this.getGkConfigCore(repoPath, key, options));
	}

	private async getGkConfigCore(
		repoPath: string,
		key: GkConfigKeys | DeprecatedGkConfigKeys,
		options?: { type?: GitConfigType },
	): Promise<string | undefined> {
		const gkConfigPath = (await this.getGkConfigUri(repoPath))?.fsPath;
		return this.getConfigCore(repoPath, key, {
			...options,
			runGitLocally: true,
			file: gkConfigPath,
		});
	}

	@debug()
	async getGkConfigRegex(repoPath: string, pattern: string): Promise<Map<string, string>> {
		await this.migrateGkConfigFromGitConfig(this.cache.getCommonPath(repoPath));
		return this.cache.getGkConfigRegex(repoPath, pattern, () => this.getGkConfigRegexCore(repoPath, pattern));
	}

	private async getGkConfigRegexCore(repoPath: string, pattern: string): Promise<Map<string, string>> {
		const gkConfigPath = (await this.getGkConfigUri(repoPath))?.fsPath;
		return this.getConfigRegexCore(repoPath, pattern, { runGitLocally: true, file: gkConfigPath });
	}

	@debug()
	async setGkConfig(
		repoPath: string,
		key: GkConfigKeys | DeprecatedGkConfigKeys,
		value: string | undefined,
	): Promise<void> {
		const scope = getScopedLogger();

		const gkConfigUri = await this.getGkConfigUri(repoPath);

		// Ensure the .git/gk/ directory exists before writing
		const gkConfigFolderUri = Uri.joinPath(gkConfigUri, '..');
		try {
			await workspace.fs.createDirectory(gkConfigFolderUri);
		} catch (ex) {
			scope?.error(ex, `Failed to create '${gkConfigFolderUri.toString(true)}' directory`);
		}

		await this.setConfigCore(repoPath, key, value, { file: gkConfigUri.fsPath });

		// Invalidate the cached value for this key and clear all regex patterns for this scope
		this.cache.deleteGkConfig(repoPath, key);
	}

	@debug()
	async getSigningConfig(repoPath: string): Promise<SigningConfig> {
		// Fetch all signing-related config in one call
		const configMap = await this.getConfigRegex(
			repoPath,
			'^(commit\\.gpgsign|gpg\\.format|user\\.signingkey|gpg\\.program|gpg\\.ssh\\.program|gpg\\.ssh\\.allowedsignersfile)$',
		);

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

	@debug()
	async validateSigningSetup(repoPath: string): Promise<ValidationResult> {
		const config = await this.getSigningConfig(repoPath);

		if (!config.signingKey) {
			return { valid: false, error: 'No signing key configured' };
		}

		// Basic validation: just check that a signing key is configured
		// Git will handle the actual validation when signing commits
		return { valid: true };
	}

	@debug()
	async setSigningConfig(
		repoPath: string,
		config: Partial<SigningConfig>,
		options?: { global?: boolean },
	): Promise<void> {
		const scope = getScopedLogger();

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
			scope?.error(ex);
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

	private _migratedRepos = new Set<string>();

	/**
	 * One-time migration of GK config entries from regular git config to `.git/gk/config`.
	 * If `.git/gk/config` already exists, assumes migration is complete (or data is already there).
	 * Preserves existing `.git/gk/config` values as source of truth (won't overwrite).
	 * Removes migrated keys from regular git config to stop cluttering it.
	 */
	@gate()
	@debug()
	private async migrateGkConfigFromGitConfig(repoPath: string): Promise<void> {
		if (this._migratedRepos.has(repoPath)) return;

		const scope = getScopedLogger();

		const gkConfigUri = await this.getGkConfigUri(repoPath);
		const gkConfigFolderUri = Uri.joinPath(gkConfigUri, '..');

		// If .git/gk/config already exists, consider migration done — it was either
		// already migrated or values were written there directly via setGkConfig
		try {
			await workspace.fs.stat(gkConfigUri);
			this._migratedRepos.add(repoPath);
			return;
		} catch {}

		// If .git/gk/config doesn't exist, create an empty file to prevent multiple migration attempts in future sessions
		try {
			await workspace.fs.createDirectory(gkConfigFolderUri);
			try {
				await workspace.fs.writeFile(gkConfigUri, new Uint8Array());
			} catch (ex) {
				scope?.error(ex, `Failed to create '${gkConfigUri.toString(true)}' file`);
			}
		} catch (ex) {
			scope?.error(ex, `Failed to create '${gkConfigFolderUri.toString(true)}' directory`);
			return;
		}

		// Read legacy gk-* keys from regular git config
		let migrateConfig: Map<string, string>;
		try {
			migrateConfig = await this.getConfigRegexCore(repoPath, '^branch\\..*\\.gk-', { runGitLocally: true });
		} catch (ex) {
			scope?.error(ex, 'Failed to read legacy GK config entries');
			this._migratedRepos.add(repoPath);
			return;
		}

		if (!migrateConfig.size) {
			this._migratedRepos.add(repoPath);
			return;
		}

		scope?.info(`Migrating ${migrateConfig.size} GK config entries from git config to .git/gk/config`);

		// Copy legacy entries to .git/gk/config
		const gkConfigPath = gkConfigUri.fsPath;
		for (const [key, value] of [...migrateConfig]) {
			try {
				await this.setConfigCore(repoPath, key as GkConfigKeys, value, { file: gkConfigPath });
			} catch (ex) {
				scope?.error(ex, `Failed to migrate key '${key}' to GK config`);
				// If we failed to migrate, delete it from the list so we won't try to remove it from git config later
				migrateConfig.delete(key);
			}
		}

		// Remove legacy keys from regular git config (use --unset-all defensively)
		for (const [key] of migrateConfig) {
			try {
				await this.git.exec(
					{ cwd: repoPath, errors: 'ignore', runLocally: true },
					'config',
					'--local',
					'--unset-all',
					key,
				);
			} catch (ex) {
				scope?.error(ex, `Failed to remove migrated key '${key}' from git config`);
			}
		}

		// Clear caches since we modified both config files
		this.cache.clearCaches(repoPath, 'config', 'gkConfig');

		this._migratedRepos.add(repoPath);
	}
}
