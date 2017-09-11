'use strict';
import { Command, ExtensionContext, TreeItem, TreeItemCollapsibleState, Uri } from 'vscode';
import { Commands, DiffWithPreviousCommandArgs } from '../commands';
import { ExplorerNode, ResourceType } from './explorerNode';
import { getGitStatusIcon, GitCommit, GitService, GitUri, IGitStatusFile, StatusFileFormatter } from '../gitService';
import * as path from 'path';

export class CommitFileNode extends ExplorerNode {

    readonly resourceType: ResourceType = 'gitlens:commit-file';

    constructor(public readonly status: IGitStatusFile, public commit: GitCommit, protected readonly context: ExtensionContext, protected readonly git: GitService) {
        super(new GitUri(Uri.file(path.resolve(commit.repoPath, status.fileName)), { repoPath: commit.repoPath, fileName: status.fileName, sha: commit.sha }));
    }

    getChildren(): Promise<ExplorerNode[]> {
        return Promise.resolve([]);
    }

    async getTreeItem(): Promise<TreeItem> {
        if (this.commit.type !== 'file') {
            const log = await this.git.getLogForFile(this.commit.repoPath, this.status.fileName, this.commit.sha, { maxCount: 2 });
            if (log !== undefined) {
                this.commit = log.commits.get(this.commit.sha) || this.commit;
            }
        }

        const item = new TreeItem(StatusFileFormatter.fromTemplate(this.git.config.gitExplorer.commitFileFormat, this.status), TreeItemCollapsibleState.None);
        item.contextValue = this.resourceType;

        const icon = getGitStatusIcon(this.status.status);
        item.iconPath = {
            dark: this.context.asAbsolutePath(path.join('images', 'dark', icon)),
            light: this.context.asAbsolutePath(path.join('images', 'light', icon))
        };

        item.command = this.getCommand();

        return item;
    }

    getCommand(): Command | undefined {
        return {
            title: 'Compare File with Previous Revision',
            command: Commands.DiffWithPrevious,
            arguments: [
                GitUri.fromFileStatus(this.status, this.commit.repoPath),
                {
                    commit: this.commit,
                    line: 0,
                    showOptions: {
                        preserveFocus: true,
                        preview: true
                    }
                } as DiffWithPreviousCommandArgs
            ]
        };
    }
}