'use strict';
import { Arrays, Iterables, Objects } from '../system';
import { ExtensionContext, TreeItem, TreeItemCollapsibleState, Uri } from 'vscode';
import { ExplorerNode, ResourceType, ShowAllNode } from './explorerNode';
import { GitBranch, GitLog, GitLogCommit, GitService, GitStatus, GitUri, IGitStatusFile } from '../gitService';
import { StatusFileCommitsNode } from './statusFileCommitsNode';

interface IGitStatusFileWithCommit extends IGitStatusFile {
    commit: GitLogCommit;
}

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

        if (this.status.files.length !== 0) {
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

        if (log !== undefined && log.truncated) {
            children.push(new ShowAllNode('Show All Changes', this, this.context));
        }
        return children;
    }

    async getTreeItem(): Promise<TreeItem> {
        const item = new TreeItem(`Changed Files`, TreeItemCollapsibleState.Collapsed);
        item.contextValue = this.resourceType;
        return item;
    }
}