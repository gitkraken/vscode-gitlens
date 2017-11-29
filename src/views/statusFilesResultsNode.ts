'use strict';
import { Arrays, Iterables } from '../system';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ExplorerFilesLayout } from '../configuration';
import { Explorer, ExplorerNode, ResourceType } from './explorerNode';
import { FolderNode, IFileExplorerNode } from './folderNode';
import { GitService, GitStatusFile, GitUri } from '../gitService';
import { StatusFileNode } from './statusFileNode';
import * as path from 'path';

export class StatusFilesResultsNode extends ExplorerNode {

    readonly supportsPaging: boolean = true;

    private _cache: { label: string, diff: GitStatusFile[] | undefined } | undefined;

    constructor(
        readonly repoPath: string,
        private readonly ref1: string,
        private readonly ref2: string,
        private readonly labelFn: (diff: GitStatusFile[] | undefined) => string,
        private readonly diffFn: () => Promise<GitStatusFile[] | undefined>,
        private readonly explorer: Explorer
    ) {
        super(GitUri.fromRepoPath(repoPath));
    }

    async getChildren(): Promise<ExplorerNode[]> {
        const diff = await this.getDiff();
        if (diff === undefined) return [];

        let children: IFileExplorerNode[] = [...Iterables.map(diff, s => new StatusFileNode(this.repoPath, s, this.ref1, this.ref2, this.explorer))];

        if (this.explorer.config.files.layout !== ExplorerFilesLayout.List) {
            const hierarchy = Arrays.makeHierarchical(children, n => n.uri.getRelativePath().split('/'),
                (...paths: string[]) => GitService.normalizePath(path.join(...paths)), this.explorer.config.files.compact);

            const root = new FolderNode(this.repoPath, '', undefined, hierarchy, this.explorer);
            children = await root.getChildren() as IFileExplorerNode[];
        }
        else {
            children.sort((a, b) => (a.priority ? -1 : 1) - (b.priority ? -1 : 1) || a.label!.localeCompare(b.label!));
        }

        return children;
    }

    async getTreeItem(): Promise<TreeItem> {
        const diff = await this.getDiff();

        const item = new TreeItem(await this.getLabel(), diff && diff.length > 0 ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.None);
        item.contextValue = ResourceType.Results;
        return item;
    }

    refresh() {
        this._cache = undefined;
    }

    private async ensureCache() {
        if (this._cache === undefined) {
            const diff = await this.diffFn();

            this._cache = {
                label: this.labelFn(diff),
                diff: diff
            };
        }

        return this._cache;
    }

    private async getLabel() {
        const cache = await this.ensureCache();
        return cache.label;
    }

    private async getDiff() {
        const cache = await this.ensureCache();
        return cache.diff;
    }
}