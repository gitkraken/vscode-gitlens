'use strict';
import * as paths from 'path';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ViewFilesLayout } from '../../configuration';
import { Container } from '../../container';
import { GitFile, GitUri } from '../../git/gitService';
import { Arrays, debug, gate, Iterables, Strings } from '../../system';
import { ViewWithFiles } from '../viewBase';
import { FileNode, FolderNode } from './folderNode';
import { ResultsFileNode } from './resultsFileNode';
import { getNextId, ResourceType, ViewNode } from './viewNode';

export interface FilesQueryResults {
    label: string;
    diff: GitFile[] | undefined;
}

export class ResultsFilesNode extends ViewNode<ViewWithFiles> {
    // Generate a unique id so the node order is preserved, since we update the label when the query completes
    private readonly _uniqueId: number = getNextId('ResultsFilesNode');

    constructor(
        view: ViewWithFiles,
        parent: ViewNode,
        public readonly repoPath: string,
        private readonly _ref1: string,
        private readonly _ref2: string
    ) {
        super(GitUri.fromRepoPath(repoPath), view, parent);
    }

    get id(): string {
        return `${this._uniqueId}|${this._instanceId}:gitlens:results:files(${this.repoPath})`;
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
        let state;
        let label;
        let diff;
        if (this._querying) {
            // Need to use Collapsed before we have results or the item won't show up in the view until the children are awaited
            state = TreeItemCollapsibleState.Collapsed;
            label = '? files changed';

            this.getFilesQueryResults().then(_ => {
                this._querying = false;
                this.triggerChange(false);
            });
        }
        else {
            ({ label, diff } = await this.getFilesQueryResults());

            state = TreeItemCollapsibleState.Expanded;
            if (diff == null || diff.length === 0) {
                state = TreeItemCollapsibleState.None;
            }
        }

        const item = new TreeItem(label, state);
        item.contextValue = ResourceType.ResultsFiles;
        item.id = this.id;

        return item;
    }

    @gate()
    @debug()
    refresh(reset: boolean = false) {
        if (!reset) return;

        this._filesQueryResults = this.getFilesQueryResultsCore();
    }

    private _filesQueryResults: Promise<FilesQueryResults> | undefined;
    private _querying = true;

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
