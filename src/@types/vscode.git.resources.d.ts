import { Status as ScmStatus } from '../@types/vscode.git.d.ts';
import { ScmResourceGroupType } from '../@types/vscode.git.resources.enums';

export interface ScmResource extends SourceControlResourceState {
	readonly resourceGroupType?: ScmResourceGroupType;
	readonly type?: ScmStatus;
}
