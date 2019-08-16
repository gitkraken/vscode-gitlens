'use strict';
import * as paths from 'path';
import { Command, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Commands, DiffWithPreviousCommandArgs } from '../../commands';
import { ViewFilesLayout } from '../../configuration';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { CommitFormatter, GitBranch, GitLogCommit } from '../../git/gitService';
import { Arrays, Iterables, Strings } from '../../system';
import { ViewWithFiles } from '../viewBase';
import { CommitFileNode } from './commitFileNode';
import { FileNode, FolderNode } from './folderNode';
import { ResourceType, ViewNode, ViewRefNode } from './viewNode';

export class CommitNode extends ViewRefNode<ViewWithFiles> {
    constructor(
        view: ViewWithFiles,
        parent: ViewNode,
        public readonly commit: GitLogCommit,
        public readonly branch?: GitBranch,
        private readonly getBranchAndTagTips?: (sha: string) => string | undefined
    ) {
        super(commit.toGitUri(), view, parent);
    }

    toClipboard(): string {
        return this.commit.sha;
    }

    get ref(): string {
        return this.commit.sha;
    }

    getChildren(): ViewNode[] {
        const commit = this.commit;
        let children: FileNode[] = [
            ...Iterables.map(commit.files, s => new CommitFileNode(this.view, this, s, commit.toFileCommit(s)))
        ];

        if (this.view.config.files.layout !== ViewFilesLayout.List) {
            const hierarchy = Arrays.makeHierarchical(
                children,
                n => n.uri.relativePath.split('/'),
                (...parts: string[]) => Strings.normalizePath(paths.join(...parts)),
                this.view.config.files.compact
            );

            const root = new FolderNode(this.view, this, this.repoPath, '', hierarchy);
            children = root.getChildren() as FileNode[];
        }
        else {
            children.sort((a, b) =>
                a.label!.localeCompare(b.label!, undefined, { numeric: true, sensitivity: 'base' })
            );
        }
        return children;
    }

    getTreeItem(): TreeItem {
        const label = CommitFormatter.fromTemplate(this.view.config.commitFormat, this.commit, {
            dateFormat: Container.config.defaultDateFormat,
            getBranchAndTagTips: this.getBranchAndTagTips,
            truncateMessageAtNewLine: true
        });

        const item = new TreeItem(label, TreeItemCollapsibleState.Collapsed);
        item.contextValue = ResourceType.Commit;
        if (this.branch !== undefined && this.branch.current) {
            item.contextValue += '+current';
        }
        item.description = CommitFormatter.fromTemplate(this.view.config.commitDescriptionFormat, this.commit, {
            truncateMessageAtNewLine: true,
            dateFormat: Container.config.defaultDateFormat
        });

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
                : `\${author} \${(email) }${GlyphChars.Dash} \${id}\${ (tips)}\n\${ago} (\${date})\n\n\${message}`,
            this.commit,
            {
                dateFormat: Container.config.defaultDateFormat,
                getBranchAndTagTips: this.getBranchAndTagTips
            }
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
        const commandArgs: DiffWithPreviousCommandArgs = {
            commit: this.commit,
            line: 0,
            showOptions: {
                preserveFocus: true,
                preview: true
            }
        };
        return {
            title: 'Compare File with Previous Revision',
            command: Commands.DiffWithPrevious,
            arguments: [this.uri, commandArgs]
        };
    }
}
