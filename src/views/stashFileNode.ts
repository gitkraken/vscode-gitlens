'use strict';
import { CommitFileNode, CommitFileNodeDisplayAs } from './commitFileNode';
import { ResourceType } from './explorerNode';
import { GitExplorer } from './gitExplorer';
import { GitLogCommit, IGitStatusFile } from '../gitService';

export class StashFileNode extends CommitFileNode {

    readonly resourceType: ResourceType = 'gitlens:stash-file';

    constructor(
        status: IGitStatusFile,
        commit: GitLogCommit,
        explorer: GitExplorer
    ) {
        super(status, commit, explorer, CommitFileNodeDisplayAs.File);
    }

    protected getCommitTemplate() {
        return this.explorer.config.stashFormat;
    }

    protected getCommitFileTemplate() {
        return this.explorer.config.stashFileFormat;
    }
}