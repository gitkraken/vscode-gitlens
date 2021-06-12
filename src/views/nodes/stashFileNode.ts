'use strict';
import { GitFile, GitLogCommit } from '../../git/git';
import { RepositoriesView } from '../repositoriesView';
import { StashesView } from '../stashesView';
import { CommitFileNode } from './commitFileNode';
import { ContextValues, ViewNode } from './viewNode';

export class StashFileNode extends CommitFileNode<StashesView | RepositoriesView> {
	constructor(view: StashesView | RepositoriesView, parent: ViewNode, file: GitFile, commit: GitLogCommit) {
		super(view, parent, file, commit);
	}

	protected override get contextValue(): string {
		return `${ContextValues.File}+stashed`;
	}
}
