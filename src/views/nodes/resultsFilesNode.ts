'use strict';
import * as paths from 'path';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ViewFilesLayout } from '../../configuration';
import { Container } from '../../container';
import { GitFile, GitUri } from '../../git/gitService';
import { Arrays, Iterables, Strings } from '../../system';
import { View } from '../viewBase';
import { FileNode, FolderNode } from './folderNode';
import { ResultsFileNode } from './resultsFileNode';
import { ResourceType, ViewNode } from './viewNode';

export interface FilesQueryResults {
    label: string;
    diff: GitFile[] | undefined;
}

export class ResultsFilesNode extends ViewNode {
    constructor(
        view: View,
        parent: ViewNode,
        public readonly repoPath: string,
        private readonly _ref1: string,
        private readonly _ref2: string
    ) {
        super(GitUri.fromRepoPath(repoPath), view, parent);
    }

    async getChildren(): Promise<ViewNode[]> {
        const { diff } = await this.getFilesQueryResults();
        if (diff === undefined) return [];

        let children: FileNode[] = [
            ...Iterables.map(diff, s => new ResultsFileNode(this.view, this, this.repoPath, s, this._ref1, this._ref2))
        ];

        if (this.view.config.files.layout !== ViewFilesLayout.List) {
            const hierarchy = Arrays.makeHierarchical(
                children,
                n => n.uri.getRelativePath().split('/'),
                (...parts: string[]) => Strings.normalizePath(paths.join(...parts)),
                this.view.config.files.compact
            );

            const root = new FolderNode(this.view, this, this.repoPath, '', hierarchy);
            children = (await root.getChildren()) as FileNode[];
        }
        else {
            children.sort(
                (a, b) =>
                    a.priority - b.priority ||
                    a.label!.localeCompare(b.label!, undefined, { numeric: true, sensitivity: 'base' })
            );
        }

        return children;
    }

    async getTreeItem(): Promise<TreeItem> {
        const { diff, label } = await this.getFilesQueryResults();

        const item = new TreeItem(
            label,
            diff && diff.length > 0 ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.None
        );
        item.contextValue = ResourceType.ResultsFiles;
        return item;
    }

    refresh() {
        this._filesQueryResults = this.getFilesQueryResultsCore();
    }

    private _filesQueryResults: Promise<FilesQueryResults> | undefined;

    private getFilesQueryResults() {
        if (this._filesQueryResults === undefined) {
            this._filesQueryResults = this.getFilesQueryResultsCore();
        }

        return this._filesQueryResults;
    }

    private async getFilesQueryResultsCore(): Promise<FilesQueryResults> {
        const diff = await Container.git.getDiffStatus(this.uri.repoPath!, this._ref1, this._ref2);
        return {
            label: `${Strings.pluralize('file', diff !== undefined ? diff.length : 0, { zero: 'No' })} changed`,
            diff: diff
        };
    }
}
