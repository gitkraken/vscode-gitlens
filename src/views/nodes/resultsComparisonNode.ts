'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { GitService, GitUri } from '../../git/gitService';
import { Strings } from '../../system';
import { ResultsExplorer } from '../resultsExplorer';
import { ExplorerNode, NamedRef, ResourceType } from './explorerNode';
import { CommitsQueryResults, ResultsCommitsNode } from './resultsCommitsNode';
import { StatusFilesResultsNode } from './statusFilesResultsNode';

export class ResultsComparisonNode extends ExplorerNode {
    constructor(
        public readonly repoPath: string,
        ref1: NamedRef,
        ref2: NamedRef,
        private readonly explorer: ResultsExplorer
    ) {
        super(GitUri.fromRepoPath(repoPath));

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

    async getChildren(): Promise<ExplorerNode[]> {
        return [
            new ResultsCommitsNode(this.uri.repoPath!, this.getCommitsQuery.bind(this), this.explorer),
            new StatusFilesResultsNode(this.uri.repoPath!, this._ref1.ref, this._ref2.ref, this.explorer)
        ];
    }

    async getTreeItem(): Promise<TreeItem> {
        let repository = '';
        if ((await Container.git.getRepositoryCount()) > 1) {
            const repo = await Container.git.getRepository(this.uri.repoPath!);
            repository = ` ${Strings.pad(GlyphChars.Dash, 1, 1)} ${(repo && repo.formattedName) || this.uri.repoPath}`;
        }

        const item = new TreeItem(
            `Comparing ${this._ref1.label ||
                GitService.shortenSha(this._ref1.ref, { working: 'Working Tree' })} to ${this._ref2.label ||
                GitService.shortenSha(this._ref2.ref, { working: 'Working Tree' })}${repository}`,
            TreeItemCollapsibleState.Expanded
        );
        item.contextValue = ResourceType.ComparisonResults;

        return item;
    }

    swap() {
        const ref1 = this._ref1;
        this._ref1 = this._ref2;
        this._ref2 = ref1;

        this.explorer.triggerNodeUpdate(this);
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
