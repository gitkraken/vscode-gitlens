'use strict';
import * as paths from 'path';
import { Command, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Commands, DiffWithPreviousCommandArgs } from '../../commands';
import { ViewFilesLayout } from '../../configuration';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { CommitFormatter, GitBranch, GitLogCommit, ICommitFormatOptions } from '../../git/gitService';
import { Arrays, Iterables, Strings } from '../../system';
import { View } from '../viewBase';
import { CommitFileNode, CommitFileNodeDisplayAs } from './commitFileNode';
import { FileNode, FolderNode } from './folderNode';
import { ResourceType, ViewNode, ViewRefNode } from './viewNode';

export class CommitNode extends ViewRefNode {
    constructor(
        public readonly commit: GitLogCommit,
        parent: ViewNode,
        public readonly view: View,
        public readonly branch?: GitBranch,
        private readonly getBranchTips?: (sha: string) => string | undefined
    ) {
        super(commit.toGitUri(), parent);
    }

    get ref(): string {
        return this.commit.sha;
    }

    async getChildren(): Promise<ViewNode[]> {
        const commit = this.commit;
        let children: FileNode[] = [
            ...Iterables.map(
                commit.files,
                s => new CommitFileNode(s, commit.toFileCommit(s), this, this.view, CommitFileNodeDisplayAs.File)
            )
        ];

        if (this.view.config.files.layout !== ViewFilesLayout.List) {
            const hierarchy = Arrays.makeHierarchical(
                children,
                n => n.uri.getRelativePath().split('/'),
                (...parts: string[]) => Strings.normalizePath(paths.join(...parts)),
                this.view.config.files.compact
            );

            const root = new FolderNode(this.repoPath, '', undefined, hierarchy, this, this.view);
            children = (await root.getChildren()) as FileNode[];
        }
        else {
            children.sort((a, b) => a.label!.localeCompare(b.label!));
        }
        return children;
    }

    getTreeItem(): TreeItem {
        let label = CommitFormatter.fromTemplate(this.view.config.commitFormat, this.commit, {
            truncateMessageAtNewLine: true,
            dateFormat: Container.config.defaultDateFormat
        } as ICommitFormatOptions);

        const branchTips = this.getBranchTips && this.getBranchTips(this.commit.sha);
        if (branchTips !== undefined) {
            label = `${GlyphChars.AngleBracketLeftHeavy}${GlyphChars.SpaceThin}${branchTips}${GlyphChars.SpaceThin}${
                GlyphChars.AngleBracketRightHeavy
            }${GlyphChars.ArrowHeadRight}${GlyphChars.Space} ${label}`;
        }

        const item = new TreeItem(label, TreeItemCollapsibleState.Collapsed);

        item.contextValue =
            this.branch === undefined || this.branch.current ? ResourceType.CommitOnCurrentBranch : ResourceType.Commit;

        if (this.view.config.avatars) {
            item.iconPath = this.commit.getGravatarUri(Container.config.defaultGravatarsStyle);
        }
        else {
            item.iconPath = {
                dark: Container.context.asAbsolutePath('images/dark/icon-commit.svg'),
                light: Container.context.asAbsolutePath('images/light/icon-commit.svg')
            };
        }

        item.tooltip = CommitFormatter.fromTemplate(
            this.commit.isUncommitted
                ? `\${author} ${GlyphChars.Dash} \${id}\n\${ago} (\${date})`
                : `\${author} ${GlyphChars.Dash} \${id}${
                      branchTips !== undefined ? ` (${branchTips})` : ''
                  }\n\${ago} (\${date})\n\n\${message}`,
            this.commit,
            {
                dateFormat: Container.config.defaultDateFormat
            } as ICommitFormatOptions
        );

        if (!this.commit.isUncommitted) {
            item.tooltip += this.commit.getFormattedDiffStatus({
                expand: true,
                prefix: '\n\n',
                separator: '\n'
            });
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
