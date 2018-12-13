'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Container } from '../../container';
import { GitService, GitUri } from '../../git/gitService';
import { Strings } from '../../system';
import { View } from '../viewBase';
import { CommitsQueryResults, ResultsCommitsNode } from './resultsCommitsNode';
import { ResultsFilesNode } from './resultsFilesNode';
import { NamedRef, ResourceType, ViewNode } from './viewNode';

export class CompareResultsNode extends ViewNode {
    constructor(
        view: View,
        public readonly repoPath: string,
        ref1: NamedRef,
        ref2: NamedRef
    ) {
        super(GitUri.fromRepoPath(repoPath), view);

        this._ref1 = ref1;
        this._ref2 = ref2;
    }

    private _ref1: NamedRef;
    get ref1(): NamedRef {
        return this._ref1;
    }

    private _ref2: NamedRef;
    get ref2(): NamedRef {
        return this._ref2;
    }

    async getChildren(): Promise<ViewNode[]> {
        return [
            new ResultsCommitsNode(this.view, this, this.uri.repoPath!, this.getCommitsQuery.bind(this)),
            new ResultsFilesNode(this.view, this, this.uri.repoPath!, this._ref1.ref, this._ref2.ref)
        ];
    }

    async getTreeItem(): Promise<TreeItem> {
        let description;
        if ((await Container.git.getRepositoryCount()) > 1) {
            const repo = await Container.git.getRepository(this.uri.repoPath!);
            description = (repo && repo.formattedName) || this.uri.repoPath;
        }

        const item = new TreeItem(
            `Comparing ${this._ref1.label ||
                GitService.shortenSha(this._ref1.ref, { working: 'Working Tree' })} to ${this._ref2.label ||
                GitService.shortenSha(this._ref2.ref, { working: 'Working Tree' })}`,
            TreeItemCollapsibleState.Collapsed
        );
        item.contextValue = ResourceType.CompareResults;
        item.description = description;

        return item;
    }

    swap() {
        const ref1 = this._ref1;
        this._ref1 = this._ref2;
        this._ref2 = ref1;

        this.view.triggerNodeChange(this);
    }

    private async getCommitsQuery(maxCount: number | undefined): Promise<CommitsQueryResults> {
        const log = await Container.git.getLog(this.uri.repoPath!, {
            maxCount: maxCount,
            ref: `${this._ref1.ref}...${this._ref2.ref || 'HEAD'}`
        });

        const count = log !== undefined ? log.count : 0;
        const truncated = log !== undefined ? log.truncated : false;

        const label = Strings.pluralize('commit', count, { number: truncated ? `${count}+` : undefined, zero: 'No' });

        return {
            label: label,
            log: log
        };
    }
}
