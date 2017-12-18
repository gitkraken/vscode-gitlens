'use strict';
import { Strings } from '../system';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { CommitsResultsNode } from './commitsResultsNode';
import { GlyphChars } from '../constants';
import { Explorer, ExplorerNode, ResourceType } from './explorerNode';
import { GitLog, GitService, GitStatusFile, GitUri } from '../gitService';
import { StatusFilesResultsNode } from './statusFilesResultsNode';

export class ComparisionResultsNode extends ExplorerNode {

    constructor(
        repoPath: string,
        public readonly ref1: string,
        public readonly ref2: string,
        private readonly explorer: Explorer
    ) {
        super(GitUri.fromRepoPath(repoPath));
    }

    async getChildren(): Promise<ExplorerNode[]> {
        this.resetChildren();

        const commitsQueryFn = (maxCount: number | undefined) => this.explorer.git.getLogForRepo(this.uri.repoPath!, { maxCount: maxCount, ref: `${this.ref1}...${this.ref2}` });
        const commitsLabelFn = (log: GitLog | undefined) => {
            const count = log !== undefined ? log.count : 0;
            const truncated = log !== undefined ? log.truncated : false;

            if (count === 1) return `1 commit`;
            return `${count === 0 ? 'No' : `${count}${truncated ? '+' : ''}`} commits`;
        };

        const filesQueryFn = () => this.explorer.git.getDiffStatus(this.uri.repoPath!, this.ref1, this.ref2);
        const filesLabelFn = (diff: GitStatusFile[] | undefined) => {
            const count = diff !== undefined ? diff.length : 0;

            if (count === 1) return `1 file changed`;
            return `${count === 0 ? 'No' : count} files changed`;
        };

        this.children = [
            new CommitsResultsNode(this.uri.repoPath!, commitsLabelFn, commitsQueryFn, this.explorer),
            new StatusFilesResultsNode(this.uri.repoPath!, this.ref1, this.ref2, filesLabelFn, filesQueryFn, this.explorer)
        ];

        return this.children;
    }

    async getTreeItem(): Promise<TreeItem> {
        const repo = await this.explorer.git.getRepository(this.uri.repoPath!);

        const item = new TreeItem(`Comparing ${GitService.shortenSha(this.ref1)} to ${GitService.shortenSha(this.ref2)} ${Strings.pad(GlyphChars.Dash, 1, 1)} ${(repo && repo.formattedName) || this.uri.repoPath}`, TreeItemCollapsibleState.Expanded);
        item.contextValue = ResourceType.ComparisonResults;
        return item;
    }
}