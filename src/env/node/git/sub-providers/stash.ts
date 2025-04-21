import type { Uri } from 'vscode';
import { window } from 'vscode';
import type { Container } from '../../../../container';
import type { GitCache } from '../../../../git/cache';
import { GitErrorHandling } from '../../../../git/commandOptions';
import { StashApplyError, StashApplyErrorReason } from '../../../../git/errors';
import type { GitStashSubProvider } from '../../../../git/gitProvider';
import type { GitStashCommit } from '../../../../git/models/commit';
import { GitCommit, GitCommitIdentity } from '../../../../git/models/commit';
import { GitFileChange } from '../../../../git/models/fileChange';
import type { GitFileStatus } from '../../../../git/models/fileStatus';
import { GitFileWorkingTreeStatus } from '../../../../git/models/fileStatus';
import { RepositoryChange } from '../../../../git/models/repository';
import type { GitStash } from '../../../../git/models/stash';
import type { ParsedStash } from '../../../../git/parsers/logParser';
import { getStashFilesOnlyLogParser, getStashLogParser } from '../../../../git/parsers/logParser';
import { configuration } from '../../../../system/-webview/configuration';
import { splitPath } from '../../../../system/-webview/path';
import { countStringLength } from '../../../../system/array';
import { gate } from '../../../../system/decorators/-webview/gate';
import { log } from '../../../../system/decorators/log';
import { join, map, min, skip } from '../../../../system/iterable';
import { getSettledValue } from '../../../../system/promise';
import type { Git } from '../git';
import { maxGitCliLength } from '../git';
import { RunError } from '../shell';

const stashSummaryRegex =
	// eslint-disable-next-line no-control-regex
	/(?:(?:(?<wip>WIP) on|On) (?<onref>[^/](?!.*\/\.)(?!.*\.\.)(?!.*\/\/)(?!.*@\{)[^\x00-\x1F\x7F ~^:?*[\\]+[^./]):\s*)?(?<summary>.*)$/s;

export class StashGitSubProvider implements GitStashSubProvider {
	constructor(
		private readonly container: Container,
		private readonly git: Git,
		private readonly cache: GitCache,
	) {}

	@gate()
	@log()
	async applyStash(repoPath: string, stashName: string, options?: { deleteAfter?: boolean }): Promise<void> {
		if (!stashName) return;

		try {
			await this.git.exec({ cwd: repoPath }, 'stash', options?.deleteAfter ? 'pop' : 'apply', stashName);
			this.container.events.fire('git:repo:change', { repoPath: repoPath, changes: [RepositoryChange.Stash] });
		} catch (ex) {
			if (ex instanceof Error) {
				const msg: string = ex.message ?? '';
				if (msg.includes('Your local changes to the following files would be overwritten by merge')) {
					throw new StashApplyError(StashApplyErrorReason.WorkingChanges, ex);
				}

				if (
					(msg.includes('Auto-merging') && msg.includes('CONFLICT')) ||
					(ex instanceof RunError &&
						((ex.stdout.includes('Auto-merging') && ex.stdout.includes('CONFLICT')) ||
							ex.stdout.includes('needs merge')))
				) {
					void window.showInformationMessage('Stash applied with conflicts');

					return;
				}

				throw new StashApplyError(`Unable to apply stash \u2014 ${msg.trim().replace(/\n+?/g, '; ')}`, ex);
			}

			throw new StashApplyError(`Unable to apply stash \u2014 ${String(ex)}`, ex);
		}
	}

	@gate()
	@log()
	async getStash(repoPath: string | undefined, options?: { reachableFrom?: string }): Promise<GitStash | undefined> {
		if (repoPath == null) return undefined;

		let gitStash = this.cache.stashes?.get(repoPath);
		if (gitStash === undefined) {
			const parser = getStashLogParser();
			const args = [...parser.arguments];

			const similarityThreshold = configuration.get('advanced.similarityThreshold');
			args.push(`-M${similarityThreshold == null ? '' : `${similarityThreshold}%`}`);

			const data = await this.git.exec({ cwd: repoPath }, 'stash', 'list', ...args);

			const stashes = new Map<string, GitStashCommit>();

			for (const s of parser.parse(data)) {
				stashes.set(s.sha, createStash(this.container, s, repoPath));
			}

			gitStash = { repoPath: repoPath, stashes: stashes };

			this.cache.stashes?.set(repoPath, gitStash ?? null);
		}

		// Return only reachable stashes from the given ref
		if (options?.reachableFrom && gitStash?.stashes.size) {
			// Create a copy because we are going to modify it and we don't want to mutate the cache
			gitStash = { ...gitStash, stashes: new Map(gitStash.stashes) };

			const oldestStashDate = new Date(min(gitStash.stashes.values(), c => c.date.getTime())).toISOString();

			const data = await this.git.exec(
				{ cwd: repoPath, errors: GitErrorHandling.Ignore },
				'rev-list',
				`--since="${oldestStashDate}"`,
				'--date-order',
				options.reachableFrom,
				'--',
			);

			const ancestors = data?.trim().split('\n');
			if (ancestors?.length && (ancestors.length !== 1 || ancestors[0])) {
				const reachableCommits = new Set(ancestors);

				if (reachableCommits.size) {
					const reachableStashes = new Set<string>();

					// First pass: mark directly reachable stashes
					for (const [sha, stash] of gitStash.stashes) {
						if (stash.parents.some(p => p === options.reachableFrom || reachableCommits.has(p))) {
							reachableStashes.add(sha);
						}
					}

					// Second pass: mark stashes that build upon reachable stashes
					let changed;
					do {
						changed = false;
						for (const [sha, stash] of gitStash.stashes) {
							if (!reachableStashes.has(sha) && stash.parents.some(p => reachableStashes.has(p))) {
								reachableStashes.add(sha);
								changed = true;
							}
						}
					} while (changed);

					// Remove unreachable stashes
					for (const [sha] of gitStash.stashes) {
						if (!reachableStashes.has(sha)) {
							gitStash.stashes.delete(sha);
						}
					}
				} else {
					gitStash.stashes.clear();
				}
			}
		}

		return gitStash ?? undefined;
	}

	@gate()
	@log()
	async getStashCommitFiles(repoPath: string, ref: string): Promise<GitFileChange[]> {
		const [stashFilesResult, stashUntrackedFilesResult] = await Promise.allSettled([
			// Don't include untracked files here, because we won't be able to tell them apart from added (and we need the untracked status)
			this.getStashCommitFilesCore(repoPath, ref, { untracked: false }),
			// Check for any untracked files -- since git doesn't return them via `git stash list` :(
			// See https://stackoverflow.com/questions/12681529/
			this.getStashCommitFilesCore(repoPath, ref, { untracked: 'only' }),
		]);

		let files = getSettledValue(stashFilesResult);
		const untrackedFiles = getSettledValue(stashUntrackedFilesResult);

		if (files?.length && untrackedFiles?.length) {
			files.push(...untrackedFiles);
		} else {
			files = files ?? untrackedFiles;
		}

		return files ?? [];
	}

	private async getStashCommitFilesCore(
		repoPath: string,
		ref: string,
		options?: { untracked?: boolean | 'only' },
	): Promise<GitFileChange[] | undefined> {
		const args = [];
		if (options?.untracked) {
			args.push(options?.untracked === 'only' ? '--only-untracked' : '--include-untracked');
		}

		const similarityThreshold = configuration.get('advanced.similarityThreshold');
		if (similarityThreshold != null) {
			args.push(`-M${similarityThreshold}%`);
		}

		const parser = getStashFilesOnlyLogParser();
		const data = await this.git.exec({ cwd: repoPath }, 'stash', 'show', ...args, ...parser.arguments, ref);

		for (const s of parser.parse(data)) {
			return (
				s.files?.map(
					f =>
						new GitFileChange(
							this.container,
							repoPath,
							f.path,
							(options?.untracked === 'only'
								? GitFileWorkingTreeStatus.Untracked
								: f.status) as GitFileStatus,
							f.originalPath,
							undefined,
							f.additions || f.deletions
								? {
										additions: f.additions ?? 0,
										deletions: f.deletions ?? 0,
										changes: 0,
								  }
								: undefined,
						),
				) ?? []
			);
		}

		return undefined;
	}

	@gate()
	@log()
	async deleteStash(repoPath: string, stashName: string, sha?: string): Promise<void> {
		await this.deleteStashCore(repoPath, stashName, sha);
		this.container.events.fire('git:repo:change', { repoPath: repoPath, changes: [RepositoryChange.Stash] });
		this.container.events.fire('git:cache:reset', { repoPath: repoPath, types: ['stashes'] });
	}

	private async deleteStashCore(repoPath: string, stashName: string, sha?: string): Promise<string | undefined> {
		if (!stashName) return undefined;

		if (sha) {
			const stashSha = await this.git.exec(
				{ cwd: repoPath, errors: GitErrorHandling.Ignore },
				'show',
				'--format=%H',
				'--no-patch',
				stashName,
			);
			if (stashSha?.trim() !== sha) {
				throw new Error('Unable to delete stash; mismatch with stash number');
			}
		}

		// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-arguments
		return this.git.exec<string>({ cwd: repoPath }, 'stash', 'drop', stashName);
	}

	@gate()
	@log()
	async renameStash(
		repoPath: string,
		stashName: string,
		sha: string,
		message: string,
		stashOnRef?: string,
	): Promise<void> {
		await this.deleteStashCore(repoPath, stashName, sha);
		await this.git.exec(
			{ cwd: repoPath },
			'stash',
			'store',
			'-m',
			stashOnRef ? `On ${stashOnRef}: ${message}` : message,
			sha,
		);

		this.container.events.fire('git:repo:change', { repoPath: repoPath, changes: [RepositoryChange.Stash] });
		this.container.events.fire('git:cache:reset', { repoPath: repoPath, types: ['stashes'] });
	}

	@log<StashGitSubProvider['saveStash']>({ args: { 2: uris => uris?.length } })
	async saveStash(
		repoPath: string,
		message?: string,
		uris?: Uri[],
		options?: { includeUntracked?: boolean; keepIndex?: boolean; onlyStaged?: boolean },
	): Promise<void> {
		if (!uris?.length) {
			await this.git.stash__push(repoPath, message, options);
			this.container.events.fire('git:repo:change', { repoPath: repoPath, changes: [RepositoryChange.Stash] });
			this.container.events.fire('git:cache:reset', { repoPath: repoPath, types: ['stashes', 'status'] });
			return;
		}

		await this.git.ensureSupports(
			'git:stash:push:pathspecs',
			'Stashing individual files',
			' Please retry by stashing everything or install a more recent version of Git and try again.',
		);

		const pathspecs = uris.map(u => `./${splitPath(u, repoPath)[0]}`);

		let stdin = await this.git.supports('git:stash:push:stdin');
		if (stdin && options?.onlyStaged && uris.length) {
			// Since Git doesn't support --staged with --pathspec-from-file try to pass them in directly
			stdin = false;
		}

		// If we don't support stdin, then error out if we are over the maximum allowed git cli length
		if (!stdin && countStringLength(pathspecs) > maxGitCliLength) {
			await this.git.ensureSupports(
				'git:stash:push:stdin',
				`Stashing so many files (${pathspecs.length}) at once`,
				' Please retry by stashing fewer files or install a more recent version of Git and try again.',
			);
		}

		await this.git.stash__push(repoPath, message, {
			...options,
			pathspecs: pathspecs,
			stdin: stdin,
		});
		this.container.events.fire('git:cache:reset', { repoPath: repoPath, types: ['stashes', 'status'] });
	}

	@gate()
	@log()
	async saveSnapshot(repoPath: string, message?: string): Promise<void> {
		const data = await this.git.exec({ cwd: repoPath }, 'stash', 'create');
		const id = data?.trim() || undefined;
		if (id == null) return;

		const args = [];
		if (message) {
			args.push('-m', message);
		}
		await this.git.exec({ cwd: repoPath }, 'stash', 'store', ...args, id);

		this.container.events.fire('git:repo:change', { repoPath: repoPath, changes: [RepositoryChange.Stash] });
		this.container.events.fire('git:cache:reset', { repoPath: repoPath, types: ['stashes'] });
	}
}

export function convertStashesToStdin(stashOrStashes: GitStash | Map<string, GitStashCommit> | undefined): {
	stdin: string | undefined;
	stashes: Map<string, GitStashCommit>;
} {
	if (stashOrStashes == null) return { stdin: undefined, stashes: new Map() };

	let stdin: string | undefined;
	let stashes: Map<string, GitStashCommit>;

	if ('stashes' in stashOrStashes) {
		stashes = new Map(stashOrStashes.stashes);
		if (stashOrStashes.stashes.size) {
			stdin = '';
			for (const stash of stashOrStashes.stashes.values()) {
				stdin += `${stash.sha.substring(0, 9)}\n`;
				// Include the stash's 2nd (index files) and 3rd (untracked files) parents
				for (const p of skip(stash.parents, 1)) {
					stashes.set(p, stash);
					stdin += `${p.substring(0, 9)}\n`;
				}
			}
		}
	} else {
		stdin = join(
			map(stashOrStashes.values(), c => c.sha.substring(0, 9)),
			'\n',
		);
		stashes = stashOrStashes;
	}

	return { stdin: stdin || undefined, stashes: stashes };
}

function createStash(container: Container, s: ParsedStash, repoPath: string): GitStashCommit {
	let onRef;
	let summary;
	let message;

	const match = stashSummaryRegex.exec(s.summary);
	if (match?.groups != null) {
		onRef = match.groups.onref;
		summary = match.groups.summary.trim();

		if (summary.length === 0) {
			message = 'WIP';
		} else if (match.groups.wip) {
			message = `WIP: ${summary}`;
		} else {
			message = summary;
		}
	} else {
		message = s.summary.trim();
	}

	return new GitCommit(
		container,
		repoPath,
		s.sha,
		new GitCommitIdentity('You', undefined, new Date((s.authorDate as unknown as number) * 1000)),
		new GitCommitIdentity('You', undefined, new Date((s.committedDate as unknown as number) * 1000)),
		message.split('\n', 1)[0] ?? '',
		s.parents.split(' '),
		message,
		{
			files:
				s.files?.map(
					f =>
						new GitFileChange(
							container,
							repoPath,
							f.path,
							f.status as GitFileStatus,
							f.originalPath,
							undefined,
							{ additions: f.additions ?? 0, deletions: f.deletions ?? 0, changes: 0 },
						),
				) ?? [],
			filtered: false,
		},
		s.stats,
		undefined,
		undefined,
		s.stashName,
		onRef,
	) as GitStashCommit;
}
