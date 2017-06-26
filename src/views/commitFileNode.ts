'use strict';
import { ExtensionContext, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Commands, DiffWithPreviousCommandArgs } from '../commands';
import { ExplorerNode, ResourceType } from './explorerNode';
import { getGitStatusIcon, GitCommit, GitService, GitUri, IGitStatusFile, StatusFileFormatter } from '../gitService';
import * as path from 'path';

export class CommitFileNode extends ExplorerNode {

    readonly resourceType: ResourceType = 'commit-file';

    constructor(public status: IGitStatusFile, public commit: GitCommit, private template: string,  uri: GitUri, context: ExtensionContext, git: GitService) {
        super(uri, context, git);
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

        const item = new TreeItem(StatusFileFormatter.fromTemplate(this.template, this.status), TreeItemCollapsibleState.None);
        item.contextValue = this.resourceType;

        const icon = getGitStatusIcon(this.status.status);
        item.iconPath = {
            dark: this.context.asAbsolutePath(path.join('images', 'dark', icon)),
            light: this.context.asAbsolutePath(path.join('images', 'light', icon))
        };

        item.command = {
            title: 'Compare File with Previous',
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

        return item;
    }
}