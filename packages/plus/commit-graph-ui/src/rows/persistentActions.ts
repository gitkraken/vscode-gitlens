import type { ProcessedGraphRow } from '@gitkraken/commit-graph/engine/types.js';
import type { ZoneSpec } from '@gitkraken/commit-graph/zones.js';
import type { GraphBuiltInRowAction, GraphRowAction } from '../contracts/contributions.js';

export interface PersistentRowActionsInput {
	kind: ProcessedGraphRow['kind'];
	wipActions?: readonly GraphRowAction[];
	isUnpushed?: boolean;
	isUnpulled?: boolean;
	supportedRowActions?: readonly GraphBuiltInRowAction[];
}

export function supportsRowAction(
	supportedRowActions: readonly GraphBuiltInRowAction[] | undefined,
	action: GraphBuiltInRowAction,
): boolean {
	return supportedRowActions == null || supportedRowActions.includes(action);
}

export function persistentRowActionCount({
	kind,
	wipActions,
	isUnpushed,
	isUnpulled,
	supportedRowActions,
}: PersistentRowActionsInput): number {
	if (kind === 'workdir') {
		if (wipActions == null) return 0;

		let count = 0;
		for (const action of wipActions) {
			if (action.persistent) {
				count++;
			}
		}
		return count;
	}
	if (kind === 'stash') return 0;

	let count = 0;
	if (isUnpushed === true && supportsRowAction(supportedRowActions, 'push-to-commit')) {
		count++;
	}
	if (isUnpulled === true) {
		count++;
	}
	return count;
}

export function hasPersistentRowActions(input: PersistentRowActionsInput): boolean {
	return persistentRowActionCount(input) > 0;
}

export function isZoneCellSuppressed(
	zone: ZoneSpec,
	zoneIndex: number,
	suppressFromIndex: number,
	hostsGutter: boolean,
	hostsRefs: boolean,
): boolean {
	return (
		zoneIndex >= suppressFromIndex &&
		!hostsGutter &&
		!hostsRefs &&
		(zone.id === 'author' || zone.id === 'datetime' || zone.id === 'sha' || zone.id === 'changes')
	);
}

export function lastVisibleZoneIndex(
	zones: readonly ZoneSpec[],
	suppressFromIndex: number,
	gutterHostIndex: number,
	refsHostId: string | undefined,
	graphColumnSplice: number,
): number {
	for (let i = zones.length - 1; i >= 0; i--) {
		const zone = zones[i];
		const hostsRefs = refsHostId != null ? zone.id === refsHostId : i === 0;
		if (isZoneCellSuppressed(zone, i, suppressFromIndex, i === gutterHostIndex, hostsRefs)) continue;

		return graphColumnSplice > i ? -1 : i;
	}
	return -1;
}
