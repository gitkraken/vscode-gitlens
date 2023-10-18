import type { GitStashCommit } from '../../git/models/commit';
import type { GitFile } from '../../git/models/file';
import type { ViewsWithStashes } from '../viewBase';
import { CommitFileNodeBase } from './commitFileNode';
import type { ViewNode } from './viewNode';
import { ContextValues } from './viewNode';

export class StashFileNode extends CommitFileNodeBase<'stash-file', ViewsWithStashes> {
	constructor(view: ViewsWithStashes, parent: ViewNode, file: GitFile, commit: GitStashCommit) {
		super('stash-file', view, parent, file, commit);
	}

	protected override get contextValue(): string {
		return `${ContextValues.File}+stashed`;
	}
}
