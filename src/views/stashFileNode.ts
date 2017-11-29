'use strict';
import { CommitFileNode, CommitFileNodeDisplayAs } from './commitFileNode';
import { Explorer, ResourceType } from './explorerNode';
import { GitLogCommit, IGitStatusFile } from '../gitService';

export class StashFileNode extends CommitFileNode {

    constructor(
        status: IGitStatusFile,
        commit: GitLogCommit,
        explorer: Explorer
    ) {
        super(status, commit, explorer, CommitFileNodeDisplayAs.File);
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