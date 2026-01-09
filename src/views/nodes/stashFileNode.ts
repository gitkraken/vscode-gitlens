import type { GitStashCommit } from '../../git/models/commit.js';
import type { GitFile } from '../../git/models/file.js';
import type { ViewsWithStashes } from '../viewBase.js';
import type { ViewNode } from './abstract/viewNode.js';
import { ContextValues } from './abstract/viewNode.js';
import { CommitFileNodeBase } from './commitFileNode.js';

export class StashFileNode extends CommitFileNodeBase<'stash-file', ViewsWithStashes> {
	constructor(view: ViewsWithStashes, parent: ViewNode, file: GitFile, commit: GitStashCommit) {
		super('stash-file', view, parent, file, commit);
	}

	protected override get contextValue(): string {
		return `${ContextValues.File}+stashed`;
	}
}
