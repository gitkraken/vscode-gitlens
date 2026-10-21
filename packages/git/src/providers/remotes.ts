import type { GitRemote } from '../models/remote.js';
import type { RemoteProvider } from '../models/remoteProvider.js';

/**
 * Why {@link GitRemotesSubProvider.probeRemote} couldn't reach a remote. `authRequired` also covers hosts
 * (e.g. GitHub) that answer a missing repository with an authentication challenge rather than a 404.
 * `hostKeyUnverified` means an SSH host isn't in known_hosts yet — the probe can't prompt to trust it.
 */
export type GitRemoteProbeFailureReason =
	| 'hostNotFound'
	| 'hostKeyUnverified'
	| 'notFound'
	| 'authRequired'
	| 'timeout'
	| 'other';

export type GitRemoteProbeResult =
	| { reachable: true }
	| { reachable: false; reason: GitRemoteProbeFailureReason; message?: string };

export interface GitRemotesSubProvider {
	getRemote(repoPath: string | undefined, name: string, cancellation?: AbortSignal): Promise<GitRemote | undefined>;
	getRemotes(
		repoPath: string | undefined,
		options?: { filter?: (remote: GitRemote) => boolean; sort?: boolean },
		cancellation?: AbortSignal,
	): Promise<GitRemote[]>;

	getDefaultRemote(repoPath: string, cancellation?: AbortSignal): Promise<GitRemote | undefined>;
	getRemotesWithProviders(
		repoPath: string,
		options?: { sort?: boolean },
		cancellation?: AbortSignal,
	): Promise<GitRemote<RemoteProvider>[]>;
	getBestRemoteWithProvider(
		repoPath: string,
		cancellation?: AbortSignal,
	): Promise<GitRemote<RemoteProvider> | undefined>;
	getBestRemotesWithProviders(repoPath: string, cancellation?: AbortSignal): Promise<GitRemote<RemoteProvider>[]>;
	addRemote?(repoPath: string, name: string, url: string, options?: { fetch?: boolean }): Promise<void>;
	addRemoteWithResult?(
		repoPath: string,
		name: string,
		url: string,
		options?: { fetch?: boolean },
	): Promise<GitRemote | undefined>;
	/**
	 * Checks whether `url` answers as a git remote, without prompting for credentials, within a few seconds.
	 * Not configured as a remote; nothing is written to the repository.
	 */
	probeRemote?(repoPath: string, url: string, cancellation?: AbortSignal): Promise<GitRemoteProbeResult>;
	pruneRemote?(repoPath: string, name: string): Promise<void>;
	removeRemote?(repoPath: string, name: string): Promise<void>;
	setRemoteAsDefault(repoPath: string, name: string, value?: boolean): Promise<void>;
}
