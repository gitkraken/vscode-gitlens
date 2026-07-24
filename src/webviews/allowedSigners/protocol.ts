import type { IpcScope } from '../ipc/models/ipc.js';
import { IpcNotification, IpcRequest } from '../ipc/models/ipc.js';
import type { WebviewState } from '../protocol.js';

export const scope: IpcScope = 'allowedSigners';

/** Where a candidate signer's key was discovered. */
export type SignerProvenance = 'commits' | 'provider' | 'both';

/** The connected git-host integration used to verify signers, for provider-icon display in the webview. */
export interface SignerProvider {
	/** The remote provider id, e.g. `github`. */
	id: string;
	/** The display name, e.g. `GitHub`. */
	name: string;
	/** The provider icon key, e.g. `github` — rendered as `gl-provider-${icon}` (glicons font). */
	icon: string;
}

export interface CandidateSigner {
	/** Stable id: `${email}\0${keyType}\0${keyData}`. */
	id: string;
	name?: string;
	email: string;
	avatarUrl?: string;
	keyType: string;
	/** The base64-encoded public-key blob (the part written after the key type in an allowed_signers line). */
	keyData: string;
	/** OpenSSH `SHA256:...` fingerprint, for display. */
	fingerprint: string;
	provenance: SignerProvenance;
	/** Number of commits in the repo signed by this key. */
	commitCount: number;
	/** Whether this entry is already present in the target allowed_signers file. */
	alreadyPresent: boolean;
}

/** Progress reported by the host while discovering signers, so the loading page can show what's happening. */
export interface LoadingProgress {
	message: string;
	/** Items processed so far in the current phase (e.g. commits scanned), when known. */
	current?: number;
	/** Total items in the current phase, when known. */
	total?: number;
	/** Signers discovered so far. */
	found?: number;
}

export interface State extends WebviewState<'gitlens.allowedSigners'> {
	webroot?: string;
	repoPath?: string;
	repoName?: string;
	/** Whether the host is still discovering signers; the webview shows the loading page until this is `false`. */
	loading: boolean;
	/** Whether provider verification is still running in the background after the commit-derived signers are shown. */
	verifying: boolean;
	/** A terminal error message if signer discovery failed; the webview shows this instead of an endless spinner. */
	error?: string;
	/** The current discovery step, shown on the loading page. */
	progress?: LoadingProgress;
	signers: CandidateSigner[];
	/** The path the file will be written to (default: existing config value, else `~/.ssh/allowed_signers`). */
	targetPath: string;
	/** The current value of `gpg.ssh.allowedSignersFile`, if set. */
	currentAllowedSignersFile?: string;
	/** Whether `gpg.ssh.allowedSignersFile` will be set globally or in the repo's local config. */
	setConfigScope: 'global' | 'local';
	/** Whether the webview is hosted in a Node.js (desktop) environment that can write files. */
	hasNodeHost: boolean;
	/** Whether a connected git-host integration was available to enrich/verify signers. */
	integrationConnected: boolean;
	/** The connected integration's provider, when one was available — used to render the provider indicator. */
	provider?: SignerProvider;
	/**
	 * The `SHA256:…` fingerprint of a specific signer to pre-check, set when the editor is opened from a commit's
	 * "Add to allowed signers…" action so that commit's signer is pre-selected. API-verified signers (provenance
	 * `provider`/`both`) are pre-checked regardless; everything else starts unchecked.
	 */
	preselectFingerprint?: string;
}

/** A single allowed_signers entry the user has chosen to write. */
export interface SaveEntry {
	email: string;
	keyType: string;
	keyData: string;
}

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
export const SaveRequest = new IpcRequest<SaveParams, SaveResult>(scope, 'save');

export interface BrowseTargetPathResult {
	path?: string;
}
export const BrowseTargetPathRequest = new IpcRequest<void, BrowseTargetPathResult>(scope, 'targetPath/browse');

export interface CheckPresenceParams {
	/** The allowed_signers file path to check the discovered signers against. */
	targetPath: string;
}
export interface CheckPresenceResult {
	/** The dedupe keys (matching `CandidateSigner.id`) of every entry already present in the file at `targetPath`. */
	keys: string[];
}
/** Re-derives which signers are already in the file when the user changes the target path. */
export const CheckPresenceRequest = new IpcRequest<CheckPresenceParams, CheckPresenceResult>(scope, 'presence/check');

// Notifications (host -> webview) streamed while discovering signers after the loading shell is shown.

export interface DidChangeProgressParams {
	progress: LoadingProgress;
}
export const DidChangeProgressNotification = new IpcNotification<DidChangeProgressParams>(scope, 'progress/didChange');

export interface DidChangeResultsParams {
	signers: CandidateSigner[];
	integrationConnected: boolean;
	/** The connected integration's provider, when one was available — used to render the provider indicator. */
	provider?: SignerProvider;
	/** Whether provider verification is still in progress (commit-derived signers are shown first). */
	verifying: boolean;
	/** Set when discovery failed; the webview leaves the loading/verifying state and surfaces this message. */
	error?: string;
}
export const DidChangeResultsNotification = new IpcNotification<DidChangeResultsParams>(scope, 'results/didChange');
