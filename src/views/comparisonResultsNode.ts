'use strict';
import { Strings } from '../system';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { CommitsResultsNode } from './commitsResultsNode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { Explorer, ExplorerNode, NamedRef, ResourceType } from './explorerNode';
import { GitLog, GitService, GitUri } from '../gitService';
import { StatusFilesResultsNode } from './statusFilesResultsNode';

export class ComparisonResultsNode extends ExplorerNode {

    constructor(
        public readonly repoPath: string,
        public readonly ref1: NamedRef,
        public readonly ref2: NamedRef,
        private readonly explorer: Explorer
    ) {
        super(GitUri.fromRepoPath(repoPath));
    }

    async getChildren(): Promise<ExplorerNode[]> {
        this.resetChildren();

        const commitsQueryFn = (maxCount: number | undefined) => Container.git.getLog(this.uri.repoPath!, { maxCount: maxCount, ref: `${this.ref1.ref}...${this.ref2.ref || 'HEAD'}` });
        const commitsLabelFn = async (log: GitLog | undefined) => {
            const count = log !== undefined ? log.count : 0;
            const truncated = log !== undefined ? log.truncated : false;

            if (count === 1) return `1 commit`;
            return `${count === 0 ? 'No' : `${count}${truncated ? '+' : ''}`} commits`;
        };

        this.children = [
            new CommitsResultsNode(this.uri.repoPath!, commitsLabelFn, commitsQueryFn, this.explorer),
            new StatusFilesResultsNode(this.uri.repoPath!, this.ref1.ref, this.ref2.ref, this.explorer)
        ];

        return this.children;
    }

    async getTreeItem(): Promise<TreeItem> {
        let repository = '';
        if (await Container.git.getRepositoryCount() > 1) {
            const repo = await Container.git.getRepository(this.uri.repoPath!);
            repository = ` ${Strings.pad(GlyphChars.Dash, 1, 1)} ${(repo && repo.formattedName) || this.uri.repoPath}`;
        }

        const item = new TreeItem(`Comparing ${this.ref1.label || GitService.shortenSha(this.ref1.ref, { working: 'Working Tree' })} to ${this.ref2.label || GitService.shortenSha(this.ref2.ref, { working: 'Working Tree' })}${repository}`, TreeItemCollapsibleState.Expanded);
        item.contextValue = ResourceType.ComparisonResults;
        return item;
    }
}