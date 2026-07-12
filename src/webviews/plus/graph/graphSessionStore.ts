import type { Uri } from 'vscode';
import { FileSystemError, Uri as VUri, workspace } from 'vscode';
import type { GitGraphSessionSnapshot } from '@gitlens/git/models/graphSession.js';
import type { GitDir } from '@gitlens/git/models/repository.js';
import { uuid } from '@gitlens/utils/crypto.js';
import type { Deferrable } from '@gitlens/utils/debounce.js';
import { debounce } from '@gitlens/utils/debounce.js';
import { fnv1aHash64 } from '@gitlens/utils/hash.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { Container } from '../../../container.js';
import { configuration } from '../../../system/-webview/configuration.js';

// Tens-of-seconds idle debounce: a live session refreshes/pages far more often than we need to persist, and
// stale-on-disk is fine (restore always re-refreshes against git). A final write lands on provider dispose.
const persistDebounceMs = 30_000;

// Runs at most once per extension session across every store instance (view + editor share it).
let legacyStorageSwept = false;

/**
 * Result of reading a persisted graph-session snapshot: the parsed snapshot, the `corrupt` sentinel (a file
 * existed but was unreadable/unparseable — a restore ATTEMPT that misses), or `undefined` (no file at all —
 * not an attempt, so the host logs nothing).
 */
export type GraphSessionSnapshotReadResult = { readonly snapshot: GitGraphSessionSnapshot } | 'corrupt' | undefined;

/**
 * Maps a repo's resolved {@link GitDir} + worktree root path to its snapshot cache location. Pure so the
 * worktree→(common dir + key) mapping is unit-testable without touching the filesystem.
 *
 * The snapshot is a REPO-DERIVED CACHE, so it lives under `gitlens/` in the repo's COMMON git dir — the same
 * place git keeps its own derived data (e.g. the commit-graph). Git ignores unknown subdirs there, it dies
 * with the repo, and it never syncs — costing workspace storage nothing. Worktrees share a common git dir, so
 * the file is keyed by a stable hash of the worktree root path to give each its own file (the main worktree
 * gets a stable key the same way).
 */
export function getGraphSessionSnapshotUris(gitDir: GitDir, worktreeRootPath: string): { dir: Uri; file: Uri } {
	const commonUri = gitDir.commonUri ?? gitDir.uri;
	const dir = VUri.joinPath(commonUri, 'gitlens', 'graph');
	// A hash collision only mis-keys a cache whose `repoPath` the restore then rejects (a clean miss → full
	// walk), so it's never a correctness risk.
	return { dir: dir, file: VUri.joinPath(dir, `session-${fnv1aHash64(worktreeRootPath)}.json`) };
}

/**
 * Host-side restart-persistence IO for {@link GitGraphSession}: reads/writes a per-worktree snapshot file so a
 * cold graph open can restore its prior window instead of a full re-walk.
 *
 * Storage medium — a JSON file under the repo's git dir (see {@link getGraphSessionSnapshotUris}), NOT a
 * `Memento`: a graph window is MB-class JSON (thousands of rows + a reachability table), which belongs in a
 * file, not VS Code's SQLite-backed Memento (small key/values; the `Storage` service traces writes over 250ms
 * as slow). The store stays dumb IO glue — all snapshot validation lives in the provider's restore path; writes
 * are best-effort (cache, never load-bearing) and their failures are swallowed with a debug log.
 */
export class GraphSessionStore {
	private _getSnapshot: (() => GitGraphSessionSnapshot | undefined) | undefined;
	private readonly _flushDebounced: Deferrable<() => void>;

	constructor(private readonly container: Container) {
		this._flushDebounced = debounce(() => this.flushNow(), persistDebounceMs);
		this.sweepLegacyStorage();
	}

	/**
	 * Opt-in gate (`gitlens.graph.experimental.persistSession`, default off). Read LIVE on every read/write
	 * so a mid-session toggle takes effect immediately. When off the store is fully inert — no reads, no
	 * writes — but it NEVER deletes an existing cache, so toggling off temporarily preserves it. The legacy
	 * workspace-storage sweep is deliberately NOT gated (it removes the OLD location regardless).
	 */
	private get enabled(): boolean {
		return configuration.get('graph.experimental.persistSession') === true;
	}

	dispose(): void {
		// Best-effort final write of any pending snapshot (deactivate-time writes are unreliable, so this is a
		// convenience, not a guarantee — the debounced writes are the real persistence).
		this.flush();
		this._flushDebounced.cancel();
		this._getSnapshot = undefined;
	}

	/**
	 * Resolve a repo's snapshot cache uris via its git dir, or `undefined` when persistence must be skipped:
	 * the gitDir resolve failed, or it isn't a local repo with a real (file-scheme) git dir (virtual /
	 * GitHub-backed). Cached by the config provider, so this is cheap after the first call.
	 */
	private async resolveUris(repoPath: string): Promise<{ dir: Uri; file: Uri } | undefined> {
		let gitDir: GitDir | undefined;
		try {
			gitDir = await this.container.git.getRepositoryService(repoPath).config.getGitDir?.();
		} catch (ex) {
			Logger.debug(`GraphSessionStore: gitDir resolve failed for ${repoPath}; ${String(ex)}`);
			return undefined;
		}
		if (gitDir == null) return undefined;

		// Only local repos with a real, writable git dir — skip virtual / GitHub-backed (non-file scheme).
		if ((gitDir.commonUri ?? gitDir.uri).scheme !== 'file') return undefined;

		return getGraphSessionSnapshotUris(gitDir, repoPath);
	}

	/** Read a repo's persisted snapshot. Never throws — a corrupt/unreadable cache degrades to a full walk.
	 *  Returns `undefined` (no restore attempt, no log) when persistence is disabled. */
	async read(repoPath: string): Promise<GraphSessionSnapshotReadResult> {
		if (!this.enabled) return undefined;

		const uris = await this.resolveUris(repoPath);
		if (uris == null) return undefined;

		let bytes: Uint8Array;
		try {
			bytes = await workspace.fs.readFile(uris.file);
		} catch (ex) {
			// No file = cold first open (not a restore attempt); any other read error = present-but-unreadable.
			if (ex instanceof FileSystemError && (ex.code === 'FileNotFound' || ex.code === 'EntryNotFound')) {
				return undefined;
			}

			Logger.debug(`GraphSessionStore.read: unreadable snapshot for ${repoPath}; ${String(ex)}`);
			return 'corrupt';
		}

		try {
			return { snapshot: JSON.parse(new TextDecoder().decode(bytes)) as GitGraphSessionSnapshot };
		} catch (ex) {
			Logger.debug(`GraphSessionStore.read: corrupt snapshot JSON for ${repoPath}; ${String(ex)}`);
			return 'corrupt';
		}
	}

	/**
	 * Schedule a debounced write of the session's latest snapshot. `getSnapshot` is re-evaluated at flush time
	 * (not now) so the freshest accumulated window is persisted and bursts of refreshes/pages coalesce into one
	 * write; an `undefined` snapshot at flush time skips the write.
	 */
	schedule(getSnapshot: () => GitGraphSessionSnapshot | undefined): void {
		// Persistence off → don't arm the write (checked again at flush time so a toggle mid-debounce still skips).
		if (!this.enabled) return;

		this._getSnapshot = getSnapshot;
		this._flushDebounced();
	}

	/** Force any pending scheduled write to run now (repo swap / dispose). */
	flush(): void {
		if (!this._flushDebounced.pending()) return;

		this._flushDebounced.cancel();
		this.flushNow();
	}

	private flushNow(): void {
		// Re-check LIVE at write time: a pending write armed while enabled must not fire after a toggle-off.
		if (!this.enabled) return;

		const snapshot = this._getSnapshot?.();
		if (snapshot != null) {
			// Stringify SYNCHRONOUSLY, in the same turn as `serialize()`: the snapshot holds the live window's
			// row objects by reference, and a fast-path refresh mutates reused rows in place (flags/
			// reachabilityIndex) — a stringify deferred past an await could serialize gen-N+1 row fields
			// against gen-N tips/reachability (a torn snapshot; the restore would discard or heal it, but
			// there's no reason to ever write one).
			void this.write(snapshot.repoPath, JSON.stringify(snapshot));
		}
	}

	private async write(repoPath: string, json: string): Promise<void> {
		const uris = await this.resolveUris(repoPath);
		if (uris == null) return;

		// Atomic write: encode to a sibling temp file, then rename over the target. A crash/partial write can't
		// leave a truncated (corrupt) snapshot in place — a reader sees either the old file or the whole new one.
		const tmp = uris.file.with({ path: `${uris.file.path}.tmp-${uuid()}` });
		try {
			await workspace.fs.createDirectory(uris.dir);
			await workspace.fs.writeFile(tmp, new TextEncoder().encode(json));
			await workspace.fs.rename(tmp, uris.file, { overwrite: true });
		} catch (ex) {
			Logger.debug(`GraphSessionStore.write: failed for ${repoPath}; ${String(ex)}`);
			// Best-effort cleanup of the temp if the write/rename failed partway.
			try {
				await workspace.fs.delete(tmp, { useTrash: false });
			} catch {
				// Ignore — the temp most likely never got created.
			}
		}
	}

	/**
	 * One best-effort, once-per-session cleanup of the legacy workspace-storage snapshot dir (snapshots now
	 * live in the repo's git dir). Old snapshots aren't migrated — they rebuild naturally on the next walk.
	 */
	private sweepLegacyStorage(): void {
		if (legacyStorageSwept) return;

		legacyStorageSwept = true;

		const storageUri = this.container.context.storageUri;
		if (storageUri == null) return;

		const legacyUri = VUri.joinPath(storageUri, 'graph', 'sessions');
		void (async () => {
			try {
				await workspace.fs.delete(legacyUri, { recursive: true, useTrash: false });
				Logger.debug(`GraphSessionStore: removed legacy snapshot dir ${legacyUri.fsPath}`);
			} catch {
				// Best-effort — the dir most likely never existed on this workspace.
			}
		})();
	}
}
