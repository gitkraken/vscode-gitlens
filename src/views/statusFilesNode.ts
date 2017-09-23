'use strict';
import { Arrays, Iterables, Objects } from '../system';
import { ExtensionContext, TreeItem, TreeItemCollapsibleState, Uri } from 'vscode';
import { ExplorerNode, ResourceType, ShowAllNode } from './explorerNode';
import { GitBranch, GitLog, GitLogCommit, GitService, GitStatus, GitUri, IGitStatusFileWithCommit } from '../gitService';
import { StatusFileCommitsNode } from './statusFileCommitsNode';

export class StatusFilesNode extends ExplorerNode {

    readonly resourceType: ResourceType = 'gitlens:status-files';

    maxCount: number | undefined = undefined;

    constructor(
        public readonly status: GitStatus,
        public readonly range: string | undefined,
        protected readonly context: ExtensionContext,
        protected readonly git: GitService,
        public readonly branch?: GitBranch
    ) {
        super(new GitUri(Uri.file(status.repoPath), { repoPath: status.repoPath, fileName: status.repoPath }));
    }

    async getChildren(): Promise<ExplorerNode[]> {
        let statuses: IGitStatusFileWithCommit[];
        let log: GitLog | undefined;
        if (this.range !== undefined) {
            log = await this.git.getLogForRepo(this.status.repoPath, this.range, this.maxCount);
            if (log === undefined) return [];

            statuses = Array.from(Iterables.flatMap(log.commits.values(), c => {
                return c.fileStatuses.map(s => {
                    return { ...s, commit: c } as IGitStatusFileWithCommit;
                });
            }));
        }
        else {
            statuses = [];
        }

        if (this.status.files.length !== 0 && this.includeWorkingTree) {
            statuses.splice(0, 0, ...this.status.files.map(s => {
                return { ...s, commit: new GitLogCommit('file', this.status.repoPath, GitService.uncommittedSha, s.fileName, 'You', new Date(), '', s.status, [s], s.originalFileName, 'HEAD', s.fileName) } as IGitStatusFileWithCommit;
            }));
        }
        statuses.sort((a, b) => b.commit.date.getTime() - a.commit.date.getTime());

        const groups = Arrays.groupBy(statuses, s => s.fileName);

        const children: (StatusFileCommitsNode | ShowAllNode)[] = [
            ...Iterables.map(Objects.values<IGitStatusFileWithCommit[]>(groups),
                statuses => new StatusFileCommitsNode(this.uri.repoPath!, statuses[statuses.length - 1], statuses.map(s => s.commit), this.context, this.git, this.branch))
        ];

        children.sort((a: StatusFileCommitsNode, b: StatusFileCommitsNode) => (a.commit.isUncommitted ? -1 : 1) - (b.commit.isUncommitted ? -1 : 1) || a.label!.localeCompare(b.label!));

        if (log !== undefined && log.truncated) {
            children.push(new ShowAllNode('Show All Changes', this, this.context));
        }
        return children;
    }

    async getTreeItem(): Promise<TreeItem> {
        let files = (this.status.files !== undefined && this.includeWorkingTree) ? this.status.files.length : 0;

        if (this.status.upstream !== undefined) {
            const stats = await this.git.getChangedFilesCount(this.status.repoPath, `${this.status.upstream}...`);
            if (stats !== undefined) {
                files += stats.files;
            }
        }

        const label = `${files} file${files > 1 ? 's' : ''} changed`; // ${this.status.upstream === undefined ? '' : ` (ahead of ${this.status.upstream})`}`;
        const item = new TreeItem(label, TreeItemCollapsibleState.Collapsed);
        item.contextValue = this.resourceType;
        item.iconPath = {
            dark: this.context.asAbsolutePath(`images/dark/icon-diff.svg`),
            light: this.context.asAbsolutePath(`images/light/icon-diff.svg`)
        };

        return item;
    }

    private get includeWorkingTree(): boolean {
        return this.git.config.gitExplorer.includeWorkingTree;
    }

}