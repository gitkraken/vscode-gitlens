import type { GitStashCommit } from '../../git/models/commit';
import type { GitFile } from '../../git/models/file';
import type { ViewsWithStashes } from '../viewBase';
import type { ViewNode } from './abstract/viewNode';
import { ContextValues } from './abstract/viewNode';
import { CommitFileNodeBase } from './commitFileNode';

export class StashFileNode extends CommitFileNodeBase<'stash-file', ViewsWithStashes> {
	constructor(view: ViewsWithStashes, parent: ViewNode, file: GitFile, commit: GitStashCommit) {
		super('stash-file', view, parent, file, commit);
	}

	protected override get contextValue(): string {
		return `${ContextValues.File}+stashed`;
	}
}
