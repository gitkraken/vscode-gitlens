'use strict';
import * as path from 'path';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ExplorerFilesLayout } from '../../configuration';
import { Container } from '../../container';
import { GitStatusFile, GitUri } from '../../git/gitService';
import { Arrays, Iterables, Strings } from '../../system';
import { Explorer } from '../explorer';
import { ExplorerNode, ResourceType } from './explorerNode';
import { FileExplorerNode, FolderNode } from './folderNode';
import { StatusFileNode } from './statusFileNode';

export interface FilesQueryResults {
    label: string;
    diff: GitStatusFile[] | undefined;
}

export class ResultsFilesNode extends ExplorerNode {
    constructor(
        public readonly repoPath: string,
        private readonly _ref1: string,
        private readonly _ref2: string,
        parent: ExplorerNode,
        public readonly explorer: Explorer
    ) {
        super(GitUri.fromRepoPath(repoPath), parent);
    }

    async getChildren(): Promise<ExplorerNode[]> {
        const { diff } = await this.getFilesQueryResults();
        if (diff === undefined) return [];

        let children: FileExplorerNode[] = [
            ...Iterables.map(
                diff,
                s => new StatusFileNode(this.repoPath, s, this._ref1, this._ref2, this, this.explorer)
            )
        ];

        if (this.explorer.config.files.layout !== ExplorerFilesLayout.List) {
            const hierarchy = Arrays.makeHierarchical(
                children,
                n => n.uri.getRelativePath().split('/'),
                (...paths: string[]) => Strings.normalizePath(path.join(...paths)),
                this.explorer.config.files.compact
            );

            const root = new FolderNode(this.repoPath, '', undefined, hierarchy, this, this.explorer);
            children = (await root.getChildren()) as FileExplorerNode[];
        }
        else {
            children.sort((a, b) => (a.priority ? -1 : 1) - (b.priority ? -1 : 1) || a.label!.localeCompare(b.label!));
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

    async refresh() {
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
