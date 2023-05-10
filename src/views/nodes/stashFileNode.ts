import type { GitStashCommit } from '../../git/models/commit';
import type { GitFile } from '../../git/models/file';
import type { StashesView } from '../stashesView';
import type { ViewsWithCommits } from '../viewBase';
import { CommitFileNode } from './commitFileNode';
import type { ViewNode } from './viewNode';
import { ContextValues } from './viewNode';

export class StashFileNode extends CommitFileNode {
	// eslint-disable-next-line @typescript-eslint/no-useless-constructor
	constructor(view: ViewsWithCommits | StashesView, parent: ViewNode, file: GitFile, commit: GitStashCommit) {
		super(view, parent, file, commit);
	}

	protected override get contextValue(): string {
		return `${ContextValues.File}+stashed`;
	}
}
