'use strict';
import { GitFile, GitLogCommit } from '../../git/git';
import { View } from '../viewBase';
import { CommitFileNode } from './commitFileNode';
import { ResourceType, ViewNode } from './viewNode';

export class StashFileNode extends CommitFileNode {
	constructor(view: View, parent: ViewNode, file: GitFile, commit: GitLogCommit) {
		super(view, parent, file, commit);
	}

	protected get resourceType(): ResourceType {
		return ResourceType.StashFile;
	}

	protected getCommitTemplate() {
		return this.view.config.stashFormat;
	}

	protected getCommitDescriptionTemplate() {
		return this.view.config.stashDescriptionFormat;
	}

	protected getCommitFileTemplate() {
		return this.view.config.stashFileFormat;
	}

	protected getCommitFileDescriptionTemplate() {
		return this.view.config.stashFileDescriptionFormat;
	}
}
