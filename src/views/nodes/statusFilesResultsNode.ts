'use strict';
import * as path from 'path';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ExplorerFilesLayout } from '../../configuration';
import { Container } from '../../container';
import { GitStatusFile, GitUri } from '../../git/gitService';
import { Arrays, Iterables, Strings } from '../../system';
import { Explorer } from '../explorer';
import { ExplorerNode, ResourceType } from './explorerNode';
import { FolderNode, IFileExplorerNode } from './folderNode';
import { StatusFileNode } from './statusFileNode';

export class StatusFilesResultsNode extends ExplorerNode {
    readonly supportsPaging: boolean = true;

    private _cache: { label: string; diff: GitStatusFile[] | undefined } | undefined;

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
        const diff = await this.getDiff();
        if (diff === undefined) return [];

        let children: IFileExplorerNode[] = [
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
            children = (await root.getChildren()) as IFileExplorerNode[];
        }
        else {
            children.sort((a, b) => (a.priority ? -1 : 1) - (b.priority ? -1 : 1) || a.label!.localeCompare(b.label!));
        }

        return children;
    }

    async getTreeItem(): Promise<TreeItem> {
        const diff = await this.getDiff();

        const item = new TreeItem(
            await this.getLabel(),
            diff && diff.length > 0 ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.None
        );
        item.contextValue = ResourceType.ResultsFiles;
        return item;
    }

    refresh() {
        this._cache = undefined;
    }

    private async ensureCache() {
        if (this._cache === undefined) {
            const diff = await Container.git.getDiffStatus(this.uri.repoPath!, this._ref1, this._ref2);

            const count = diff !== undefined ? diff.length : 0;
            const label = `${Strings.pluralize('file', count, { zero: 'No' })} changed`;

            this._cache = {
                label: label,
                diff: diff
            };
        }

        return this._cache;
    }

    private async getDiff() {
        const cache = await this.ensureCache();
        return cache.diff;
    }

    private async getLabel() {
        const cache = await this.ensureCache();
        return cache.label;
    }
}
