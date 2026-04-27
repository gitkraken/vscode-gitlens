import type { Disposable, Uri } from 'vscode';
import type { GitFileChangeShape } from '@gitlens/git/models/fileChange.js';
import { shortenRevision } from '@gitlens/git/utils/revision.utils.js';
import { basename } from '@gitlens/utils/path.js';
import { GlyphChars } from '../constants.js';
import type { Container } from '../container.js';
import { GitUri } from '../git/gitUri.js';
import type { VirtualContentProvider, VirtualParent, VirtualRef } from './virtualContentProvider.js';
import type { VirtualUriAuthority } from './virtualFileSystemProvider.js';
import { encodeVirtualUri, VirtualFileSystemProvider } from './virtualFileSystemProvider.js';

/** A concrete ref that either lives in a virtual session or is a real git SHA. */
export type AnyRef =
	| { readonly kind: 'virtual'; readonly ref: VirtualRef }
	| { readonly kind: 'ref'; readonly repoPath: string; readonly sha: string };

export interface VirtualDiffArgs {
	readonly lhs: Uri;
	readonly rhs: Uri;
	readonly title: string;
}

/**
 * Host-side registry + URI factory for virtual content. Features register a {@link VirtualContentProvider}
 * per namespace; this service owns the single {@link VirtualFileSystemProvider} that dispatches reads,
 * builds URIs, and assembles diff arguments for `openDiffEditor` / `gitlens.diffWith`.
 */
export class VirtualFileSystemService implements Disposable {
	private readonly _providers = new Map<string, VirtualContentProvider>();
	private readonly _fs: VirtualFileSystemProvider;
	private readonly _subscriptions = new Map<string, Disposable>();

	constructor(_container: Container) {
		this._fs = new VirtualFileSystemProvider(this);
	}

	dispose(): void {
		for (const sub of this._subscriptions.values()) {
			sub.dispose();
		}
		this._subscriptions.clear();
		this._providers.clear();
		this._fs.dispose();
	}

	/**
	 * Register a content provider for its declared `namespace`. Throws if the namespace is already taken.
	 * The returned {@link Disposable} deregisters and unsubscribes from the provider's change event.
	 */
	registerProvider(provider: VirtualContentProvider): Disposable {
		const { namespace } = provider;
		if (this._providers.has(namespace)) {
			throw new Error(`VirtualFileSystemService: namespace '${namespace}' is already registered`);
		}
		this._providers.set(namespace, provider);

		const sub = provider.onDidChangeContent?.(e => {
			const paths = e.paths;
			if (paths == null || paths.length === 0) {
				// Provider signaled session-wide invalidation without enumerating paths.
				// Nothing to fire individually; open editors will re-stat on next focus.
				return;
			}
			const uris = paths.map(path =>
				encodeVirtualUri(
					{
						namespace: namespace,
						sessionId: e.sessionId,
						commitId: e.commitId ?? '',
						repoPath: provider.getRepoPath(e.sessionId, e.commitId ?? ''),
					},
					path,
				),
			);
			this._fs.fireDidChange(uris);
		});
		if (sub != null) {
			this._subscriptions.set(namespace, sub);
		}

		return {
			dispose: () => {
				this._subscriptions.get(namespace)?.dispose();
				this._subscriptions.delete(namespace);
				this._providers.delete(namespace);
			},
		};
	}

	getProvider(namespace: string): VirtualContentProvider | undefined {
		return this._providers.get(namespace);
	}

	/** Build a `gitlens-virtual://` URI for the given virtual ref + repo-relative path. */
	getUri(ref: VirtualRef, path: string): Uri {
		const provider = this.getProviderOrThrow(ref.namespace);
		const authority: VirtualUriAuthority = {
			namespace: ref.namespace,
			sessionId: ref.sessionId,
			commitId: ref.commitId,
			repoPath: provider.getRepoPath(ref.sessionId, ref.commitId),
		};
		return encodeVirtualUri(authority, path);
	}

	/**
	 * Resolves the ref's parent via the handler and returns diff args suitable for
	 * {@link openDiffEditor}. LHS is either another `gitlens-virtual://` URI (virtual parent) or a
	 * standard `gitlens://` URI (real-ref parent, resolved by the existing FS provider). Throws if the
	 * handler does not expose `getParent` or returns `undefined`.
	 */
	async getComparePreviousUris(ref: VirtualRef, file: GitFileChangeShape): Promise<VirtualDiffArgs> {
		const provider = this.getProviderOrThrow(ref.namespace);
		if (provider.getParent == null) {
			throw new Error(`VirtualFileSystemService: provider '${ref.namespace}' does not support getParent`);
		}

		const parent = await provider.getParent(ref.sessionId, ref.commitId);
		if (parent == null) {
			throw new Error(
				`VirtualFileSystemService: no parent for '${ref.namespace}/${ref.sessionId}/${ref.commitId}' — use buildDiffArgs with explicit sides`,
			);
		}

		const leftRef: AnyRef = virtualParentToAnyRef(parent, ref);
		const rightRef: AnyRef = { kind: 'virtual', ref: ref };
		return this.buildDiffArgs(leftRef, rightRef, file);
	}

	/** Pairwise-explicit diff argument builder. Either side may be virtual or a real git ref. */
	buildDiffArgs(leftRef: AnyRef, rightRef: AnyRef, file: GitFileChangeShape): VirtualDiffArgs {
		const lhsPath = file.originalPath ?? file.path;
		const rhsPath = file.path;
		const lhs = this.anyRefToUri(leftRef, lhsPath);
		const rhs = this.anyRefToUri(rightRef, rhsPath);
		const title = `${basename(rhsPath)} (${this.anyRefLabel(leftRef)} ${GlyphChars.ArrowLeftRightLong} ${this.anyRefLabel(
			rightRef,
		)})`;
		return { lhs: lhs, rhs: rhs, title: title };
	}

	private anyRefToUri(ref: AnyRef, path: string): Uri {
		if (ref.kind === 'virtual') return this.getUri(ref.ref, path);
		return GitUri.fromFile(path, ref.repoPath, ref.sha);
	}

	private anyRefLabel(ref: AnyRef): string {
		if (ref.kind === 'virtual') {
			const provider = this.getProviderOrThrow(ref.ref.namespace);
			return provider.getLabel(ref.ref.sessionId, ref.ref.commitId);
		}
		return shortenRevision(ref.sha);
	}

	private getProviderOrThrow(namespace: string): VirtualContentProvider {
		const provider = this._providers.get(namespace);
		if (provider == null) {
			throw new Error(`VirtualFileSystemService: no provider registered for namespace '${namespace}'`);
		}
		return provider;
	}
}

function virtualParentToAnyRef(parent: VirtualParent, fromRef: VirtualRef): AnyRef {
	if (parent.kind === 'virtual') {
		return {
			kind: 'virtual',
			ref: { namespace: fromRef.namespace, sessionId: fromRef.sessionId, commitId: parent.commitId },
		};
	}
	return { kind: 'ref', repoPath: parent.repoPath, sha: parent.sha };
}
