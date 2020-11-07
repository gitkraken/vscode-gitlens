'use strict';
import { GitFile, GitLogCommit } from '../../git/git';
import { View } from '../viewBase';
import { CommitFileNode } from './commitFileNode';
import { ContextValues, ViewNode } from './viewNode';

export class StashFileNode extends CommitFileNode {
	constructor(view: View, parent: ViewNode, file: GitFile, commit: GitLogCommit) {
		super(view, parent, file, commit);
	}

	protected get contextValue(): string {
		return `${ContextValues.File}+stashed`;
	}

	protected getLabelFormat() {
		return this.view.config.formats.stashes.label;
	}

	protected getDescriptionFormat() {
		return this.view.config.formats.stashes.description;
	}
}
