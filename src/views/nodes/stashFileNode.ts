import { GitFile, GitStashCommit } from '../../git/models';
import { RepositoriesView } from '../repositoriesView';
import { StashesView } from '../stashesView';
import { CommitFileNode } from './commitFileNode';
import { ContextValues, ViewNode } from './viewNode';

export class StashFileNode extends CommitFileNode<StashesView | RepositoriesView> {
	constructor(view: StashesView | RepositoriesView, parent: ViewNode, file: GitFile, commit: GitStashCommit) {
		super(view, parent, file, commit);
	}

	protected override get contextValue(): string {
		return `${ContextValues.File}+stashed`;
	}
}
