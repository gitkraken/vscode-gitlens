'use strict';
import { GitFile, GitLogCommit } from '../../git/gitService';
import { Explorer } from '../explorer';
import { CommitFileNode, CommitFileNodeDisplayAs } from './commitFileNode';
import { ExplorerNode, ResourceType } from './explorerNode';

export class StashFileNode extends CommitFileNode {
    constructor(file: GitFile, commit: GitLogCommit, parent: ExplorerNode, explorer: Explorer) {
        super(file, commit, parent, explorer, CommitFileNodeDisplayAs.File);
    }

    protected get resourceType(): ResourceType {
        return ResourceType.StashFile;
    }

    protected getCommitTemplate() {
        return this.explorer.config.stashFormat;
    }

    protected getCommitFileTemplate() {
        return this.explorer.config.stashFileFormat;
    }
}
