import { Disposable } from 'vscode';
import type { GitReflogEntry } from '@gitlens/git/models/reflog.js';
import type { RepositoryChangeEvent } from '@gitlens/git/models/repositoryChangeEvent.js';
import { isCommitCreated } from '@gitlens/git/watching/commitCreated.js';
import { Logger } from '@gitlens/utils/logger.js';
import { getRepositoryKey } from '@gitlens/utils/uri.js';
import type { Container } from '../container.js';

export class CommitCreatedTelemetry implements Disposable {
	private readonly _disposable: Disposable;
	private readonly _newestShas = new Map<string, Promise<string | undefined>>();

	constructor(private readonly container: Container) {
		this._disposable = Disposable.from(
			container.git.onDidChangeRepositories(e => {
				for (const repo of e.removed) {
					this._newestShas.delete(getRepositoryKey(repo.path));
				}
				for (const repo of e.added) {
					this.update(repo.path);
				}
			}),
			container.git.onDidChangeRepository(e => {
				if (e.changed('heads')) {
					this.update(e.repository.path, e);
				}
			}),
		);

		for (const repo of container.git.openRepositories) {
			this.update(repo.path);
		}
	}

	dispose(): void {
		this._disposable.dispose();
		this._newestShas.clear();
	}

	private update(repoPath: string, e?: RepositoryChangeEvent): void {
		const key = getRepositoryKey(repoPath);
		if (!this.container.telemetry.enabled) {
			this._newestShas.delete(key);
			return;
		}

		const pending = this._newestShas.get(key);
		this._newestShas.set(
			key,
			(async () => {
				const previous = await pending;
				const current = await this.getNewestReflogEntry(repoPath);
				if (e != null && isCommitCreated(previous, current, e)) {
					try {
						this.container.telemetry.sendEvent('commit/created');
					} catch (ex) {
						Logger.error(ex, 'CommitCreatedTelemetry.sendEvent', repoPath);
					}
				}
				return current?.sha ?? '';
			})().catch((ex: unknown) => {
				Logger.error(ex, 'CommitCreatedTelemetry.update', repoPath);
				return undefined;
			}),
		);
	}

	private async getNewestReflogEntry(repoPath: string): Promise<GitReflogEntry | undefined> {
		const svc = this.container.git.getRepositoryService(repoPath);
		try {
			const entries = await svc.refs.getReflogEntries?.('HEAD');
			return entries?.[0];
		} catch (ex) {
			// An unborn HEAD has no reflog yet, so the repository's first commit still counts
			if ((await svc.refs.validateReference('HEAD', { force: true })) == null) return undefined;

			throw ex;
		}
	}
}
