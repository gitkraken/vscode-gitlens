'use strict';
import { Arrays, Iterables, Objects } from '../system';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ExplorerFilesLayout } from '../configuration';
import { ExplorerNode, ResourceType, ShowAllNode } from './explorerNode';
import { FolderNode, IFileExplorerNode } from './folderNode';
import { GitExplorer } from './gitExplorer';
import { GitCommitType, GitLog, GitLogCommit, GitService, GitStatus, GitUri, IGitStatusFileWithCommit } from '../gitService';
import { StatusFileCommitsNode } from './statusFileCommitsNode';
import * as path from 'path';

export class StatusFilesNode extends ExplorerNode {

    readonly repoPath: string;
    readonly supportsPaging: boolean = true;

    constructor(
        public readonly status: GitStatus,
        public readonly range: string | undefined,
        private readonly explorer: GitExplorer
    ) {
        super(GitUri.fromRepoPath(status.repoPath));
        this.repoPath = status.repoPath;
    }

    async getChildren(): Promise<ExplorerNode[]> {
        let statuses: IGitStatusFileWithCommit[] = [];

        const repoPath = this.repoPath;

        let log: GitLog | undefined;
        if (this.range !== undefined) {
            log = await this.explorer.git.getLogForRepo(repoPath, { maxCount: this.maxCount, ref: this.range });
            if (log !== undefined) {
                statuses = Array.from(Iterables.flatMap(log.commits.values(), c => {
                    return c.fileStatuses.map(s => {
                        return { ...s, commit: c } as IGitStatusFileWithCommit;
                    });
                }));
            }
        }

        if (this.status.files.length !== 0 && this.includeWorkingTree) {
            statuses.splice(0, 0, ...Iterables.flatMap(this.status.files, s => {
                if (s.workTreeStatus !== undefined && s.indexStatus !== undefined) {
                    // Decrements the date to guarantee this entry will be sorted after the previous entry (most recent first)
                    const older = new Date();
                    older.setMilliseconds(older.getMilliseconds() - 1);

                    return [
                        {
                            ...s,
                            status: s.status,
                            commit: new GitLogCommit(GitCommitType.File, repoPath, GitService.uncommittedSha, 'You', undefined, new Date(), '', s.fileName, [s], s.status, s.originalFileName, GitService.stagedUncommittedSha, s.fileName)
                        } as IGitStatusFileWithCommit,
                        {
                            ...s,
                            status: s.status,
                            commit: new GitLogCommit(GitCommitType.File, repoPath, GitService.stagedUncommittedSha, 'You', undefined, older, '', s.fileName, [s], s.status, s.originalFileName, 'HEAD', s.fileName)
                        } as IGitStatusFileWithCommit
                    ];
                }
                else if (s.indexStatus !== undefined) {
                    return [
                        {
                            ...s,
                            status: s.status,
                            commit: new GitLogCommit(GitCommitType.File, repoPath, GitService.stagedUncommittedSha, 'You', undefined, new Date(), '', s.fileName, [s], s.status, s.originalFileName, 'HEAD', s.fileName)
                        } as IGitStatusFileWithCommit
                    ];
                }
                else {
                    return [
                        {
                            ...s,
                            status: s.status,
                            commit: new GitLogCommit(GitCommitType.File, repoPath, GitService.uncommittedSha, 'You', undefined, new Date(), '', s.fileName, [s], s.status, s.originalFileName, 'HEAD', s.fileName)
                        } as IGitStatusFileWithCommit
                    ];
                }
            }));
        }

        statuses.sort((a, b) => b.commit.date.getTime() - a.commit.date.getTime());

        const groups = Arrays.groupBy(statuses, s => s.fileName);

        let children: IFileExplorerNode[] = [
            ...Iterables.map(Objects.values(groups), statuses => new StatusFileCommitsNode(repoPath, statuses[statuses.length - 1], statuses.map(s => s.commit), this.explorer))
        ];

        if (this.explorer.config.files.layout !== ExplorerFilesLayout.List) {
            const hierarchy = Arrays.makeHierarchical(children, n => n.uri.getRelativePath().split('/'),
                (...paths: string[]) => GitService.normalizePath(path.join(...paths)), this.explorer.config.files.compact);

            const root = new FolderNode(repoPath, '', undefined, hierarchy, this.explorer);
            children = await root.getChildren() as IFileExplorerNode[];
        }
        else {
            children.sort((a, b) => (a.priority ? -1 : 1) - (b.priority ? -1 : 1) || a.label!.localeCompare(b.label!));
        }

        if (log !== undefined && log.truncated) {
            (children as (IFileExplorerNode | ShowAllNode)[]).push(new ShowAllNode('Show All Changes', this, this.explorer));
        }
        return children;
    }

    async getTreeItem(): Promise<TreeItem> {
        let files = (this.status.files !== undefined && this.includeWorkingTree) ? this.status.files.length : 0;

        if (this.status.upstream !== undefined) {
            const stats = await this.explorer.git.getChangedFilesCount(this.repoPath, `${this.status.upstream}...`);
            if (stats !== undefined) {
                files += stats.files;
            }
        }

        const label = `${files} file${files > 1 ? 's' : ''} changed`; // ${this.status.upstream === undefined ? '' : ` (ahead of ${this.status.upstream})`}`;
        const item = new TreeItem(label, TreeItemCollapsibleState.Collapsed);
        item.contextValue = ResourceType.StatusFiles;
        item.iconPath = {
            dark: this.explorer.context.asAbsolutePath(`images/dark/icon-diff.svg`),
            light: this.explorer.context.asAbsolutePath(`images/light/icon-diff.svg`)
        };

        return item;
    }

    private get includeWorkingTree(): boolean {
        return this.explorer.config.includeWorkingTree;
    }
}