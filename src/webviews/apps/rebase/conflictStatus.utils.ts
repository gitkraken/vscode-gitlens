import type { GitFileConflictStatus } from '@gitlens/git/models/fileStatus.js';
import { canStageCurrent, canStageIncoming } from '@gitlens/git/utils/conflictResolution.utils.js';
import type { ConflictFileWebviewContext } from '../../rebase/protocol.js';
import type { TreeItemAction } from '../shared/components/tree/base.js';

export function getConflictFileActions(_conflictStatus: GitFileConflictStatus): TreeItemAction[] {
	return [
		{ icon: 'gl-diff-left', label: 'Open Current Changes', action: 'current-changes' },
		{ icon: 'gl-diff-right', label: 'Open Incoming Changes', action: 'incoming-changes' },
		{ icon: 'add', label: 'Stage', action: 'stage' },
	];
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
