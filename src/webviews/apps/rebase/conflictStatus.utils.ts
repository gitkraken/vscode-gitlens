import type { GitFileConflictStatus } from '@gitlens/git/models/fileStatus.js';
import type { ConflictFileWebviewContext } from '../../rebase/protocol.js';
import type { TreeItemAction } from '../shared/components/tree/base.js';

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
