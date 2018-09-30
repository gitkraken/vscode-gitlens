'use strict';
import { GitFile, GitLogCommit } from '../../git/gitService';
import { View } from '../viewBase';
import { CommitFileNode, CommitFileNodeDisplayAs } from './commitFileNode';
import { ResourceType, ViewNode } from './viewNode';

export class StashFileNode extends CommitFileNode {
    constructor(file: GitFile, commit: GitLogCommit, parent: ViewNode, view: View) {
        super(file, commit, parent, view, CommitFileNodeDisplayAs.File);
    }

    protected get resourceType(): ResourceType {
        return ResourceType.StashFile;
    }

    protected getCommitTemplate() {
        return this.view.config.stashFormat;
    }

    protected getCommitFileTemplate() {
        return this.view.config.stashFileFormat;
    }
}
