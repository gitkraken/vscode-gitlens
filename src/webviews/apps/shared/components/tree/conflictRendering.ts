import type { GitFileConflictStatus } from '@gitlens/git/models/fileStatus.js';
import { pluralize } from '@gitlens/utils/string.js';
import type { TreeItemDecoration, TreeItemDecorationKind } from './base.js';

// Decodes Git's two-character unmerged status codes. The `U` placeholder is context-dependent:
// in `UA`/`AU` it means the side is absent; in `UD`/`DU`/`UU` it means the side has a modified version.
export function getConflictStatusInfo(
	status: GitFileConflictStatus,
	branchName?: string,
): { label: string; kind: TreeItemDecorationKind; description: string } | undefined {
	const branch = branchName ? `$(git-branch) ${branchName}` : 'incoming';

	switch (status) {
		case 'UU':
			return {
				label: 'Modified (Both)',
				kind: 'modified',
				description: `Modified on both ${branch} and the target`,
			};
		case 'AA':
			return {
				label: 'Added (Both)',
				kind: 'added',
				description: `Added on both ${branch} and the target`,
			};
		case 'DD':
			return {
				label: 'Deleted (Both)',
				kind: 'deleted',
				description: `Deleted on both ${branch} and the target`,
			};
		case 'AU':
			return {
				label: 'Added by Current',
				kind: 'added',
				description: `Added on the target (conflict with ${branch} — possible rename or directory/file clash)`,
			};
		case 'UA':
			return {
				label: 'Added by Incoming',
				kind: 'added',
				description: `Added on ${branch} (conflict with the target — possible rename or directory/file clash)`,
			};
		case 'UD':
			return {
				label: 'Modified (Current), Deleted (Incoming)',
				kind: 'deleted',
				description: `Deleted on ${branch}\nModified on the target`,
			};
		case 'DU':
			return {
				label: 'Deleted (Current), Modified (Incoming)',
				kind: 'deleted',
				description: `Modified on ${branch}\nDeleted on the target`,
			};
		default:
			return undefined;
	}
}

export function getConflictDecorations(
	conflictStatus: GitFileConflictStatus,
	conflictCount: number | undefined,
	branchName?: string,
): TreeItemDecoration[] | undefined {
	const info = getConflictStatusInfo(conflictStatus, branchName);
	const decorations: TreeItemDecoration[] = [];

	if (info != null) {
		decorations.push({
			type: 'text',
			label: conflictStatus,
			tooltip: info.description,
			kind: info.kind,
			position: 'after',
		});
		decorations.push({
			type: 'text',
			label: info.label,
			tooltip: info.label,
			kind: 'muted',
			position: 'before',
		});
	}

	if (conflictCount != null && conflictCount > 0) {
		decorations.push({
			type: 'conflict',
			label: pluralize('conflict', conflictCount),
			count: conflictCount,
			tooltip: pluralize('conflict', conflictCount),
			kind: info?.kind ?? 'modified',
			position: 'before',
		});
	}

	return decorations.length ? decorations : undefined;
}

export function getConflictTooltip(
	conflictStatus: GitFileConflictStatus,
	conflictCount: number | undefined,
	branchName?: string,
): string {
	const info = getConflictStatusInfo(conflictStatus, branchName);
	const parts: string[] = [];

	if (info != null) {
		parts.push(`**${info.label}** (${conflictStatus})`);
		parts.push(info.description);
	}

	if (conflictCount != null && conflictCount > 0) {
		parts.push(pluralize('conflict', conflictCount));
	}

	return parts.join('\n\n');
}
