'use strict';
import { ExtensionContext } from 'vscode';
import { ResourceType } from './explorerNode';
import { GitService, GitStashCommit, IGitStatusFile } from '../gitService';
import { CommitFileNode, CommitFileNodeDisplayAs } from './commitFileNode';

export class StashFileNode extends CommitFileNode {

    readonly resourceType: ResourceType = 'gitlens:stash-file';

    constructor(
        readonly status: IGitStatusFile,
        readonly commit: GitStashCommit,
        readonly context: ExtensionContext,
        readonly git: GitService
    ) {
        super(status, commit, context, git, CommitFileNodeDisplayAs.File);
    }

    protected getCommitTemplate() {
        return this.git.config.gitExplorer.stashFormat;
    }

    protected getCommitFileTemplate() {
        return this.git.config.gitExplorer.stashFileFormat;
    }
}