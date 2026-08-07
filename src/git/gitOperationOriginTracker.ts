import { Disposable } from 'vscode';
import { getRepositoryKey } from '@gitlens/utils/uri.js';
import type { Container } from '../container.js';

type OperationOrigin = {
	command: 'rebase' | 'pull' | 'adopted';
	startedAt: number;
	/** Whether rebase state was observed on disk after the operation started */
	sawRebase: boolean;
};

/**
 * Tracks which repositories have a rebase-capable git operation that was started (or adopted)
 * from inside GitLens, so watcher-driven auto-open (`rebaseEditor.openOnPausedRebase: 'auto'`)
 * can ignore rebases started externally (terminals, agents, other tools).
 *
 * In-memory only — a window reload mid-rebase degrades to no auto-open until the user acts on
 * the operation through GitLens again (see {@link markAdopted}).
 */
export class GitOperationOriginTracker implements Disposable {
	/** How long an entry may claim a not-yet-observed rebase before a null status clears it */
	private static readonly startupGraceMs = 2000;

	private readonly _disposable: Disposable;
	private readonly _origins = new Map<string, OperationOrigin>();

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			container.git.onDidChangeRepository(e => {
				if (e.changed('rebase')) {
					void this.onRebaseChanged(e.repository.path);
				}
			}),
			container.git.onDidChangeRepositories(e => {
				for (const repo of e.removed) {
					this._origins.delete(getRepositoryKey(repo.path));
				}
			}),
		);
	}

	dispose(): void {
		this._disposable.dispose();
		this._origins.clear();
	}

	/** Records that GitLens started a rebase-capable operation in the repository */
	markStarted(repoPath: string, command: 'rebase' | 'pull'): void {
		this._origins.set(getRepositoryKey(repoPath), { command: command, startedAt: Date.now(), sawRebase: false });
	}

	/**
	 * Validates the entry against disk when the operation's git command exits. This is the primary
	 * cleanup for operations that never start a rebase (e.g. a fast-forward pull) — those produce
	 * no rebase watcher events at all, so without this check the entry would linger and claim the
	 * next externally-started rebase. It also covers a rebase that completes faster than the
	 * watcher debounce delivers its events.
	 */
	async onOperationEnded(repoPath: string): Promise<void> {
		const key = getRepositoryKey(repoPath);
		const entry = this._origins.get(key);
		if (entry == null) return;

		// Force — a status cached from before the operation must not decide this
		const svc = this.container.git.getRepositoryService(repoPath);
		const status = await svc.pausedOps?.getPausedOperationStatus?.({ force: true });
		if (status?.type === 'rebase') {
			entry.sawRebase = true;
			return;
		}

		// The command exited without leaving a rebase in progress. Only delete if the map still
		// holds the same entry — the async status read must not clobber a newer `markStarted`
		if (this._origins.get(key) === entry) {
			this._origins.delete(key);
		}
	}

	/**
	 * Records that the user acted on an existing (externally-started) operation through GitLens
	 * (e.g. continue/skip), adopting it so its later pauses auto-open
	 */
	markAdopted(repoPath: string): void {
		this._origins.set(getRepositoryKey(repoPath), { command: 'adopted', startedAt: Date.now(), sawRebase: true });
	}

	isGitLensInitiated(repoPath: string): boolean {
		return this._origins.has(getRepositoryKey(repoPath));
	}

	clear(repoPath: string): void {
		this._origins.delete(getRepositoryKey(repoPath));
	}

	private async onRebaseChanged(repoPath: string): Promise<void> {
		const key = getRepositoryKey(repoPath);
		const entry = this._origins.get(key);
		if (entry == null) return;

		const svc = this.container.git.getRepositoryService(repoPath);
		const status = await svc.pausedOps?.getPausedOperationStatus?.();
		if (status?.type === 'rebase') {
			entry.sawRebase = true;
			return;
		}

		// No rebase state on disk. Clear once we've seen the rebase exist (it started and is now
		// over — this is what catches an external `--continue`/`--abort` ending it), or after the
		// startup grace period. The grace period guards the startup race where a watcher event
		// lands before `.git/rebase-merge/` is fully created; operations that never start a
		// rebase at all produce no watcher events and are cleaned up by `onOperationEnded`.
		if (entry.sawRebase || Date.now() - entry.startedAt > GitOperationOriginTracker.startupGraceMs) {
			this._origins.delete(key);
		}
	}
}
