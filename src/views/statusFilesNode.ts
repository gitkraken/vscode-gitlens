'use strict';
import { Arrays, Iterables, Objects } from '../system';
import { ExtensionContext, TreeItem, TreeItemCollapsibleState, Uri } from 'vscode';
import { GitExplorerFilesLayout } from '../configuration';
import { ExplorerNode, ResourceType, ShowAllNode } from './explorerNode';
import { FolderNode, IFileExplorerNode } from './folderNode';
import { GitBranch, GitCommitType, GitLog, GitLogCommit, GitService, GitStatus, GitUri, IGitStatusFileWithCommit } from '../gitService';
import { StatusFileCommitsNode } from './statusFileCommitsNode';
import * as path from 'path';

export class StatusFilesNode extends ExplorerNode {

    readonly repoPath: string;
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
        this.repoPath = status.repoPath;
    }

    async getChildren(): Promise<ExplorerNode[]> {
        let statuses: IGitStatusFileWithCommit[] = [];

        const repoPath = this.repoPath;

        let log: GitLog | undefined;
        if (this.range !== undefined) {
            log = await this.git.getLogForRepo(repoPath, this.range, this.maxCount);
            if (log !== undefined) {
                statuses = Array.from(Iterables.flatMap(log.commits.values(), c => {
                    return c.fileStatuses.map(s => {
                        return { ...s, commit: c } as IGitStatusFileWithCommit;
                    });
                }));
            }
        }

        if (this.status.files.length !== 0 && this.includeWorkingTree) {
            statuses.splice(0, 0, ...this.status.files.map(s => {
                return {
                    ...s,
                    commit: new GitLogCommit(GitCommitType.File, repoPath, GitService.uncommittedSha, s.fileName, 'You', new Date(), '', s.status, [s], s.originalFileName, 'HEAD', s.fileName)
                } as IGitStatusFileWithCommit;
            }));
        }
        statuses.sort((a, b) => b.commit.date.getTime() - a.commit.date.getTime());

        const groups = Arrays.groupBy(statuses, s => s.fileName);

        let children: IFileExplorerNode[] = [
            ...Iterables.map(Objects.values(groups), statuses => new StatusFileCommitsNode(repoPath, statuses[statuses.length - 1], statuses.map(s => s.commit), this.context, this.git, this.branch))
        ];

        if (this.git.config.gitExplorer.files.layout !== GitExplorerFilesLayout.List) {
            const hierarchy = Arrays.makeHierarchical(children, n => n.uri.getRelativePath().split('/'),
                (...paths: string[]) => GitService.normalizePath(path.join(...paths)), this.git.config.gitExplorer.files.compact);

            const root = new FolderNode(repoPath, '', undefined, hierarchy, this.git.config.gitExplorer);
            children = await root.getChildren() as IFileExplorerNode[];
        }
        else {
            children.sort((a, b) => (a.priority ? -1 : 1) - (b.priority ? -1 : 1) || a.label!.localeCompare(b.label!));
        }

        if (log !== undefined && log.truncated) {
            (children as (IFileExplorerNode | ShowAllNode)[]).push(new ShowAllNode('Show All Changes', this, this.context));
        }
        return children;
    }

    async getTreeItem(): Promise<TreeItem> {
        let files = (this.status.files !== undefined && this.includeWorkingTree) ? this.status.files.length : 0;

        if (this.status.upstream !== undefined) {
            const stats = await this.git.getChangedFilesCount(this.repoPath, `${this.status.upstream}...`);
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