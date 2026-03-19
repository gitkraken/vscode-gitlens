import type { GitRemote } from '../models/remote.js';
import type { RemoteProvider } from '../models/remoteProvider.js';

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
	pruneRemote?(repoPath: string, name: string): Promise<void>;
	removeRemote?(repoPath: string, name: string): Promise<void>;
	setRemoteAsDefault(repoPath: string, name: string, value?: boolean): Promise<void>;
}
