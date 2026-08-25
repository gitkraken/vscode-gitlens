/**
 * Standalone Allowed Signers RPC service.
 *
 * Carries the three host operations of the SSH Allowed Signers editor — saving the
 * allowed_signers file (and optionally pointing `gpg.ssh.allowedSignersFile` at it),
 * browsing for a target path, and checking which signers are already present in a
 * target file — plus the two save-last events streamed while signers are discovered.
 */

import { Uri, window, workspace } from 'vscode';
import { getHomeDir, isWeb } from '@env/platform.js';
import { isAbsolute } from '@gitlens/utils/path.js';
import type { Container } from '../../container.js';
import type { AllowedSignerEntry } from '../../git/utils/allowedSignersFile.js';
import { getExistingEntryKeys, mergeAllowedSigners } from '../../git/utils/allowedSignersFile.js';
import type { CandidateSigner, LoadingProgress, SaveEntry, SignerProvider } from '../allowedSigners/protocol.js';
import type { EventVisibilityBuffer, SubscriptionTracker } from './eventVisibilityBuffer.js';
import { createRpcEvent } from './eventVisibilityBuffer.js';
import type { SharedWebviewServices } from './services/common.js';
import type { RpcEventSubscription } from './services/types.js';

/** The entries to write, where to write them, and whether to update git config. */
export interface SaveParams {
	entries: SaveEntry[];
	targetPath: string;
	setConfig: boolean;
	scope: 'global' | 'local';
}

export interface SaveResult {
	written: boolean;
	configSet: boolean;
	/** Number of new entries actually added to the file (excludes ones already present). */
	added: number;
	error?: string;
}

/** A discovery snapshot — always complete, never a delta (the event is save-last buffered). */
export interface AllowedSignersResultsChangedEvent {
	signers: CandidateSigner[];
	integrationConnected: boolean;
	/** The connected integration's provider, when one was available — used to render the provider indicator. */
	provider?: SignerProvider;
	/** Whether provider verification is still in progress (commit-derived signers are shown first). */
	verifying: boolean;
	/** Set when discovery failed; the webview leaves the loading/verifying state and surfaces this message. */
	error?: string;
}

/**
 * The RPC-facing surface of {@link AllowedSignersService} — the shape the Allowed Signers
 * webview composes into its services interface (the class carries only private fire methods).
 */
export interface AllowedSignersViewService {
	/** Fired while signers are being discovered, so the loading page can show what's happening. */
	readonly onProgressChanged: RpcEventSubscription<LoadingProgress>;
	/** Fired with each discovery snapshot — commit-derived signers first, then provider-verified ones. */
	readonly onResultsChanged: RpcEventSubscription<AllowedSignersResultsChangedEvent>;

	/** Merges the chosen entries into the target file, creating it (and its folder) if needed. */
	save(params: SaveParams): Promise<SaveResult>;
	/** Opens a save dialog for the allowed_signers file location; `undefined` when cancelled. */
	browseTargetPath(): Promise<string | undefined>;
	/** The dedupe keys (matching `CandidateSigner.id`) of every entry already present in the file at `targetPath`. */
	checkPresence(targetPath: string): Promise<string[]>;
	/** Returns the most recent discovery results, if any — the subscribe-then-query seed so a
	 *  remounted webview escapes its (possibly stale) loading bootstrap even though discovery
	 *  runs once per controller and won't re-fire for it. */
	getResults(): Promise<AllowedSignersResultsChangedEvent | undefined>;
}

/** RPC services for the Allowed Signers webview. */
export interface AllowedSignersServices extends SharedWebviewServices {
	readonly allowedSigners: AllowedSignersViewService;
}

export class AllowedSignersService implements AllowedSignersViewService {
	private readonly container: Container;

	private readonly getRepoPath: () => string | undefined;

	readonly onProgressChanged: RpcEventSubscription<LoadingProgress>;

	readonly onResultsChanged: RpcEventSubscription<AllowedSignersResultsChangedEvent>;

	readonly #didProgressChanged = createRpcEvent<LoadingProgress>('progressChanged', 'save-last');
	readonly #didResultsChanged = createRpcEvent<AllowedSignersResultsChangedEvent>('resultsChanged', 'save-last');

	/** Latest discovery snapshot, kept for {@link AllowedSignersViewService.getResults}. */
	#results: AllowedSignersResultsChangedEvent | undefined;

	constructor(
		container: Container,
		getRepoPath: () => string | undefined,
		buffer: EventVisibilityBuffer | undefined,
		tracker?: SubscriptionTracker,
	) {
		this.container = container;
		this.getRepoPath = getRepoPath;

		this.onProgressChanged = this.#didProgressChanged.subscribe(buffer, tracker);
		this.onResultsChanged = this.#didResultsChanged.subscribe(buffer, tracker);
	}

	fireProgressChanged(progress: LoadingProgress): void {
		this.#didProgressChanged.fire(progress);
	}

	fireResultsChanged(event: AllowedSignersResultsChangedEvent): void {
		this.#results = event;
		this.#didResultsChanged.fire(event);
	}

	getResults(): Promise<AllowedSignersResultsChangedEvent | undefined> {
		return Promise.resolve(this.#results);
	}

	/** Drops the seed cache — called by the provider when its show context changes, so a stale
	 *  repository's results can't be served to the next webview generation. */
	clearResults(): void {
		this.#results = undefined;
	}
	async save(params: SaveParams): Promise<SaveResult> {
		if (isWeb) {
			return { written: false, configSet: false, added: 0, error: 'Writing files is not supported on the web.' };
		}

		try {
			const resolved = this.resolveTargetUri(params.targetPath);
			if (resolved == null) {
				return {
					written: false,
					configSet: false,
					added: 0,
					error: 'Choose an absolute file path (no repository is available to resolve a relative path).',
				};
			}

			const { uri, configPath } = resolved;

			let existing = '';
			try {
				existing = new TextDecoder().decode(await workspace.fs.readFile(uri));
			} catch {
				// File doesn't exist yet — start from empty content.
			}

			const entries: AllowedSignerEntry[] = params.entries.map(e => ({
				principal: e.email,
				keyType: e.keyType,
				keyData: e.keyData,
			}));

			const beforeCount = getExistingEntryKeys(existing).size;
			const merged = mergeAllowedSigners(existing, entries);
			const added = getExistingEntryKeys(merged).size - beforeCount;

			await workspace.fs.createDirectory(Uri.joinPath(uri, '..'));
			await workspace.fs.writeFile(uri, new TextEncoder().encode(merged));

			let configSet = false;
			const repoPath = this.getRepoPath();
			const svc = repoPath ? this.container.git.getRepositoryService(repoPath) : undefined;
			if (params.setConfig && svc?.config.setSigningConfig != null) {
				await svc.config.setSigningConfig(
					{ allowedSignersFile: configPath },
					{ global: params.scope === 'global' },
				);
				configSet = true;
			}

			return { written: true, configSet: configSet, added: added };
		} catch (ex) {
			return { written: false, configSet: false, added: 0, error: ex instanceof Error ? ex.message : String(ex) };
		}
	}

	async browseTargetPath(): Promise<string | undefined> {
		const uri = await window.showSaveDialog({
			title: 'Choose allowed_signers file location',
			saveLabel: 'Select',
		});
		return uri?.fsPath;
	}

	async checkPresence(targetPath: string): Promise<string[]> {
		const resolved = this.resolveTargetUri(targetPath);
		if (resolved == null) return [];

		try {
			const content = new TextDecoder().decode(await workspace.fs.readFile(resolved.uri));
			return [...getExistingEntryKeys(content)];
		} catch {
			// No file at that path (or unreadable) — nothing is present there yet.
			return [];
		}
	}

	/**
	 * Resolves a user-entered target path to a file `Uri` (and the value to record in git config). `expandHome` handles
	 * a leading `~`; a genuinely relative path is resolved against the repo root so the file we write and the path git
	 * records point at the same place (`Uri.file()` would otherwise anchor a relative path to the filesystem root, e.g.
	 * `/.git/allowed_signers`). Returns `undefined` when a relative path can't be resolved (no repository available).
	 */
	private resolveTargetUri(targetPath: string): { uri: Uri; configPath: string } | undefined {
		const expanded = expandHome(targetPath);
		// Preserve the raw value (incl. a portable leading `~`) for git config unless we had to resolve a relative path.
		if (isAbsolute(expanded)) return { uri: Uri.file(expanded), configPath: targetPath };

		const repoPath = this.getRepoPath();
		if (repoPath != null) {
			const uri = Uri.joinPath(Uri.file(repoPath), expanded);
			return { uri: uri, configPath: uri.fsPath };
		}

		return undefined;
	}
}

/** Expands a leading `~` to the user's home directory. No-op when home can't be determined (e.g. on the web). */
export function expandHome(path: string): string {
	if (!path.startsWith('~')) return path;

	const home = getHomeDir();
	return home ? `${home}${path.slice(1)}` : path;
}
