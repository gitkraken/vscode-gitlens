import type { Event, FileChangeEvent, FileStat, FileSystemProvider, FileType, Uri } from 'vscode';
import { Disposable, EventEmitter, FileSystemError, Uri as VscUri, workspace } from 'vscode';
import { isLinux } from '@env/platform.js';
import {
	decodeGitLensRevisionUriAuthority,
	encodeGitLensRevisionUriAuthority,
} from '@gitlens/git/utils/uriAuthority.js';
import { Logger } from '@gitlens/utils/logger.js';
import { Schemes } from '../constants.js';
import type { VirtualFileSystemService } from './virtualFileSystemService.js';

/** Authority payload encoded into a `gitlens-virtual://` URI. Identifiers only — never content. */
export interface VirtualUriAuthority {
	readonly namespace: string;
	readonly sessionId: string;
	readonly commitId: string;
	readonly repoPath: string;
}

export function encodeVirtualUri(authority: VirtualUriAuthority, path: string): Uri {
	return VscUri.from({
		scheme: Schemes.GitLensVirtual,
		authority: encodeGitLensRevisionUriAuthority(authority),
		path: path.startsWith('/') ? path : `/${path}`,
	});
}

export function decodeVirtualUri(uri: Uri): { authority: VirtualUriAuthority; path: string } {
	if (uri.scheme !== Schemes.GitLensVirtual) {
		throw new Error(`decodeVirtualUri: wrong scheme '${uri.scheme}'`);
	}
	const authority = decodeGitLensRevisionUriAuthority<VirtualUriAuthority>(uri.authority);
	// URI paths always start with '/'; strip for repo-relative path passed to providers.
	const path = uri.path.startsWith('/') ? uri.path.slice(1) : uri.path;
	return { authority: authority, path: path };
}

/**
 * Dispatching {@link FileSystemProvider} for the `gitlens-virtual://` scheme. Decodes each URI's
 * authority, looks up the registered {@link import('./virtualContentProvider.js').VirtualContentProvider}
 * by namespace, and forwards read operations. Read-only by design — virtual content is synthesized
 * from handler state, never written back.
 */
export class VirtualFileSystemProvider implements FileSystemProvider, Disposable {
	private readonly _onDidChangeFile = new EventEmitter<FileChangeEvent[]>();
	get onDidChangeFile(): Event<FileChangeEvent[]> {
		return this._onDidChangeFile.event;
	}

	private readonly _disposable: Disposable;

	constructor(private readonly service: VirtualFileSystemService) {
		this._disposable = Disposable.from(
			this._onDidChangeFile,
			workspace.registerFileSystemProvider(Schemes.GitLensVirtual, this, {
				isCaseSensitive: isLinux,
				isReadonly: true,
			}),
		);
	}

	dispose(): void {
		this._disposable.dispose();
	}

	/** Called by {@link VirtualFileSystemService} when a handler reports content changes. */
	fireDidChange(uris: readonly Uri[]): void {
		if (uris.length === 0) return;
		this._onDidChangeFile.fire(uris.map(uri => ({ type: 1 /* FileChangeType.Changed */, uri: uri })));
	}

	async readFile(uri: Uri): Promise<Uint8Array> {
		const { authority, path } = decodeVirtualUri(uri);
		const provider = this.service.getProvider(authority.namespace);
		if (provider == null) throw FileSystemError.FileNotFound(uri);

		try {
			return await provider.readFile(authority.sessionId, authority.commitId, path);
		} catch (ex) {
			Logger.error(ex, `VirtualFileSystemProvider.readFile('${uri.toString(true)}')`);
			throw FileSystemError.Unavailable(uri);
		}
	}

	async stat(uri: Uri): Promise<FileStat> {
		const { authority, path } = decodeVirtualUri(uri);
		const provider = this.service.getProvider(authority.namespace);
		if (provider == null) throw FileSystemError.FileNotFound(uri);

		try {
			return await provider.stat(authority.sessionId, authority.commitId, path);
		} catch (ex) {
			Logger.error(ex, `VirtualFileSystemProvider.stat('${uri.toString(true)}')`);
			throw FileSystemError.Unavailable(uri);
		}
	}

	readDirectory(): [string, FileType][] {
		return [];
	}

	watch(): Disposable {
		return Disposable.from();
	}

	copy?(source: Uri): void | Thenable<void> {
		throw FileSystemError.NoPermissions(source);
	}
	createDirectory(uri: Uri): void | Thenable<void> {
		throw FileSystemError.NoPermissions(uri);
	}
	delete(uri: Uri): void | Thenable<void> {
		throw FileSystemError.NoPermissions(uri);
	}
	rename(oldUri: Uri): void | Thenable<void> {
		throw FileSystemError.NoPermissions(oldUri);
	}
	writeFile(uri: Uri): void | Thenable<void> {
		throw FileSystemError.NoPermissions(uri);
	}
}
