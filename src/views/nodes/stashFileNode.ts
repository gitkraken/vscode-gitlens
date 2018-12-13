'use strict';
import { GitFile, GitLogCommit } from '../../git/gitService';
import { View } from '../viewBase';
import { CommitFileNode, CommitFileNodeDisplayAs } from './commitFileNode';
import { ResourceType, ViewNode } from './viewNode';

export class StashFileNode extends CommitFileNode {
    constructor(view: View, parent: ViewNode, file: GitFile, commit: GitLogCommit) {
        super(view, parent, file, commit, CommitFileNodeDisplayAs.File);
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
