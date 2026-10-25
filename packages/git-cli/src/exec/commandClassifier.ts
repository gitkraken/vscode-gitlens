import { isAbsolute, join } from 'node:path';
import type { RepositoryChange } from '@gitlens/git/models/repository.js';
import { getRefChangeKind } from '@gitlens/git/watching/changeEvent.js';

/**
 * Verbs that never move a ref, the index or the working tree, so a raw run needs no notification.
 * Anything not listed is treated as a mutation: a needless notification costs a full cache eviction, a
 * missed one serves stale state. Object-writing plumbing (`hash-object -w`, `mktree`, `commit-tree`,
 * `write-tree`) is listed too: it only adds loose objects nothing cached observes.
 */
const readOnlyVerbs = new Set([
	'annotate',
	'archive',
	'blame',
	'cat-file',
	'check-attr',
	'check-ignore',
	'check-mailmap',
	'check-ref-format',
	'cherry',
	'commit-tree',
	'count-objects',
	'describe',
	'diff',
	'diff-files',
	'diff-index',
	'diff-tree',
	'for-each-ref',
	'fsck',
	'grep',
	'hash-object',
	'help',
	'log',
	'ls-files',
	// Asks a remote what it has; nothing local moves.
	'ls-remote',
	'ls-tree',
	'merge-base',
	'merge-tree',
	'mktree',
	'name-rev',
	'patch-id',
	'range-diff',
	'rev-list',
	'rev-parse',
	'shortlog',
	'show',
	'show-branch',
	'show-ref',
	'status',
	'var',
	'verify-commit',
	'verify-pack',
	'verify-tag',
	'version',
	'whatchanged',
	'write-tree',
]);

const reflogWriteSubcommands: ReadonlySet<string> = new Set(['expire', 'delete', 'drop']);

/**
 * Sub-commands of otherwise-mutating verbs that only list. `''` is the bare verb, which lists for `branch`,
 * `tag`, `remote` and `notes`; `branch -v` and every `tag` filter imply git's own list mode.
 */
const readOnlySubcommands: Readonly<Record<string, ReadonlySet<string>>> = {
	branch: new Set([
		'',
		'-l',
		'--list',
		'--show-current',
		'-a',
		'-r',
		'-v',
		'-vv',
		'--verbose',
		'--contains',
		'--no-contains',
		'--merged',
		'--no-merged',
		'--points-at',
	]),
	config: new Set(['get', 'list']),
	notes: new Set(['', 'list', 'show', 'get-ref']),
	// `stash create` writes a commit object and prints it; no ref moves
	stash: new Set(['list', 'show', 'create']),
	tag: new Set([
		'',
		'-l',
		'--list',
		'-n',
		'-v',
		'--verify',
		'--contains',
		'--no-contains',
		'--merged',
		'--no-merged',
		'--points-at',
	]),
	worktree: new Set(['list']),
	remote: new Set(['', '-v', 'get-url', 'show']),
};

/**
 * Options that make an argv write whatever else it contains, checked across the whole argv rather than
 * only its first token: `branch -r -d origin/x` leads with a listing flag and still deletes.
 */
const writeOptions: Readonly<Record<string, readonly string[]>> = {
	branch: [
		'-d',
		'-D',
		'--delete',
		'-m',
		'-M',
		'--move',
		'-c',
		'-C',
		'--copy',
		'-f',
		'--force',
		'-t',
		'--track',
		'--no-track',
		'-u',
		'--set-upstream-to',
		'--unset-upstream',
		'--edit-description',
	],
	config: [
		'--add',
		'--replace-all',
		'--unset',
		'--unset-all',
		'--rename-section',
		'--remove-section',
		'-e',
		'--edit',
	],
};

const configReadOptions = new Set([
	'--get',
	'--get-all',
	'--get-regexp',
	'--get-urlmatch',
	'--get-color',
	'--get-colorbool',
	'--list',
	'-l',
]);

function hasWriteOption(verb: string, rest: readonly string[]): boolean {
	const options = writeOptions[verb];
	if (options == null) return false;
	return hasOption(rest, options);
}

function hasOption(rest: readonly string[], options: readonly string[]): boolean {
	return rest.some(arg => options.some(opt => arg === opt || arg.startsWith(`${opt}=`)));
}

/**
 * `config <key>` with nothing after the key is git's own read form, as is any `--get*`/`--list`. `config edit`
 * (git 2.46's subcommand form of `--edit`) also has a single non-flag argument but writes.
 */
function isConfigRead(rest: readonly string[]): boolean {
	if (rest[0] === 'edit') return false;
	if (rest.some(arg => configReadOptions.has(arg))) return true;

	return rest.filter(arg => !arg.startsWith('-')).length === 1;
}

/** Global options whose value is the next argument, so the verb scan must skip both. */
const globalOptionsWithValue = new Set([
	'-c',
	'--config-env',
	'--exec-path',
	'--git-dir',
	'--namespace',
	'--super-prefix',
	'--work-tree',
]);

export interface LeadingCommand {
	verb: string;
	readOnly: boolean;
	/** The first token after the verb, unresolved — used for subcommand-shaped decisions (`worktree add`). */
	subcommand?: string;
	/** Every token after the verb */
	rest: readonly string[];
	/** The `-C <path>` target when the caller re-scopes the command to another working tree. */
	pathOverride?: string;
	/** Each `-c <key>[=<value>]` given before the verb, in order */
	configs?: readonly string[];
}

/**
 * Skips the global options (`-c key=val`, `-C path`) git accepts before the verb to find it, and notes a
 * `-C` re-scope so notification targets that tree.
 */
export function leadingCommand(args: readonly string[]): LeadingCommand {
	let pathOverride: string | undefined;
	let configs: string[] | undefined;
	let i = 0;
	while (i < args.length) {
		const arg = args[i];
		if (arg === '-C') {
			// git applies each `-C` relative to the one before it
			const path = args[i + 1];
			if (path != null) {
				pathOverride = pathOverride == null || isAbsolute(path) ? path : join(pathOverride, path);
			}
			i += 2;

			continue;
		}
		if (globalOptionsWithValue.has(arg)) {
			if (arg === '-c' && args[i + 1] != null) {
				(configs ??= []).push(args[i + 1]);
			}
			i += 2;

			continue;
		}
		if (arg.startsWith('-')) {
			i += 1;

			continue;
		}
		break;
	}
	const verb = args[i] ?? '';
	const rest = args.slice(i + 1);
	const readOnly =
		!hasWriteOption(verb, rest) &&
		(readOnlyVerbs.has(verb) ||
			(readOnlySubcommands[verb]?.has(rest[0] ?? '') ?? false) ||
			(verb === 'config' && isConfigRead(rest)) ||
			// Every `reflog` form reads (bare, `<ref>`, `show`, `list`, `exists`) except the three that rewrite
			// it. Base-branch detection answers "none" unless a branch's reflog has exactly one creation entry,
			// so a rewrite can make a cached "none" derivable; no change kind names a reflog, so it resets all.
			(verb === 'reflog' && !reflogWriteSubcommands.has(rest[0] ?? '')) ||
			// A bare `symbolic-ref <name>` reads; a second non-flag argument, or a delete, writes.
			(verb === 'symbolic-ref' &&
				!rest.includes('-d') &&
				!rest.includes('--delete') &&
				rest.filter(a => !a.startsWith('-')).length < 2));

	return {
		verb: verb,
		readOnly: readOnly,
		subcommand: rest[0],
		rest: rest,
		pathOverride: pathOverride,
		configs: configs,
	};
}

/**
 * The change kinds every worktree sharing a `.git` sees: its refs, stash, worktree list, the HEADs of the worktrees
 * it lists (`worktreeHead`, which every other worktree's watcher reports too) and config. The rest a classified verb
 * announces — the tree's own HEAD, the index, a paused operation, FETCH_HEAD — belong to the one tree the command ran
 * in, so a `-C`-scoped write tells the caller's own `cwd` only this subset of what it changed.
 */
export const worktreeSharedChanges: ReadonlySet<RepositoryChange> = new Set([
	'heads',
	'tags',
	'stash',
	'remotes',
	'worktrees',
	'worktreeHead',
	'config',
]);

/**
 * Verbs whose effect is confined to the object store that nothing cached observes — repacking or pruning
 * `.git/objects` changes no cached read (branches, refs, status, worktrees, …). `init` and `clone` create a
 * repository rather than mutate a registered one, so there is nothing yet registered to notify.
 */
const objectOnlyVerbs = new Set([
	'gc',
	'repack',
	'prune',
	'maintenance',
	'commit-graph',
	'multi-pack-index',
	'init',
	'clone',
]);

/**
 * The {@link RepositoryChange} kinds each mutating verb announces. A worktree subcommand other than a
 * listing is handled separately (see {@link getChangesForCommand}), and any verb absent from both this
 * table and {@link objectOnlyVerbs} announces `[]` — the conservative default for an unclassified
 * mutation: the caller still learns something changed, just not what. An entry covers at least what the
 * verb's typed mutator announces; `update-ref` and `symbolic-ref` name every kind their target ref could be.
 * {@link getNamedChanges} narrows the forms whose argv proves what moved, which can announce less: the typed
 * checkout announces `heads` for any target, but a `--detach` or full-SHA checkout moves only this tree's HEAD,
 * no shared ref.
 * The kinds decide which caches the announcement resets, so a verb that can start or end a paused operation
 * names `pausedOp`: `commit` concludes a merge, cherry-pick or revert, `reset` aborts one, and `am` runs in
 * `rebase-apply`.
 */
const changesByVerb: Readonly<Record<string, readonly RepositoryChange[]>> = {
	commit: ['head', 'heads', 'index', 'pausedOp'],
	am: ['head', 'heads', 'index', 'pausedOp'],
	bisect: ['head', 'index', 'worktrees', 'worktreeHead'],
	checkout: ['head', 'heads', 'index', 'worktrees', 'worktreeHead'],
	switch: ['head', 'heads', 'index', 'worktrees', 'worktreeHead'],
	reset: ['head', 'heads', 'index', 'pausedOp'],
	merge: ['head', 'heads', 'index', 'pausedOp', 'merge'],
	rebase: ['head', 'heads', 'index', 'pausedOp', 'rebase', 'worktrees', 'worktreeHead'],
	'cherry-pick': ['head', 'heads', 'index', 'pausedOp', 'cherryPick'],
	revert: ['head', 'heads', 'index', 'pausedOp', 'revert'],
	pull: ['head', 'heads', 'index', 'remotes', 'tags', 'lastFetched', 'pausedOp', 'merge', 'rebase'],
	add: ['index'],
	rm: ['index'],
	mv: ['index'],
	restore: ['index'],
	apply: ['index'],
	'read-tree': ['index'],
	'update-index': ['index'],
	clean: ['index'],
	stash: ['stash', 'index'],
	'update-ref': ['head', 'heads', 'remotes', 'tags', 'stash'],
	branch: ['heads', 'remotes'],
	'symbolic-ref': ['head', 'heads', 'remotes', 'tags'],
	'pack-refs': ['heads', 'remotes', 'tags'],
	tag: ['tags'],
	// A refspec can write a local branch (`fetch origin main:main`), which only the typed fetch parses for
	fetch: ['heads', 'remotes', 'tags', 'lastFetched'],
	push: ['remotes'],
	remote: ['remotes', 'config'],
	config: ['config', 'heads', 'remotes'],
	notes: ['heads'],
};

/**
 * `branch` options that write `.git/config`: a rename, copy or delete moves or drops the branch's section, and the
 * rest set or clear its upstream or description. A plain create (or `-f`) writes tracking only from a remote-tracking
 * start point, which the `.git/config` watcher reports.
 */
const branchConfigOptions: readonly string[] = [
	'-d',
	'-D',
	'--delete',
	'-m',
	'-M',
	'--move',
	'-c',
	'-C',
	'--copy',
	'-t',
	'--track',
	'-u',
	'--set-upstream-to',
	'--unset-upstream',
	'--edit-description',
];
const branchConfigChanges: readonly RepositoryChange[] = ['config', 'heads', 'remotes'];

/**
 * Whether creating a branch from `startPoint` may write its tracking to `.git/config`, as git's default
 * `branch.autoSetupMerge=true` does from a remote-tracking start point. Only a name holding a `/` can be one, so a
 * local name with a `/` counts too. The `.git/config` watcher reports what this misses, such as
 * `branch.autoSetupMerge=always`.
 */
export function mayWriteTracking(startPoint: string | undefined, noTracking: boolean | undefined): boolean {
	if (noTracking || !startPoint) return false;
	if (startPoint.startsWith('refs/')) return startPoint.startsWith('refs/remotes/');

	return startPoint.includes('/');
}

const worktreeChanges: readonly RepositoryChange[] = ['worktrees', 'worktreeHead', 'heads'];
const emptyChanges: readonly RepositoryChange[] = [];

export interface CommandChanges {
	changes: readonly RepositoryChange[];
	/** The `-C <path>` target when the caller re-scoped the command to another working tree. */
	pathOverride?: string;
	/** The subset of {@link changes} every worktree sharing the same `.git` sees, not just the tree the command ran in. */
	sharedChanges: readonly RepositoryChange[];
	/**
	 * The full ref names the command creates, moves or deletes, when its argv proves them. A ref kind in
	 * {@link changes} with a name of its kind here is fully described by those names, as `repository.onChanged`'s
	 * `refs` are; a ref kind with none stays unnamed.
	 */
	refs?: readonly string[];
	/** The command's `config` change touches only the `branch.<name>` sections of the local branches {@link refs} names */
	configConfinedToRefs?: boolean;
	/**
	 * The command moves only the branch HEAD is on, or no branch when HEAD is detached, so `git.run` reads HEAD
	 * before and after the run to name it.
	 */
	movesHeadBranch?: boolean;
	/**
	 * The paths, as argv spells them, of the worktrees a `worktree add`, `remove`, `lock`, `unlock` or `move` acts on: a
	 * move's source, then its destination. Unset when argv doesn't name them unambiguously.
	 */
	worktreePaths?: readonly string[];
}

type NamedChanges = Omit<CommandChanges, 'pathOverride' | 'sharedChanges' | 'worktreePaths'>;

const configHeadsChanges: readonly RepositoryChange[] = ['config', 'heads'];
const headsChanges: readonly RepositoryChange[] = ['heads'];
const remotesChanges: readonly RepositoryChange[] = ['remotes'];
const tagsChanges: readonly RepositoryChange[] = ['tags'];
const stashChanges: readonly RepositoryChange[] = ['stash'];
const stashIndexChanges: readonly RepositoryChange[] = ['stash', 'index'];
const stashBranchChanges: readonly RepositoryChange[] = [
	'head',
	'heads',
	'index',
	'stash',
	'worktrees',
	'worktreeHead',
];
const indexChanges: readonly RepositoryChange[] = ['index'];
const headHeadsChanges: readonly RepositoryChange[] = ['head', 'heads'];
// A checkout, rebase, bisect or `stash branch` rewrites the tree's HEAD file, which every other worktree's watcher
// reports as `worktreeHead`: the `worktrees` and `worktreeHead` kinds reach them as shared, so that report is the
// write's own
const headIndexChanges: readonly RepositoryChange[] = ['head', 'index', 'worktrees', 'worktreeHead'];
const checkoutChanges: readonly RepositoryChange[] = ['head', 'heads', 'index', 'worktrees', 'worktreeHead'];
const checkoutTrackingChanges: readonly RepositoryChange[] = [
	'config',
	'head',
	'heads',
	'index',
	'worktrees',
	'worktreeHead',
];
const worktreeOnlyChanges: readonly RepositoryChange[] = ['worktrees'];
const worktreeHeadChanges: readonly RepositoryChange[] = ['worktrees', 'worktreeHead'];
const worktreeTrackingChanges: readonly RepositoryChange[] = ['config', 'worktrees', 'worktreeHead', 'heads'];

const stashRefs: readonly string[] = ['refs/stash'];

/** A full object name, which `checkout` and `worktree add` never DWIM into a new branch */
const fullShaRegex = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/i;

/**
 * Whether a branch name in argv is the branch it names. Git expands `@{-<n>}` (and `@`) wherever it takes a branch
 * name, `branch -d @{-1}` deleting the previous branch, and no ref name can hold `@{` or be `@`
 */
function isLiteralBranchName(name: string): boolean {
	return name !== '@' && !name.includes('@{');
}

interface ParsedArgs {
	/** Each option in argv order, with its value when it takes one */
	options: readonly (readonly [name: string, value: string | undefined])[];
	/** The non-option arguments, including those after `--` */
	positionals: readonly string[];
	/** Where `--` fell in {@link positionals}, for the verbs that take pathspecs after it */
	dashDash?: number;
}

/**
 * Splits a verb's arguments by its own option table, since one letter means different things to different verbs
 * (`-m` moves, merges or sets a message). An option outside the table returns `undefined` rather than a guess at
 * whether it takes a value. A valued option accepts `--opt=<v>`, `--opt <v>`, `-o <v>` and `-o<v>`.
 */
function parseArgs(
	args: readonly string[],
	flags: ReadonlySet<string>,
	valued: ReadonlySet<string>,
): ParsedArgs | undefined {
	const options: [string, string | undefined][] = [];
	const positionals: string[] = [];
	let dashDash: number | undefined;
	let optionsEnded = false;
	for (let i = 0; i < args.length; i++) {
		const arg = args[i];
		// Still a pathspec separator after `--end-of-options`, as `checkout` and `reset` read it
		if (arg === '--' && dashDash == null) {
			dashDash = positionals.length;
			optionsEnded = true;
			continue;
		}
		if (optionsEnded || arg === '-' || !arg.startsWith('-')) {
			positionals.push(arg);
			continue;
		}
		if (arg === '--end-of-options') {
			optionsEnded = true;
			continue;
		}
		if (flags.has(arg)) {
			options.push([arg, undefined]);
			continue;
		}
		if (valued.has(arg)) {
			const value = args[i + 1];
			if (value == null) return undefined;

			options.push([arg, value]);
			i++;
			continue;
		}

		const long = arg.startsWith('--');
		const name = long ? arg.split('=', 1)[0] : arg.slice(0, 2);
		if (name === arg || !valued.has(name)) return undefined;

		options.push([name, arg.slice(long ? name.length + 1 : name.length)]);
	}
	return { options: options, positionals: positionals, dashDash: dashDash };
}

function hasParsedOption(parsed: ParsedArgs, ...names: string[]): boolean {
	return parsed.options.some(([option]) => names.includes(option));
}

const updateRefFlags: ReadonlySet<string> = new Set(['-d', '--delete', '--no-deref', '--create-reflog']);
const updateRefValued: ReadonlySet<string> = new Set(['-m', '--message']);

/**
 * `update-ref` moves the one ref it names, or the ref a symbolic one points to without `--no-deref`, so `HEAD` and a
 * remote's `HEAD` stay unnamed. `null` means a ref outside the namespaces core reads, which the typed
 * `updateReference` doesn't announce either. `git log --all` (graph, search, contributors) does walk such a ref when
 * it points at a commit, and argv can't tell that from a blob ref, so a row it adds or drops can stay stale until the
 * next heads change: the trade the typed write makes not to refresh every worktree on each bookkeeping write. A packed
 * ref's delete rewrites `packed-refs`, which the watcher still reports.
 */
function getUpdateRefChanges(args: readonly string[]): NamedChanges | null | undefined {
	const parsed = parseArgs(args, updateRefFlags, updateRefValued);
	if (parsed == null) return undefined;

	const [ref] = parsed.positionals;
	if (!ref) return undefined;
	if (ref === 'HEAD') return { changes: headHeadsChanges };
	if (!ref.startsWith('refs/')) return undefined;
	if (ref.endsWith('/HEAD') && !hasParsedOption(parsed, '--no-deref')) return undefined;

	const kind = getRefChangeKind(ref);
	if (kind != null) return { changes: [kind], refs: [ref] };
	// The watcher reports `refs/replace` as heads, and `notes` announces heads too
	if (ref.startsWith('refs/replace/') || ref.startsWith('refs/notes/')) return { changes: headsChanges };

	return null;
}

const branchFlags: ReadonlySet<string> = new Set([
	'-f',
	'--force',
	'--no-track',
	'-d',
	'-D',
	'--delete',
	'-m',
	'-M',
	'--move',
	'-c',
	'-C',
	'--copy',
	'-r',
	'--remotes',
	'-q',
	'--quiet',
	'--create-reflog',
]);
const noValuedOptions: ReadonlySet<string> = new Set();

/**
 * The create, delete, rename and copy forms of `branch` name every branch they write. A delete removes a local
 * branch's `branch.<name>` section and a rename or copy moves it; a create writes it only for tracking.
 */
function getBranchChanges(args: readonly string[]): NamedChanges | undefined {
	const parsed = parseArgs(args, branchFlags, noValuedOptions);
	if (parsed == null) return undefined;

	let mode: 'delete' | 'move' | undefined;
	let remote = false;
	let noTrack = false;
	for (const [option] of parsed.options) {
		switch (option) {
			case '-d':
			case '-D':
			case '--delete':
				if (mode === 'move') return undefined;

				mode = 'delete';
				break;
			case '-m':
			case '-M':
			case '--move':
			case '-c':
			case '-C':
			case '--copy':
				if (mode === 'delete') return undefined;

				mode = 'move';
				break;
			case '-r':
			case '--remotes':
				remote = true;
				break;
			case '--no-track':
				noTrack = true;
				break;
		}
	}

	const names = parsed.positionals;
	if (mode === 'delete') {
		if (!names.length || !names.every(isLiteralBranchName)) return undefined;
		if (remote) return { changes: remotesChanges, refs: names.map(n => `refs/remotes/${n}`) };

		return { changes: configHeadsChanges, refs: names.map(n => `refs/heads/${n}`), configConfinedToRefs: true };
	}
	if (remote) return undefined;

	if (mode === 'move') {
		// With one name, git renames or copies the current branch, which argv doesn't name
		if (names.length !== 2 || !names.every(isLiteralBranchName)) return undefined;

		return { changes: configHeadsChanges, refs: names.map(n => `refs/heads/${n}`), configConfinedToRefs: true };
	}

	if ((names.length !== 1 && names.length !== 2) || !isLiteralBranchName(names[0])) return undefined;

	const refs = [`refs/heads/${names[0]}`];
	if (mayWriteTracking(names[1], noTrack)) {
		return { changes: configHeadsChanges, refs: refs, configConfinedToRefs: true };
	}
	return { changes: headsChanges, refs: refs };
}

const tagFlags: ReadonlySet<string> = new Set([
	'-f',
	'--force',
	'-d',
	'--delete',
	'-a',
	'--annotate',
	'-s',
	'--sign',
	'--no-sign',
	'-e',
	'--edit',
	'--create-reflog',
]);
const tagValued: ReadonlySet<string> = new Set(['-m', '--message', '-F', '--file', '-u', '--local-user', '--cleanup']);

function getTagChanges(args: readonly string[]): NamedChanges | undefined {
	const parsed = parseArgs(args, tagFlags, tagValued);
	if (parsed == null) return undefined;

	const names = parsed.positionals;
	if (hasParsedOption(parsed, '-d', '--delete')) {
		if (!names.length) return undefined;

		return { changes: tagsChanges, refs: names.map(n => `refs/tags/${n}`) };
	}
	if (names.length !== 1 && names.length !== 2) return undefined;

	return { changes: tagsChanges, refs: [`refs/tags/${names[0]}`] };
}

/** The `worktree` subcommands besides `add` and `list` (none writes a branch) that delete a worktree's HEAD */
const worktreeHeadSubcommands: ReadonlySet<string> = new Set(['remove', 'prune']);
/** The rest, which touch no worktree's HEAD */
const worktreeEditSubcommands: ReadonlySet<string> = new Set(['lock', 'unlock', 'move', 'repair']);
const worktreeAddFlags: ReadonlySet<string> = new Set([
	'-f',
	'--force',
	'-d',
	'--detach',
	'--checkout',
	'--no-checkout',
	'--lock',
	'-q',
	'--quiet',
	'--track',
	'--no-track',
	'--guess-remote',
	'--no-guess-remote',
	'--orphan',
]);
const worktreeAddValued: ReadonlySet<string> = new Set(['-b', '-B', '--reason']);

/**
 * `worktree add` is the only subcommand that can create a branch: the `-b`/`-B` one it names or, without either, one
 * git DWIMs from a short commit-ish (or from the path, given none), which argv can't name. A detached or full-SHA add
 * creates none.
 */
function getWorktreeChanges(args: readonly string[]): NamedChanges | undefined {
	const [subcommand, ...rest] = args;
	if (subcommand != null && worktreeEditSubcommands.has(subcommand)) return { changes: worktreeOnlyChanges };
	if (subcommand != null && worktreeHeadSubcommands.has(subcommand)) return { changes: worktreeHeadChanges };
	if (subcommand !== 'add') return undefined;

	const parsed = parseArgs(rest, worktreeAddFlags, worktreeAddValued);
	if (parsed == null) return undefined;

	let branch: string | undefined;
	let detach = false;
	let orphan = false;
	let track: boolean | undefined;
	for (const [option, value] of parsed.options) {
		switch (option) {
			case '-b':
			case '-B':
				branch = value;
				break;
			case '-d':
			case '--detach':
				detach = true;
				break;
			case '--orphan':
				orphan = true;
				break;
			case '--track':
				track = true;
				break;
			case '--no-track':
				track = false;
				break;
		}
	}

	const [path, commitish, ...extra] = parsed.positionals;
	if (orphan || path == null || extra.length) return undefined;

	if (branch) {
		if (!isLiteralBranchName(branch)) return undefined;

		const refs = [`refs/heads/${branch}`];
		// An explicit `--track` writes tracking from a local start point too. Git may also write
		// `extensions.relativeWorktrees` (under `worktree.useRelativePaths`), which nothing a worktree shows reads, so
		// the change is still claimed confined: unlike the typed add, a raw run can't evict the config cache unannounced
		if (track === true || mayWriteTracking(commitish, track === false)) {
			return { changes: worktreeTrackingChanges, refs: refs, configConfinedToRefs: true };
		}
		return { changes: worktreeChanges, refs: refs };
	}
	if (detach || (commitish != null && fullShaRegex.test(commitish))) return { changes: worktreeHeadChanges };

	return undefined;
}

const noOptions: ReadonlySet<string> = new Set();
const worktreeForceFlags: ReadonlySet<string> = new Set(['-f', '--force']);
const worktreeLockValued: ReadonlySet<string> = new Set(['--reason']);

/** The `worktree` subcommands that act on worktrees argv names: their option tables and how many positionals they take */
const worktreePathSubcommands: Readonly<
	Record<string, readonly [flags: ReadonlySet<string>, valued: ReadonlySet<string>, min: number, max: number]>
> = {
	add: [worktreeAddFlags, worktreeAddValued, 1, 2],
	remove: [worktreeForceFlags, noOptions, 1, 1],
	lock: [noOptions, worktreeLockValued, 1, 1],
	unlock: [noOptions, noOptions, 1, 1],
	move: [worktreeForceFlags, noOptions, 2, 2],
};

/** See {@link CommandChanges.worktreePaths}; an `add`'s second positional is its commit-ish, not a path */
function getWorktreePaths(args: readonly string[]): readonly string[] | undefined {
	const [subcommand, ...rest] = args;
	const spec = subcommand != null ? worktreePathSubcommands[subcommand] : undefined;
	if (spec == null) return undefined;

	const [flags, valued, min, max] = spec;
	const positionals = parseArgs(rest, flags, valued)?.positionals;
	if (positionals == null || positionals.length < min || positionals.length > max) return undefined;

	return subcommand === 'move' ? positionals : positionals.slice(0, 1);
}

const checkoutFlags: ReadonlySet<string> = new Set([
	'-q',
	'--quiet',
	'-f',
	'--force',
	'--detach',
	'--no-track',
	'-m',
	'--merge',
	'--progress',
	'--no-progress',
	'--ignore-other-worktrees',
	'--overwrite-ignore',
	'--no-overwrite-ignore',
	'--recurse-submodules',
	'--no-recurse-submodules',
]);
const checkoutValued: ReadonlySet<string> = new Set(['-b', '-B']);
const switchFlags: ReadonlySet<string> = new Set([...checkoutFlags, '-d', '--discard-changes']);
const switchValued: ReadonlySet<string> = new Set(['-c', '-C', '--create', '--force-create']);

/**
 * `checkout`/`switch` moves no existing branch, so the only shared ref it writes is one it creates: the `-b`/`-c` one
 * it names, or the one git DWIMs from a remote branch named like its lone argument. A detached or full-SHA checkout
 * creates none, and a pathspec checkout writes only the index and working tree.
 */
function getCheckoutChanges(verb: 'checkout' | 'switch', args: readonly string[]): NamedChanges | undefined {
	const parsed =
		verb === 'switch' ? parseArgs(args, switchFlags, switchValued) : parseArgs(args, checkoutFlags, checkoutValued);
	if (parsed == null) return undefined;

	let branch: string | undefined;
	let detach = false;
	let noTrack = false;
	for (const [option, value] of parsed.options) {
		if (value != null) {
			branch = value;
		} else if (option === '-d' || option === '--detach') {
			detach = true;
		} else if (option === '--no-track') {
			noTrack = true;
		}
	}

	const { positionals, dashDash } = parsed;
	const revs = dashDash == null ? positionals : positionals.slice(0, dashDash);
	const hasPaths = dashDash != null && dashDash < positionals.length;
	if (branch != null) {
		if (hasPaths || revs.length > 1 || !isLiteralBranchName(branch)) return undefined;

		const refs = [`refs/heads/${branch}`];
		if (mayWriteTracking(revs[0], noTrack)) {
			return { changes: checkoutTrackingChanges, refs: refs, configConfinedToRefs: true };
		}
		return { changes: checkoutChanges, refs: refs };
	}
	if (hasPaths) return verb === 'checkout' ? { changes: indexChanges } : undefined;
	if (revs.length > 1) return undefined;
	if (detach) return { changes: headIndexChanges };

	const [rev] = revs;
	if (rev == null || rev === '-' || rev.startsWith('@{-')) return undefined;
	if (fullShaRegex.test(rev)) return { changes: headIndexChanges };

	// A path, an existing ref, or a branch git DWIMs from a remote branch, tracking it from its own config section
	return { changes: checkoutTrackingChanges, refs: [`refs/heads/${rev}`], configConfinedToRefs: true };
}

/**
 * A stash write moves only `refs/stash` (or its reflog, the rest of the list), save `branch`, which also creates the
 * branch it names from a commit and checks it out; `apply` moves no ref
 */
function getStashChanges(subcommand: string | undefined, rest: readonly string[]): NamedChanges | undefined {
	switch (subcommand) {
		case 'branch': {
			const name = rest[1];
			if (!name || name.startsWith('-') || !isLiteralBranchName(name)) return undefined;

			return { changes: stashBranchChanges, refs: [`refs/heads/${name}`, ...stashRefs] };
		}
		case undefined:
		case 'push':
		case 'save':
		case 'pop':
			return { changes: stashIndexChanges, refs: stashRefs };
		case 'drop':
		case 'clear':
		case 'store':
			return { changes: stashChanges, refs: stashRefs };
		case 'apply':
			return { changes: indexChanges };
		default:
			// A bare `stash` with options is a push
			return subcommand.startsWith('-') ? { changes: stashIndexChanges, refs: stashRefs } : undefined;
	}
}

/** A `reset` given paths, or `-p`, restores index entries and moves no ref */
function isPathspecReset(args: readonly string[]): boolean {
	const dashDash = args.indexOf('--');
	if (dashDash >= 0 && dashDash < args.length - 1) return true;

	return args.some(
		arg =>
			arg === '-p' ||
			arg === '--patch' ||
			arg === '--pathspec-from-file' ||
			arg.startsWith('--pathspec-from-file='),
	);
}

const falseConfigValues: ReadonlySet<string> = new Set(['false', 'no', 'off', '0', '']);

/**
 * The `rebase` options that take the refs it writes out of argv's hands: the update-refs list was fixed when the
 * rebase started, whatever this argv says, an interactive or `--exec` todo list can write any ref, and `--update-refs`
 * spelled any other way than in full turns update-refs on
 */
const unprovableRebaseOptions: readonly string[] = [
	'--continue',
	'--skip',
	'--edit-todo',
	'--interactive',
	'--exec',
	'--update-refs',
];

/**
 * Whether `arg` is one of {@link unprovableRebaseOptions}, `-i` or `-x`, however git lets it be written: any unique
 * prefix of a long option, before any `=<value>` (`--cont`, `--update-ref`, `--exe=make`), and short ones bundled
 * (`-ri`, `-xmake`)
 */
function isUnprovableRebaseOption(arg: string): boolean {
	if (arg.startsWith('--')) {
		const name = arg.split('=', 1)[0];
		return name.length > 2 && unprovableRebaseOptions.some(o => o.startsWith(name));
	}
	return arg.length > 1 && arg.startsWith('-') && /[ix]/.test(arg.slice(1));
}

/**
 * Whether a `rebase` moves only the branch being rebased. Update-refs would rewrite every branch in the rebased range,
 * so it must be provably off: the last of `--update-refs`/`--no-update-refs`, else the last `-c rebase.updateRefs`
 * before the verb. An interactive or `--exec` rebase can write any ref from its todo list. Git writes the listed refs
 * only when the rebase finishes, so an abort or quit moves none.
 */
function isHeadBranchRebase(command: LeadingCommand): boolean {
	let off: boolean | undefined;
	for (const arg of command.rest) {
		if (arg === '--' || arg === '--end-of-options') break;

		if (arg === '--abort' || arg === '--quit') return true;

		if (arg === '--no-update-refs') {
			off = true;
		} else if (arg === '--update-refs') {
			off = false;
		} else if (isUnprovableRebaseOption(arg)) {
			return false;
		}
	}
	if (off != null) return off;

	for (const config of command.configs ?? []) {
		const separator = config.indexOf('=');
		const key = separator < 0 ? config : config.slice(0, separator);
		if (key.toLowerCase() !== 'rebase.updaterefs') continue;

		// A bare `-c key` is git's `true`
		off = separator >= 0 && falseConfigValues.has(config.slice(separator + 1).toLowerCase());
	}
	return off ?? false;
}

/** Verbs that move only the branch HEAD is on, or none from a detached HEAD */
const headBranchVerbs: ReadonlySet<string> = new Set(['commit', 'merge', 'cherry-pick', 'revert', 'am']);

/**
 * What argv proves more precisely than {@link changesByVerb}: the refs a write moved, or fewer kinds. `undefined`
 * keeps the verb's table entry; `null` means the write moved nothing cached.
 */
function getNamedChanges(command: LeadingCommand): NamedChanges | null | undefined {
	switch (command.verb) {
		case 'update-ref':
			return getUpdateRefChanges(command.rest);
		case 'branch':
			return getBranchChanges(command.rest);
		case 'tag':
			return getTagChanges(command.rest);
		case 'worktree':
			return getWorktreeChanges(command.rest);
		case 'checkout':
		case 'switch':
			return getCheckoutChanges(command.verb, command.rest);
		case 'stash':
			return getStashChanges(command.subcommand, command.rest);
		case 'reset':
			if (isPathspecReset(command.rest)) return { changes: indexChanges };

			return { changes: changesByVerb.reset, movesHeadBranch: true };
		case 'rebase':
			if (!isHeadBranchRebase(command)) return undefined;

			return { changes: changesByVerb.rebase, movesHeadBranch: true };
		default:
			if (!headBranchVerbs.has(command.verb)) return undefined;

			return { changes: changesByVerb[command.verb], movesHeadBranch: true };
	}
}

/**
 * Classifies a raw git argv for the notification `git.run`'s `notify: 'infer'` applies after the run
 * settles. Returns `undefined` for a command with nothing to announce — read-only, object-only, or a write to a
 * ref nothing cached reads — otherwise the {@link RepositoryChange} kinds it announces, the refs it names when argv
 * proves them, the `-C` re-scope target (if any), and which of those kinds every worktree sees.
 */
export function getChangesForCommand(args: readonly string[]): CommandChanges | undefined {
	const command = leadingCommand(args);
	if (command.readOnly || objectOnlyVerbs.has(command.verb)) return undefined;

	const named = getNamedChanges(command);
	if (named === null) return undefined;

	let changes = named?.changes;
	if (changes == null) {
		if (command.verb === 'worktree') {
			changes = worktreeChanges;
		} else if (command.verb === 'branch' && hasOption(command.rest, branchConfigOptions)) {
			changes = branchConfigChanges;
		} else {
			changes = changesByVerb[command.verb] ?? emptyChanges;
		}
	}
	const result: CommandChanges = {
		...named,
		changes: changes,
		pathOverride: command.pathOverride,
		sharedChanges: changes.filter(c => worktreeSharedChanges.has(c)),
	};
	if (command.verb === 'worktree') {
		const worktreePaths = getWorktreePaths(command.rest);
		if (worktreePaths != null) {
			result.worktreePaths = worktreePaths;
		}
	}
	return result;
}
