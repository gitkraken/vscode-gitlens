import type { GitFileConflictStatus } from '@gitlens/git/models/fileStatus.js';
import type { ConflictFileWebviewContext } from '../../rebase/protocol.js';
import type { TreeItemAction } from '../shared/components/tree/base.js';

export const conflictColors = {
	added: 'var(--vscode-gitDecoration-addedResourceForeground)',
	deleted: 'var(--vscode-gitDecoration-deletedResourceForeground)',
	modified: 'var(--vscode-gitDecoration-modifiedResourceForeground)',
};

// Decodes Git's two-character unmerged status codes. The `U` placeholder is context-dependent:
// in `UA`/`AU` it means the side is absent; in `UD`/`DU`/`UU` it means the side has a modified version.
export function getConflictStatusInfo(
	status: GitFileConflictStatus,
	branchName?: string,
): { label: string; color: string; description: string } {
	const branch = branchName ? `$(git-branch) ${branchName}` : 'incoming';

	switch (status) {
		case 'UU':
			return {
				label: 'Modified (Both)',
				color: conflictColors.modified,
				description: `Modified on both ${branch} and the target`,
			};
		case 'AA':
			return {
				label: 'Added (Both)',
				color: conflictColors.added,
				description: `Added on both ${branch} and the target`,
			};
		case 'DD':
			return {
				label: 'Deleted (Both)',
				color: conflictColors.deleted,
				description: `Deleted on both ${branch} and the target`,
			};
		case 'AU':
			return {
				label: 'Added by Current',
				color: conflictColors.added,
				description: `Added on the target (conflict with ${branch} — possible rename or directory/file clash)`,
			};
		case 'UA':
			return {
				label: 'Added by Incoming',
				color: conflictColors.added,
				description: `Added on ${branch} (conflict with the target — possible rename or directory/file clash)`,
			};
		case 'UD':
			return {
				label: 'Modified (Current), Deleted (Incoming)',
				color: conflictColors.deleted,
				description: `Deleted on ${branch}\nModified on the target`,
			};
		case 'DU':
			return {
				label: 'Deleted (Current), Modified (Incoming)',
				color: conflictColors.deleted,
				description: `Modified on ${branch}\nDeleted on the target`,
			};
	}
}

export function getConflictFileActions(_conflictStatus: GitFileConflictStatus): TreeItemAction[] {
	return [
		{ icon: 'gl-diff-left', label: 'Open Current Changes', action: 'current-changes' },
		{ icon: 'gl-diff-right', label: 'Open Incoming Changes', action: 'incoming-changes' },
		{ icon: 'add', label: 'Stage', action: 'stage' },
	];
}

// Stage Current is invalid when the current side has no content to take (added/deleted only by them, or both deleted)
export function canStageCurrent(conflictStatus: GitFileConflictStatus): boolean {
	return conflictStatus !== 'UA' && conflictStatus !== 'DD';
}

// Stage Incoming is invalid when the incoming side has no content to take (added/deleted only by us, or both deleted)
export function canStageIncoming(conflictStatus: GitFileConflictStatus): boolean {
	return conflictStatus !== 'AU' && conflictStatus !== 'DD';
}

export function getConflictFileContextData(path: string, conflictStatus: GitFileConflictStatus): string {
	const modifiers: string[] = [];
	if (canStageCurrent(conflictStatus)) {
		modifiers.push('+canStageCurrent');
	}
	if (canStageIncoming(conflictStatus)) {
		modifiers.push('+canStageIncoming');
	}

	const context: ConflictFileWebviewContext = {
		webviewItem: `gitlens:rebase:conflict+file${modifiers.join('')}`,
		webviewItemValue: { type: 'rebaseConflict', path: path, conflictStatus: conflictStatus },
	};
	return JSON.stringify(context);
}
