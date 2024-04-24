import type { SourceControlResourceState } from 'vscode';
import type { Status as ScmStatus } from '../@types/vscode.git.enums.ts';
import type { ScmResourceGroupType } from '../@types/vscode.git.resources.enums';

export interface ScmResource extends SourceControlResourceState {
	readonly resourceGroupType?: ScmResourceGroupType;
	readonly type?: ScmStatus;
}
