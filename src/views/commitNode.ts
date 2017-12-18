'use strict';
import { Arrays, Iterables } from '../system';
import { Command, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Commands, DiffWithPreviousCommandArgs } from '../commands';
import { CommitFileNode, CommitFileNodeDisplayAs } from './commitFileNode';
import { ExplorerFilesLayout, GravatarDefault } from '../configuration';
import { FolderNode, IFileExplorerNode } from './folderNode';
import { Explorer, ExplorerNode, ExplorerRefNode, ResourceType } from './explorerNode';
import { CommitFormatter, GitBranch, GitLogCommit, GitService, ICommitFormatOptions } from '../gitService';
import * as path from 'path';

export class CommitNode extends ExplorerRefNode {

    constructor(
        public readonly commit: GitLogCommit,
        private readonly explorer: Explorer,
        public readonly branch?: GitBranch
    ) {
        super(commit.toGitUri());
    }

    get ref(): string {
        return this.commit.sha;
    }

    async getChildren(): Promise<ExplorerNode[]> {
        const repoPath = this.repoPath;

        const log = await this.explorer.git.getLogForRepo(repoPath, { maxCount: 1, ref: this.commit.sha });
        if (log === undefined) return [];

        const commit = Iterables.first(log.commits.values());
        if (commit === undefined) return [];

        let children: IFileExplorerNode[] = [
            ...Iterables.map(commit.fileStatuses, s => new CommitFileNode(s, commit.toFileCommit(s), this.explorer, CommitFileNodeDisplayAs.File, this.branch))
        ];

        if (this.explorer.config.files.layout !== ExplorerFilesLayout.List) {
            const hierarchy = Arrays.makeHierarchical(children, n => n.uri.getRelativePath().split('/'),
            (...paths: string[]) => GitService.normalizePath(path.join(...paths)), this.explorer.config.files.compact);

            const root = new FolderNode(repoPath, '', undefined, hierarchy, this.explorer);
            children = await root.getChildren() as IFileExplorerNode[];
        }
        else {
            children.sort((a, b) => a.label!.localeCompare(b.label!));
        }
        return children;
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(CommitFormatter.fromTemplate(this.explorer.config.commitFormat, this.commit, {
            truncateMessageAtNewLine: true,
            dataFormat: this.explorer.git.config.defaultDateFormat
        } as ICommitFormatOptions), TreeItemCollapsibleState.Collapsed);

        item.contextValue = (this.branch === undefined || this.branch.current)
            ? ResourceType.CommitOnCurrentBranch
            : ResourceType.Commit;

        if (this.explorer.config.gravatars) {
            item.iconPath = this.commit.getGravatarUri(this.explorer.config.gravatarsDefault || GravatarDefault.Robot);
        } else {
            item.iconPath = {
                dark: this.explorer.context.asAbsolutePath('images/dark/icon-commit.svg'),
                light: this.explorer.context.asAbsolutePath('images/light/icon-commit.svg')
            };
        }

        return item;
    }

    getCommand(): Command | undefined {
        return {
            title: 'Compare File with Previous Revision',
            command: Commands.DiffWithPrevious,
            arguments: [
                this.uri,
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