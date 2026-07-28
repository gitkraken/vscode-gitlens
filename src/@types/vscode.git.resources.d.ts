import type { SourceControlResourceState, Uri } from 'vscode';
import type { Status as ScmStatus } from '../@types/vscode.git.enums.ts';
import type { ScmResourceGroupType } from '../@types/vscode.git.resources.enums';

export interface ScmResource extends SourceControlResourceState {
	readonly resourceGroupType?: ScmResourceGroupType;
	readonly type?: ScmStatus;
	/** The pre-rename path. For a rename/copy `resourceUri` is the NEW path and this is the original;
	 *  for every other status the two are the same Uri. */
	readonly original?: Uri;
}
