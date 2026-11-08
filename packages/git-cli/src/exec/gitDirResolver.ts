import type { Stats } from 'node:fs';
import { lstat, readFile, realpath, stat } from 'node:fs/promises';
import { dirname, isAbsolute, join } from 'node:path';
import * as nodeProcess from 'node:process';
import { normalizePath } from '@gitlens/utils/path.js';
import type { PromiseCache } from '@gitlens/utils/promiseCache.js';

/** Environment variables that change which repository, git dir or working tree git finds from a `cwd` */
const locationEnvKeys = [
	'GIT_DIR',
	'GIT_COMMON_DIR',
	'GIT_WORK_TREE',
	'GIT_CEILING_DIRECTORIES',
	'GIT_DISCOVERY_ACROSS_FILESYSTEM',
];
/** `-c` overrides, passed through the environment, that move or remove the working tree */
const locationConfigRegex = /core\.(?:worktree|bare)|include/i;

const gitFilePrefix = 'gitdir: ';
const trailingNewlinesRegex = /[\r\n]+$/;
const newlineRegex = /[\r\n]/;
const headRegex = /^(?:ref:\s*refs\/|[0-9a-f]{40}(?:[0-9a-f]{24})?\s*$)/;
// git reads a key, or another section header, on the rest of a section header's line too (`[core] bare = true`)
const worktreeKeyRegex = /^(?:[ \t]*\[[^\]\r\n]*\])?[ \t]*worktree[ \t]*=/im;
const includeSectionRegex = /^(?:[ \t]*\[[^\]\r\n]*\])?[ \t]*\[[ \t]*include/im;
const bareKeyRegex = /^(?:[ \t]*\[[^\]\r\n]*\])?[ \t]*bare[ \t]*(?:=[ \t]*(.*?))?[ \t\r]*$/gim;
const boolTrueRegex = /^(?:true|yes|on|1)$/i;
const boolFalseRegex = /^(?:false|no|off|0)$/i;

/**
 * Whether git run with `env` might find another git dir or working tree than {@link readGitDirs} reads: one set
 * through the environment, or through `-c` overrides passed in it
 */
export function isGitDirMovedByEnv(env: Readonly<Record<string, string | undefined>>): boolean {
	if (locationEnvKeys.some(k => env[k] != null)) return true;
	if (env.GIT_CONFIG_PARAMETERS != null && locationConfigRegex.test(env.GIT_CONFIG_PARAMETERS)) return true;
	if (env.GIT_CONFIG_COUNT == null) return false;

	const count = Number(env.GIT_CONFIG_COUNT);
	if (!Number.isInteger(count)) return true;

	for (let i = 0; i < count; i++) {
		if (locationConfigRegex.test(env[`GIT_CONFIG_KEY_${i}`] ?? '')) return true;
	}
	return false;
}

/** The path a `.git` file names, as written (absolute, or relative to the file's folder); `undefined` when git would reject it */
export function parseGitFile(content: string): string | undefined {
	if (!content.startsWith(gitFilePrefix)) return undefined;

	const path = content.slice(gitFilePrefix.length).replace(trailingNewlinesRegex, '');
	return path && !newlineRegex.test(path) ? path : undefined;
}

/** The path a linked worktree's `commondir` file names, as written (absolute, or relative to its git dir) */
export function parseCommonDir(content: string): string | undefined {
	return content.replace(trailingNewlinesRegex, '') || undefined;
}

const transientFsErrorCodes: ReadonlySet<string> = new Set([
	'EAGAIN',
	'EBUSY',
	'ECONNRESET',
	'EHOSTDOWN',
	'EHOSTUNREACH',
	'EINTR',
	'EIO',
	'EMFILE',
	'ENETUNREACH',
	'ENFILE',
	// A FUSE mount (sshfs, rclone) whose connection dropped
	'ENOTCONN',
	'ESTALE',
	'ETIMEDOUT',
]);

/** Whether a file-system call failed in a way that may pass if made again soon */
export function isTransientFsError(ex: unknown): boolean {
	const code = (ex as { code?: unknown } | undefined)?.code;
	return typeof code === 'string' && transientFsErrorCodes.has(code);
}

/**
 * The git dir and common git dir `git rev-parse --git-dir --git-common-dir` reports from the working tree `repoPath`,
 * read without running git, and only when that working tree has no superproject. `undefined` whenever the layout is
 * one git might answer differently for: no `.git` at `repoPath` (a subfolder, a bare repository), a git dir a `.git`
 * file names without a `commondir` (a submodule, `--separate-git-dir`), a `core.bare`, `core.worktree` or `include`
 * in its config, a folder owned by another user (git's `safe.directory` check, made only where the process has a
 * uid: Windows has none, so there a folder git would refuse is still read), or a repository above it whose working
 * tree might track it as a submodule. The caller rules out the environment (see {@link isGitDirMovedByEnv}).
 * Never rejects.
 *
 * Sibling checkouts ask the same question of the same folders, so `superprojects`, when given, holds the answers by
 * parent folder. A stale one can't change the git dirs: "no" can only miss a superproject created since, and "maybe"
 * only asks git.
 */
export async function readGitDirs(
	repoPath: string,
	superprojects?: PromiseCache<string, boolean>,
): Promise<{ gitDir: string; commonGitDir: string } | undefined> {
	try {
		return await readGitDirsCore(repoPath, superprojects);
	} catch {
		return undefined;
	}
}

/**
 * As {@link readGitDirs}, but rejects when a file it reads fails in a way that may pass (a share that timed out or
 * dropped, too many open files), whose answer may differ once it reads. Any other failure, a file not there or not
 * readable, is the layout's own answer
 */
export async function readGitDirsOrReject(
	repoPath: string,
	superprojects?: PromiseCache<string, boolean>,
): Promise<{ gitDir: string; commonGitDir: string } | undefined> {
	try {
		return await readGitDirsCore(repoPath, superprojects);
	} catch (ex) {
		if (isTransientFsError(ex)) throw ex;

		return undefined;
	}
}

async function readGitDirsCore(
	repoPath: string,
	superprojects: PromiseCache<string, boolean> | undefined,
): Promise<{ gitDir: string; commonGitDir: string } | undefined> {
	if (!isAbsolute(repoPath)) return undefined;

	// git searches from the physical `cwd`, so a relative path in a `.git` file resolves against it
	const realRepoPath = await realpath(repoPath);
	const dotGit = join(repoPath, '.git');
	const dotGitStats = await stat(dotGit);

	let gitDir: string;
	let commonGitDir: string;
	let linked: boolean;
	if (dotGitStats.isDirectory()) {
		if ((await statIfExists(join(dotGit, 'commondir'))) != null) return undefined;

		// rev-parse prints `.git` relative to the `cwd`, which is how the caller's path reaches it
		gitDir = commonGitDir = dotGit;
		linked = false;
	} else if (dotGitStats.isFile()) {
		const target = parseGitFile(await readFile(dotGit, 'utf8'));
		if (target == null) return undefined;

		gitDir = await realpath(isAbsolute(target) ? target : `${realRepoPath}/${target}`);
		const common = parseCommonDir(await readFile(join(gitDir, 'commondir'), 'utf8'));
		if (common == null) return undefined;

		commonGitDir = await realpath(isAbsolute(common) ? common : `${gitDir}/${common}`);
		// A submodule's git dir, which its linked worktrees share, is under its superproject's `modules` folder
		if (normalizePath(gitDir).includes('/modules/') || normalizePath(commonGitDir).includes('/modules/')) {
			return undefined;
		}

		linked = true;
	} else {
		return undefined;
	}

	// What makes a folder a git dir to git; without it, git keeps searching the folders above
	if (!headRegex.test(await readFile(join(gitDir, 'HEAD'), 'utf8'))) return undefined;
	if (!(await stat(join(commonGitDir, 'objects'))).isDirectory()) return undefined;
	if (!(await stat(join(commonGitDir, 'refs'))).isDirectory()) return undefined;

	// A linked worktree ignores a `core.bare` in the shared config (a bare repository's worktrees), not in its own
	if (!isPlainConfig(await readFile(join(commonGitDir, 'config'), 'utf8'), !linked)) return undefined;

	const worktreeConfig = await readFileIfExists(join(gitDir, 'config.worktree'));
	if (worktreeConfig != null && !isPlainConfig(worktreeConfig, true)) return undefined;

	const uid = nodeProcess.geteuid?.();
	if (uid != null) {
		const owners = [(await stat(repoPath)).uid, (await lstat(dotGit)).uid, (await stat(gitDir)).uid];
		if (owners.some(o => o !== uid)) return undefined;
	}

	// A checkout at a filesystem root is its own parent folder, but asks about the folders above it, where a
	// checkout below it asks about the root too
	const parentFolder = dirname(realRepoPath);
	const mayHave =
		superprojects != null && parentFolder !== realRepoPath
			? superprojects.getOrCreate(parentFolder, () => mayHaveSuperproject(realRepoPath))
			: mayHaveSuperproject(realRepoPath);
	if (await mayHave) return undefined;

	return { gitDir: gitDir, commonGitDir: commonGitDir };
}

/**
 * Whether a repository above `realRepoPath` could list it as a submodule. `rev-parse --show-superproject-working-tree`
 * asks the repository git finds from the parent folder; only a bare one, having no index, can't list it. Rejects when
 * a folder above can't be read.
 */
async function mayHaveSuperproject(realRepoPath: string): Promise<boolean> {
	let folder = realRepoPath;
	for (;;) {
		const parent = dirname(folder);
		if (parent === folder) return false;

		folder = parent;

		const dotGit = join(folder, '.git');
		const dotGitStats = await statIfExists(dotGit);
		if (dotGitStats?.isFile()) {
			const target = parseGitFile(await readFile(dotGit, 'utf8'));
			if (target == null) return true;

			const gitDir = isAbsolute(target) ? target : `${folder}/${target}`;
			if ((await statIfExists(join(gitDir, 'commondir'))) != null) return true;

			return !isBareConfig(await readFile(join(gitDir, 'config'), 'utf8'));
		}

		// git passes over a `.git` folder, or a folder, that isn't a git dir
		if (dotGitStats?.isDirectory() && (await isGitDirectory(dotGit))) {
			return !isBareConfig(await readFile(join(dotGit, 'config'), 'utf8'));
		}
		if (await isGitDirectory(folder)) return !isBareConfig(await readFile(join(folder, 'config'), 'utf8'));
	}
}

/** Whether a folder is a git dir: a valid `HEAD`, and the `objects` and `refs` folders (or a `commondir` to them) */
async function isGitDirectory(path: string): Promise<boolean> {
	const head = await readFileIfExists(join(path, 'HEAD'));
	if (head == null || !headRegex.test(head)) return false;
	if ((await statIfExists(join(path, 'commondir'))) != null) return true;

	return (
		(await statIfExists(join(path, 'objects')))?.isDirectory() === true &&
		(await statIfExists(join(path, 'refs')))?.isDirectory() === true
	);
}

/** Whether a config sets nothing that moves the working tree; `checkBare` also rules out a `core.bare` not plainly false */
function isPlainConfig(config: string, checkBare: boolean): boolean {
	if (worktreeKeyRegex.test(config) || includeSectionRegex.test(config)) return false;
	if (!checkBare) return true;

	const bare = getBare(config);
	return bare == null || bare === false;
}

/** Whether a config is plainly a bare repository's, with no working tree set anywhere */
function isBareConfig(config: string): boolean {
	return !worktreeKeyRegex.test(config) && !includeSectionRegex.test(config) && getBare(config) === true;
}

/** The last `bare` value in a config: `undefined` when unset, `'unknown'` when not a plain boolean */
function getBare(config: string): boolean | 'unknown' | undefined {
	let bare: boolean | 'unknown' | undefined;
	for (const match of config.matchAll(bareKeyRegex)) {
		const value = match[1];
		if (value == null || boolTrueRegex.test(value)) {
			bare = true;
		} else if (boolFalseRegex.test(value)) {
			bare = false;
		} else {
			bare = 'unknown';
		}
	}
	return bare;
}

async function statIfExists(path: string): Promise<Stats | undefined> {
	try {
		return await stat(path);
	} catch (ex) {
		const code = (ex as NodeJS.ErrnoException).code;
		if (code === 'ENOENT' || code === 'ENOTDIR') return undefined;

		throw ex;
	}
}

async function readFileIfExists(path: string): Promise<string | undefined> {
	try {
		return await readFile(path, 'utf8');
	} catch (ex) {
		const code = (ex as NodeJS.ErrnoException).code;
		if (code === 'ENOENT' || code === 'ENOTDIR') return undefined;

		throw ex;
	}
}
