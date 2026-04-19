import { promises as fs } from 'fs';
import { hostname, userInfo } from 'os';
import { env as process_env } from 'process';
import type { Cache } from '@gitlens/git/cache.js';
import type { GitServiceContext } from '@gitlens/git/context.js';
import { WorkspaceUntrustedError } from '@gitlens/git/errors.js';
import type { GitDir } from '@gitlens/git/models/repository.js';
import type { SigningConfig, SigningFormat, ValidationResult } from '@gitlens/git/models/signature.js';
import type { GitUser } from '@gitlens/git/models/user.js';
import type {
	DeprecatedGkConfigKeys,
	GitConfigKeys,
	GitConfigSubProvider,
	GitConfigType,
	GkConfigKeys,
} from '@gitlens/git/providers/config.js';
import { gate } from '@gitlens/utils/decorators/gate.js';
import { debug, trace } from '@gitlens/utils/decorators/log.js';
import { Logger } from '@gitlens/utils/logger.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { dirname, getBestPath, isAbsolute, joinPaths, normalizePath } from '@gitlens/utils/path.js';
import { fileUri } from '@gitlens/utils/uri.js';
import type { CliGitProviderInternal } from '../cliGitProvider.js';
import { fsExists } from '../exec/exec.js';
import type { Git } from '../exec/git.js';

const mappedAuthorRegex = /(.+)\s<(.+)>/;
const emptyArray: readonly never[] = Object.freeze([]);

/**
 * Namespaces whose individual reads should be served from one --get-regex fetch instead
 * of one `git config --get` per key. The regex cache backing getGkConfigRegex dedupes
 * concurrent callers so a burst of per-branch reads produces a single subprocess.
 */
const gkConfigCacheableSets: readonly { match: RegExp; pattern: string }[] = [
	{ match: /^branch\..+\.gk-associated-issues$/, pattern: '^branch\\..+\\.gk-associated-issues$' },
	{ match: /^branch\..+\.gk-merge-target-user$/, pattern: '^branch\\..+\\.gk-merge-target-user$' },
];

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
		private readonly context: GitServiceContext,
		private readonly git: Git,
		private readonly cache: Cache,
		private readonly provider: CliGitProviderInternal,
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
		key: string,
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
		key: string,
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

			// Mark it so we won't bother trying again
			this.cache.currentUser.set(repoPath, null);
			return undefined;
		}
	}

	@gate()
	@trace({ exit: r => `returned ${r}` })
	async getDefaultWorktreePath(repoPath: string): Promise<string | undefined> {
		const gitDir = await this.getGitDir(repoPath);
		if (gitDir == null) return undefined;
		const basePath = (gitDir.commonUri ?? gitDir.uri).fsPath;
		return getBestPath(normalizePath(joinPaths(basePath, '..')));
	}

	@gate()
	@trace({
		exit: r =>
			`returned ${r.uri.toString(true)}, commonUri=${r.commonUri?.toString(true)}, parentUri=${r.parentUri?.toString(true)}`,
	})
	async getGitDir(repoPath: string): Promise<GitDir> {
		const cached = this.cache.gitDir.get(repoPath);
		if (cached != null) return cached;

		const scope = getScopedLogger();
		const repoInfo = await this.getRepositoryInfo(repoPath);

		let gitDir: GitDir;
		if (!Array.isArray(repoInfo) && repoInfo != null) {
			gitDir = {
				uri: fileUri(repoInfo.gitDir),
				commonUri: repoInfo.commonGitDir ? fileUri(repoInfo.commonGitDir) : undefined,
				parentUri: repoInfo.superprojectPath ? fileUri(repoInfo.superprojectPath) : undefined,
			};
		} else {
			gitDir = {
				uri: this.provider.getAbsoluteUri(joinPaths(repoPath, '.git'), repoPath),
			};

			const gitDirPath = gitDir.uri.toString(true);
			scope?.warn(`rev-parse failed for '${repoPath}'; falling back to '${gitDirPath}'`);
			this.context.hooks?.operations?.onGitDirResolveFailed?.(
				repoPath,
				gitDirPath,
				`rev_parse returned ${JSON.stringify(repoInfo)}`,
			);
		}
		this.cache.gitDir.set(repoPath, gitDir);

		return gitDir;
	}

	/**
	 * Gets the path to the .git/gk/config file for storing GitKraken-specific metadata.
	 * Uses commonPath for worktrees so all worktrees share the same data.
	 */
	private async getGkConfigPath(repoPath: string): Promise<string | undefined> {
		const gitDir = await this.getGitDir(repoPath);
		if (gitDir == null) return undefined;
		// Use commonUri (main .git dir) for worktrees, otherwise use uri
		const basePath = (gitDir.commonUri ?? gitDir.uri).fsPath;
		return joinPaths(basePath, 'gk', 'config');
	}

	@debug()
	async getGkConfig(
		repoPath: string,
		key: GkConfigKeys | DeprecatedGkConfigKeys,
		options?: { type?: GitConfigType },
	): Promise<string | undefined> {
		await this.migrateGkConfigFromGitConfig(this.cache.getCommonPath(repoPath));

		// Per-branch keys are commonly read in fan-out loops (e.g. Home overview enrichment).
		// Satisfy the read from a single --get-regex over the namespace instead of spawning
		// one `git config --get` per branch.
		const set = gkConfigCacheableSets.find(s => s.match.test(key));
		if (set != null) {
			return this.cache.getGkConfig(repoPath, key, async () => {
				const entries = await this.getGkConfigRegex(repoPath, set.pattern);
				return entries.get(key);
			});
		}

		return this.cache.getGkConfig(repoPath, key, () => this.getGkConfigCore(repoPath, key, options));
	}

	private async getGkConfigCore(
		repoPath: string,
		key: string,
		options?: { type?: GitConfigType },
	): Promise<string | undefined> {
		const gkConfigPath = await this.getGkConfigPath(repoPath);
		if (!gkConfigPath) return undefined;
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
		const gkConfigPath = await this.getGkConfigPath(repoPath);
		if (!gkConfigPath) return new Map();
		return this.getConfigRegexCore(repoPath, pattern, { runGitLocally: true, file: gkConfigPath });
	}

	@debug()
	async setGkConfig(
		repoPath: string,
		key: GkConfigKeys | DeprecatedGkConfigKeys,
		value: string | undefined,
	): Promise<void> {
		const scope = getScopedLogger();

		const gkConfigPath = await this.getGkConfigPath(repoPath);
		if (!gkConfigPath) return;

		const gkConfigFolder = joinPaths(gkConfigPath, '..');

		if (!(await this.ensureGkConfigFolder(gkConfigFolder, scope))) return;

		await this.setConfigCore(repoPath, key, value, { file: gkConfigPath });

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
		const isEnabled = parseGitBoolean(enabledRaw);

		// Note: To override commit signing, pass it via the host/caller.
		// The library no longer reads a config for this.

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

	async getRepositoryInfo(
		cwd: string,
	): Promise<
		| { repoPath: string; gitDir: string; commonGitDir: string | undefined; superprojectPath: string | undefined }
		| [safe: true, repoPath: string]
		| [safe: false]
		| []
	> {
		let result;

		if (this.context.workspace?.isTrusted === false) {
			try {
				await fs.stat(joinPaths(cwd, 'HEAD'));
				result = await this.git.exec(
					{ cwd: cwd, errors: 'throw', configs: ['-C', cwd] },
					'rev-parse',
					'--show-cdup',
				);
				if (!result.stdout.trim()) {
					Logger.warn(`Skipping (untrusted); bare clone repository detected in '${cwd}'`);
					return emptyArray as [];
				}
			} catch {
				// If this throws, we should be good to open the repo
			}
		}

		try {
			result = await this.git.exec(
				{ cwd: cwd, errors: 'throw' },
				'rev-parse',
				'--show-toplevel',
				'--git-dir',
				'--git-common-dir',
				'--show-superproject-working-tree',
			);
			if (!result.stdout) return emptyArray as [];

			// Output is 3-4 lines: show-toplevel, git-dir, git-common-dir, [show-superproject-working-tree]
			// The 4th line is only present for submodules
			const lines = result.stdout.split('\n').map(r => r.trimStart());
			const [repoPath, dotGitPath, commonDotGitPath, superprojectPath] = lines;

			if (!repoPath) return emptyArray as [];

			const normalizedRepoPath = normalizePath(repoPath.replace(/[\r|\n]+$/, ''));

			let gitDir = dotGitPath;
			if (gitDir && !isAbsolute(gitDir)) {
				gitDir = joinPaths(cwd, gitDir);
			}
			gitDir = normalizePath(gitDir);

			let commonGitDir: string | undefined;
			if (commonDotGitPath) {
				commonGitDir = commonDotGitPath;
				if (!isAbsolute(commonGitDir)) {
					commonGitDir = joinPaths(cwd, commonGitDir);
				}
				commonGitDir = normalizePath(commonGitDir);
				if (commonGitDir === gitDir) {
					commonGitDir = undefined;
				}
			}

			return {
				repoPath: normalizedRepoPath,
				gitDir: gitDir,
				commonGitDir: commonGitDir,
				superprojectPath: superprojectPath?.trim() || undefined,
			};
		} catch (ex: any) {
			if (ex instanceof WorkspaceUntrustedError) return emptyArray as [];

			const unsafeMatch =
				/(?:^fatal:\s*detected dubious ownership in repository at '([^']+)'|unsafe repository \('([^']+)' is owned by someone else\))[\s\S]*(git config --global --add safe\.directory [^\n\u2022]+)/m.exec(
					ex.stderr,
				);
			if (unsafeMatch != null) {
				Logger.warn(
					`Skipping; unsafe repository detected in '${unsafeMatch[1] || unsafeMatch[2]}'; run '${
						unsafeMatch[3]
					}' to allow it`,
				);
				return [false];
			}

			const inDotGit = /this operation must be run in a work tree/.test(ex.stderr);
			if (inDotGit && this.context.workspace?.isTrusted !== false) {
				result = await this.git.exec({ cwd: cwd, errors: 'ignore' }, 'rev-parse', '--is-bare-repository');
				if (result.stdout.trim() === 'true') {
					const result = await this.revParseGitDir(cwd);
					const repoPath = result?.commonPath ?? result?.path;
					if (repoPath?.length) return [true, repoPath];
				}
			}

			if (inDotGit || ex.code === 'ENOENT') {
				let exists = inDotGit ? false : await fsExists(cwd);
				if (!exists) {
					do {
						const parent = dirname(cwd);
						if (parent === cwd || parent.length === 0) return emptyArray as [];

						cwd = parent;
						exists = await fsExists(cwd);
					} while (!exists);

					return this.getRepositoryInfo(cwd);
				}
			}
			return emptyArray as [];
		}
	}

	private async revParseGitDir(cwd: string): Promise<{ path: string; commonPath?: string } | undefined> {
		const result = await this.git.exec(
			{ cwd: cwd, errors: 'ignore' },
			'rev-parse',
			'--git-dir',
			'--git-common-dir',
		);
		if (!result.stdout) return undefined;

		let [dotGitPath, commonDotGitPath] = result.stdout.split('\n').map(r => r.trimStart());

		if (!isAbsolute(dotGitPath)) {
			dotGitPath = joinPaths(cwd, dotGitPath);
		}
		dotGitPath = normalizePath(dotGitPath);

		if (commonDotGitPath) {
			if (!isAbsolute(commonDotGitPath)) {
				commonDotGitPath = joinPaths(cwd, commonDotGitPath);
			}
			commonDotGitPath = normalizePath(commonDotGitPath);

			return { path: dotGitPath, commonPath: commonDotGitPath !== dotGitPath ? commonDotGitPath : undefined };
		}

		return { path: dotGitPath };
	}

	/**
	 * Ensures the `.git/gk/` folder exists, but only if the parent `.git` directory already exists.
	 * This prevents creating stray `.git` directories if the computed path is wrong.
	 * Returns `true` if the folder was ensured, `false` if the parent `.git` does not exist.
	 */
	private async ensureGkConfigFolder(
		gkConfigFolder: string,
		scope: ReturnType<typeof getScopedLogger>,
	): Promise<boolean> {
		// Verify the .git directory already exists — never create it from scratch
		const dotGitDir = joinPaths(gkConfigFolder, '..');
		try {
			await fs.stat(dotGitDir);
		} catch {
			scope?.warn(`Skipping GK config write — expected git directory '${dotGitDir}' does not exist`);
			return false;
		}

		try {
			await fs.mkdir(gkConfigFolder, { recursive: true });
		} catch (ex) {
			scope?.error(ex, `Failed to create '${gkConfigFolder}' directory`);
			return false;
		}

		return true;
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

		const gkConfigPath = await this.getGkConfigPath(repoPath);
		if (!gkConfigPath) {
			this._migratedRepos.add(repoPath);
			return;
		}
		const gkConfigFolder = joinPaths(gkConfigPath, '..');

		// If .git/gk/config already exists, consider migration done — it was either
		// already migrated or values were written there directly via setGkConfig
		try {
			await fs.stat(gkConfigPath);
			this._migratedRepos.add(repoPath);
			return;
		} catch {
			// file doesn't exist, proceed with migration
		}

		// If .git/gk/config doesn't exist, create an empty file to prevent multiple migration attempts in future sessions
		if (!(await this.ensureGkConfigFolder(gkConfigFolder, scope))) return;
		try {
			await fs.writeFile(gkConfigPath, new Uint8Array());
		} catch (ex) {
			scope?.error(ex, `Failed to create '${gkConfigPath}' file`);
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

		scope?.info(`Migrating ${String(migrateConfig.size)} GK config entries from git config to .git/gk/config`);

		// Copy legacy entries to .git/gk/config
		for (const [key, value] of [...migrateConfig]) {
			try {
				await this.setConfigCore(repoPath, key, value, { file: gkConfigPath });
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
