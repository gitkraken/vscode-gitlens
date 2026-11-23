import type { CommitGraphRef } from '../contracts/rows.js';
import type { GraphMissingRefsMetadata, GraphRefMetadataType, GraphRefsMetadata } from '../contracts/state.js';

type MetadataRef = Pick<CommitGraphRef, 'kind' | 'id' | 'upstreamId'>;

export interface MissingRefsMetadataScan {
	readonly rows: readonly { readonly sha: string }[];
	readonly first: number;
	readonly last: number;
	readonly refsOf: (sha: string) => readonly MetadataRef[] | undefined;
	readonly types: readonly GraphRefMetadataType[];
	readonly metadata: GraphRefsMetadata | null | undefined;
	readonly requested: Map<string, Set<GraphRefMetadataType>>;
	readonly trackingLocalId: (remoteId: string) => string | undefined;
	readonly pullRequestRows?: readonly { readonly sha: string }[];
}

export function collectMissingRefsMetadata(scan: MissingRefsMetadataScan): GraphMissingRefsMetadata | undefined {
	const { rows, metadata, requested } = scan;

	let missing: GraphMissingRefsMetadata | undefined;
	const want = (id: string | undefined, type: GraphRefMetadataType): void => {
		if (id == null) return;

		const entry = metadata?.[id];
		if (entry != null && type in entry) return;

		let types = requested.get(id);
		if (types?.has(type)) return;

		if (types == null) {
			types = new Set();
			requested.set(id, types);
		}
		types.add(type);

		missing ??= {};
		(missing[id] ??= []).push(type);
	};

	for (let i = Math.max(0, scan.first), hi = Math.min(rows.length - 1, scan.last); i <= hi; i++) {
		const refs = scan.refsOf(rows[i].sha);
		if (refs == null) continue;

		for (const ref of refs) {
			if (ref.kind === 'tag') continue;

			for (const type of scan.types) {
				if (type !== 'upstream') {
					want(ref.id, type);
				} else if (ref.kind === 'head' && ref.upstreamId != null) {
					want(ref.id, 'upstream');
				} else if (ref.kind === 'remote' && ref.id != null) {
					// KEEP: ahead/behind is keyed on the tracking local's id, never on the remote's own.
					want(scan.trackingLocalId(ref.id), 'upstream');
				}
			}
		}
	}

	if (scan.pullRequestRows != null) {
		for (const row of scan.pullRequestRows) {
			const refs = scan.refsOf(row.sha);
			if (refs == null) continue;

			for (const ref of refs) {
				if (ref.kind !== 'tag') {
					want(ref.id, 'pullRequest');
				}
			}
		}
	}
	return missing;
}

export function rowShasForRefsMetadata(
	ids: Iterable<string>,
	refRowIndex: ReadonlyMap<string, { readonly sha: string }>,
	refsOf: (sha: string) => readonly MetadataRef[] | undefined,
): Set<string> {
	const shas = new Set<string>();
	for (const id of ids) {
		const sha = refRowIndex.get(id)?.sha;
		if (sha == null) continue;

		shas.add(sha);
		const upstreamId = refsOf(sha)?.find(ref => ref.id === id && ref.kind === 'head')?.upstreamId;
		const upstreamSha = upstreamId != null ? refRowIndex.get(upstreamId)?.sha : undefined;
		if (upstreamSha != null) {
			shas.add(upstreamSha);
		}
	}
	return shas;
}
