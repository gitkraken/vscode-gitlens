import type { GitStashCommit } from '../../git/models/commit';
import type { GitFile } from '../../git/models/file';
import type { ViewsWithStashes } from '../viewBase';
import { CommitFileNode } from './commitFileNode';
import type { ViewNode } from './viewNode';
import { ContextValues } from './viewNode';

export class StashFileNode extends CommitFileNode<ViewsWithStashes> {
	// eslint-disable-next-line @typescript-eslint/no-useless-constructor
	constructor(view: ViewsWithStashes, parent: ViewNode, file: GitFile, commit: GitStashCommit) {
		super(view, parent, file, commit);
	}

	protected override get contextValue(): string {
		return `${ContextValues.File}+stashed`;
	}
}
