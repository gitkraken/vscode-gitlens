import { isAbsolute, join } from 'node:path';
import type { RepositoryChange } from '@gitlens/git/models/repository.js';

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
	stash: new Set(['list', 'show']),
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
	/** The `-C <path>` target when the caller re-scopes the command to another working tree. */
	pathOverride?: string;
}

/**
 * Skips the global options (`-c key=val`, `-C path`) git accepts before the verb to find it, and notes a
 * `-C` re-scope so notification targets that tree.
 */
export function leadingCommand(args: readonly string[]): LeadingCommand {
	let pathOverride: string | undefined;
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

	return { verb: verb, readOnly: readOnly, subcommand: rest[0], pathOverride: pathOverride };
}

/**
 * The change kinds every worktree sharing a `.git` sees: its refs, stash, worktree list and config. The rest a
 * classified verb announces — HEAD, the index, a paused operation, FETCH_HEAD — belong to the one tree the
 * command ran in, so a `-C`-scoped write tells the caller's own `cwd` only this subset of what it changed.
 */
const worktreeSharedChanges: ReadonlySet<RepositoryChange> = new Set([
	'heads',
	'tags',
	'stash',
	'remotes',
	'worktrees',
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
 * The kinds decide which caches the announcement resets, so a verb that can start or end a paused operation
 * names `pausedOp`: `commit` concludes a merge, cherry-pick or revert, `reset` aborts one, and `am` runs in
 * `rebase-apply`.
 */
const changesByVerb: Readonly<Record<string, readonly RepositoryChange[]>> = {
	commit: ['head', 'heads', 'index', 'pausedOp'],
	am: ['head', 'heads', 'index', 'pausedOp'],
	bisect: ['head', 'index'],
	checkout: ['head', 'heads', 'index'],
	switch: ['head', 'heads', 'index'],
	reset: ['head', 'heads', 'index', 'pausedOp'],
	merge: ['head', 'heads', 'index', 'pausedOp', 'merge'],
	rebase: ['head', 'heads', 'index', 'pausedOp', 'rebase'],
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
	branch: ['heads', 'remotes', 'tags'],
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

const worktreeChanges: readonly RepositoryChange[] = ['worktrees', 'heads'];
const emptyChanges: readonly RepositoryChange[] = [];

export interface CommandChanges {
	changes: readonly RepositoryChange[];
	/** The `-C <path>` target when the caller re-scoped the command to another working tree. */
	pathOverride?: string;
	/** The subset of {@link changes} every worktree sharing the same `.git` sees, not just the tree the command ran in. */
	sharedChanges: readonly RepositoryChange[];
}

/**
 * Classifies a raw git argv for the notification `git.run`'s `notify: 'infer'` applies after the run
 * settles. Returns `undefined` for a read-only or object-only command — nothing to announce — otherwise
 * the {@link RepositoryChange} kinds the verb announces, the `-C` re-scope target (if any), and which of
 * those kinds every worktree sees.
 */
export function getChangesForCommand(args: readonly string[]): CommandChanges | undefined {
	const command = leadingCommand(args);
	if (command.readOnly || objectOnlyVerbs.has(command.verb)) return undefined;

	// `worktree list` is read-only (filtered out above); every other subcommand adds, removes or
	// relocks a checkout, which is both a worktree-list change and, for `add`, a brand-new HEAD.
	const changes = command.verb === 'worktree' ? worktreeChanges : (changesByVerb[command.verb] ?? emptyChanges);
	return {
		changes: changes,
		pathOverride: command.pathOverride,
		sharedChanges: changes.filter(c => worktreeSharedChanges.has(c)),
	};
}
