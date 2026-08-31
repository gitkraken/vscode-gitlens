import type { ZoneId, ZoneSpec } from '@gitkraken/commit-graph/view.js';
import { defaultZones } from '@gitkraken/commit-graph/view.js';
import type { CommitGraphRef, CommitGraphView } from './contracts/rows.js';
import type {
	GraphColumnsConfig,
	GraphColumnsSettings,
	GraphDownstreams,
	GraphExcludeRefs,
	GraphExcludeTypes,
} from './contracts/state.js';
import { getExcludedRemotes, refPillKey } from './refs.js';

export type GraphCommitRef = CommitGraphRef;
export type GraphCommitView = CommitGraphView;

function excludeKindKey(kind: GraphCommitRef['kind']): keyof GraphExcludeTypes {
	return kind === 'head' ? 'heads' : kind === 'remote' ? 'remotes' : 'tags';
}

function downstreamKey(ref: Pick<GraphCommitRef, 'owner' | 'name'>): string {
	return `${ref.owner ?? ''}/${ref.name}`;
}

export function isTrackedUpstream(ref: GraphCommitRef, downstreams: GraphDownstreams | undefined): boolean {
	return ref.kind === 'remote' && (downstreams?.[downstreamKey(ref)]?.length ?? 0) > 0;
}

export function isRefHidden(
	ref: GraphCommitRef,
	excludeTypes: GraphExcludeTypes | undefined,
	excludeRefs: GraphExcludeRefs | undefined,
	downstreams?: GraphDownstreams,
): boolean {
	if (ref.kind === 'head' && ref.current) return false;
	if (ref.id != null && excludeRefs?.[ref.id] != null) return true;
	if (ref.kind === 'remote' && ref.owner != null) {
		const excludedRemote = getExcludedRemotes(excludeRefs)?.get(ref.owner);
		if (excludedRemote != null && (ref.id == null || !excludedRemote.exceptIds.has(ref.id))) return true;
	}
	if (excludeTypes?.[excludeKindKey(ref.kind)] !== true) return false;

	return ref.kind !== 'remote' || !isTrackedUpstream(ref, downstreams);
}

function remoteFullName(ref: GraphCommitRef): string {
	return ref.owner != null ? `${ref.owner}/${ref.name}` : ref.name;
}

export function isUpstreamRemoteOf(remote: GraphCommitRef, head: GraphCommitRef | undefined): boolean {
	if (head == null || remote.kind !== 'remote' || head.kind !== 'head') return false;
	if (head.upstreamId != null && remote.id != null) return head.upstreamId === remote.id;
	if (head.upstreamName != null) {
		return head.upstreamName === remoteFullName(remote) || head.upstreamName === remote.name;
	}

	return head.upstreamId == null && remote.name === head.name;
}

export interface RowRefOrder {
	pinnedRefId?: string;
	findHitRefKey?: string;
	currentUpstreamName?: string;
}

function carrierFor(refs: readonly GraphCommitRef[], matched: GraphCommitRef | undefined): GraphCommitRef | undefined {
	if (matched?.kind !== 'remote') return matched;

	return refs.find(ref => ref.kind === 'head' && isUpstreamRemoteOf(matched, ref)) ?? matched;
}

export function sortRowRefs(refs: readonly GraphCommitRef[], order?: RowRefOrder): GraphCommitRef[] {
	if (refs.length < 2) return refs.slice();

	const currentHead = refs.find(ref => ref.kind === 'head' && ref.current);
	const worktreeHeads = refs.filter(ref => ref.kind === 'head' && ref.secondaryWorktreeId != null);
	const findHit =
		order?.findHitRefKey != null ? refs.find(ref => refPillKey(ref) === order.findHitRefKey) : undefined;
	const findHitCarrier = carrierFor(refs, findHit);
	const edgePinned = order?.pinnedRefId != null ? refs.find(ref => ref.id === order.pinnedRefId) : undefined;
	const edgePinCarrier = carrierFor(refs, edgePinned);
	const tier = (ref: GraphCommitRef): number => {
		if (findHitCarrier != null && ref === findHitCarrier) return 0;
		if (ref.kind === 'head' && ref.current) return 1;
		if (edgePinCarrier != null && ref === edgePinCarrier) return 2;
		if (ref.kind === 'head') {
			if (ref.secondaryWorktreeId != null) return 4;
			if (ref.isDefault) return 6;
			return 7;
		}
		if (ref.kind === 'remote') {
			if (isUpstreamRemoteOf(ref, currentHead)) return 3;
			if (order?.currentUpstreamName != null && remoteFullName(ref) === order.currentUpstreamName) return 3;
			if (worktreeHeads.some(head => isUpstreamRemoteOf(ref, head))) return 5;
			if (ref.isDefault) return 6;
			return 8;
		}

		return 9;
	};

	return refs.toSorted(
		(a, b) =>
			tier(a) - tier(b) ||
			a.name.localeCompare(b.name, undefined, { numeric: true }) ||
			(a.owner ?? '').localeCompare(b.owner ?? ''),
	);
}

export function pickGhostRef(
	refs: readonly GraphCommitRef[] | undefined,
	excludeTypes: GraphExcludeTypes | undefined,
	excludeRefs: GraphExcludeRefs | undefined,
	downstreams: GraphDownstreams | undefined,
	order?: RowRefOrder,
): GraphCommitRef | undefined {
	if (refs == null || refs.length === 0) return undefined;

	const visible = refs.filter(ref => !isRefHidden(ref, excludeTypes, excludeRefs, downstreams));
	return visible.length === 0 ? undefined : sortRowRefs(visible, order)[0];
}

export function columnsToZones(columns: GraphColumnsSettings | undefined): readonly ZoneSpec[] | undefined {
	if (columns == null || Object.keys(columns).length === 0) return undefined;

	const defaultsById = new Map<ZoneId, ZoneSpec>(defaultZones.map(zone => [zone.id, zone]));
	const output: ZoneSpec[] = [];
	for (const [name, column] of Object.entries(columns)) {
		const defaults = defaultsById.get(name as ZoneId);
		if (defaults == null) continue;

		output.push({
			...defaults,
			width: typeof column.width === 'number' && column.width > 0 ? column.width : defaults.width,
			hidden: column.isHidden === true,
			mode: column.mode ?? defaults.mode,
		});
	}
	const columnMap = columns as Record<string, { order?: number } | undefined>;
	output.sort((a, b) => (columnMap[a.id]?.order ?? 0) - (columnMap[b.id]?.order ?? 0));
	return output;
}

export function zonesToColumnsConfig(zones: readonly ZoneSpec[]): GraphColumnsConfig {
	const output: GraphColumnsConfig = {};
	for (let i = 0; i < zones.length; i++) {
		const zone = zones[i];
		output[zone.id] = {
			width: zone.width,
			isHidden: zone.hidden,
			mode: zone.mode,
			order: i,
		};
	}
	return output;
}
