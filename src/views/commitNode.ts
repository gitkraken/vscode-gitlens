'use strict';
import { Arrays, Iterables, Strings } from '../system';
import { Command, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Commands, DiffWithPreviousCommandArgs } from '../commands';
import { CommitFileNode, CommitFileNodeDisplayAs } from './commitFileNode';
import { ExplorerFilesLayout } from '../configuration';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { FolderNode, IFileExplorerNode } from './folderNode';
import { Explorer, ExplorerNode, ExplorerRefNode, ResourceType } from './explorerNode';
import { CommitFormatter, GitBranch, GitLogCommit, ICommitFormatOptions } from '../gitService';
import * as path from 'path';

export class CommitNode extends ExplorerRefNode {

    constructor(
        public readonly commit: GitLogCommit,
        private readonly explorer: Explorer,
        public readonly branch?: GitBranch,
        private readonly trackingRef?: string
    ) {
        super(commit.toGitUri());
    }

    get ref(): string {
        return this.commit.sha;
    }

    async getChildren(): Promise<ExplorerNode[]> {
        const commit = this.commit;
        let children: IFileExplorerNode[] = [
            ...Iterables.map(commit.fileStatuses, s => new CommitFileNode(s, commit.toFileCommit(s), this.explorer, CommitFileNodeDisplayAs.File))
        ];

        if (this.explorer.config.files.layout !== ExplorerFilesLayout.List) {
            const hierarchy = Arrays.makeHierarchical(children, n => n.uri.getRelativePath().split('/'),
            (...paths: string[]) => Strings.normalizePath(path.join(...paths)), this.explorer.config.files.compact);

            const root = new FolderNode(this.repoPath, '', undefined, hierarchy, this.explorer);
            children = await root.getChildren() as IFileExplorerNode[];
        }
        else {
            children.sort((a, b) => a.label!.localeCompare(b.label!));
        }
        return children;
    }

    getTreeItem(): TreeItem {
        let label = CommitFormatter.fromTemplate(this.explorer.config.commitFormat, this.commit, {
            truncateMessageAtNewLine: true,
            dataFormat: Container.config.defaultDateFormat
        } as ICommitFormatOptions);

        if (this.trackingRef === this.commit.sha) {
            label = `${GlyphChars.ArrowHeadRight} ${label}`;
        }
        const item = new TreeItem(label, TreeItemCollapsibleState.Collapsed);

        item.contextValue = (this.branch === undefined || this.branch.current)
            ? ResourceType.CommitOnCurrentBranch
            : ResourceType.Commit;

        if (this.explorer.config.avatars) {
            item.iconPath = this.commit.getGravatarUri(Container.config.defaultGravatarsStyle);
        } else {
            item.iconPath = {
                dark: Container.context.asAbsolutePath('images/dark/icon-commit.svg'),
                light: Container.context.asAbsolutePath('images/light/icon-commit.svg')
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