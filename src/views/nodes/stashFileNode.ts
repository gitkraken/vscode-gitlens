import type { GitStashCommit } from 'src/git/models/commit';
import type { GitFile } from 'src/git/models/file';
import type { RepositoriesView } from '../repositoriesView';
import type { StashesView } from '../stashesView';
import { CommitFileNode } from './commitFileNode';
import type { ViewNode } from './viewNode';
import { ContextValues } from './viewNode';

export class StashFileNode extends CommitFileNode<StashesView | RepositoriesView> {
	constructor(view: StashesView | RepositoriesView, parent: ViewNode, file: GitFile, commit: GitStashCommit) {
		super(view, parent, file, commit);
	}

	protected override get contextValue(): string {
		return `${ContextValues.File}+stashed`;
	}
}
