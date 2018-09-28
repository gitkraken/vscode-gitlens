'use strict';
import * as path from 'path';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ExplorerFilesLayout } from '../../configuration';
import { Container } from '../../container';
import { GitStatusFile } from '../../git/git';
import {
    GitCommitType,
    GitFileWithCommit,
    GitLog,
    GitLogCommit,
    GitService,
    GitStatus,
    GitUri
} from '../../git/gitService';
import { Arrays, Iterables, Objects, Strings } from '../../system';
import { RepositoriesExplorer } from '../repositoriesExplorer';
import { ExplorerNode, ResourceType } from './explorerNode';
import { FileExplorerNode, FolderNode } from './folderNode';
import { StatusFileNode } from './statusFileNode';

export class StatusFilesNode extends ExplorerNode {
    readonly repoPath: string;

    constructor(
        public readonly status: GitStatus,
        public readonly range: string | undefined,
        parent: ExplorerNode,
        public readonly explorer: RepositoriesExplorer
    ) {
        super(GitUri.fromRepoPath(status.repoPath), parent);
        this.repoPath = status.repoPath;
    }

    get id(): string {
        return `gitlens:repository(${this.status.repoPath}):status:files`;
    }

    async getChildren(): Promise<ExplorerNode[]> {
        let files: GitFileWithCommit[] = [];

        const repoPath = this.repoPath;

        let log: GitLog | undefined;
        if (this.range !== undefined) {
            log = await Container.git.getLog(repoPath, { maxCount: 0, ref: this.range });
            if (log !== undefined) {
                files = [
                    ...Iterables.flatMap(log.commits.values(), c =>
                        c.files.map(s => ({ ...s, commit: c } as GitFileWithCommit))
                    )
                ];
            }
        }

        if (this.status.files.length !== 0 && this.includeWorkingTree) {
            files.splice(
                0,
                0,
                ...Iterables.flatMap(this.status.files, s => {
                    if (s.workingTreeStatus !== undefined && s.indexStatus !== undefined) {
                        // Decrements the date to guarantee this entry will be sorted after the previous entry (most recent first)
                        const older = new Date();
                        older.setMilliseconds(older.getMilliseconds() - 1);

                        return [
                            this.toStatusFile(s, GitService.uncommittedSha, GitService.stagedUncommittedSha),
                            this.toStatusFile(s, GitService.stagedUncommittedSha, 'HEAD', older)
                        ];
                    }
                    else if (s.indexStatus !== undefined) {
                        return [this.toStatusFile(s, GitService.stagedUncommittedSha, 'HEAD')];
                    }
                    else {
                        return [this.toStatusFile(s, GitService.uncommittedSha, 'HEAD')];
                    }
                })
            );
        }

        files.sort((a, b) => b.commit.date.getTime() - a.commit.date.getTime());

        const groups = Arrays.groupBy(files, s => s.fileName);

        let children: FileExplorerNode[] = [
            ...Iterables.map(
                Objects.values(groups),
                files =>
                    new StatusFileNode(repoPath, files[files.length - 1], files.map(s => s.commit), this, this.explorer)
            )
        ];

        if (this.explorer.config.files.layout !== ExplorerFilesLayout.List) {
            const hierarchy = Arrays.makeHierarchical(
                children,
                n => n.uri.getRelativePath().split('/'),
                (...paths: string[]) => Strings.normalizePath(path.join(...paths)),
                this.explorer.config.files.compact
            );

            const root = new FolderNode(repoPath, '', undefined, hierarchy, this, this.explorer);
            children = (await root.getChildren()) as FileExplorerNode[];
        }
        else {
            children.sort((a, b) => a.priority - b.priority || a.label!.localeCompare(b.label!));
        }

        return children;
    }

    async getTreeItem(): Promise<TreeItem> {
        let files = this.status.files !== undefined && this.includeWorkingTree ? this.status.files.length : 0;

        if (this.status.upstream !== undefined && this.status.state.ahead > 0) {
            if (files > 0) {
                const aheadFiles = await Container.git.getDiffStatus(this.repoPath, `${this.status.upstream}...`);
                if (aheadFiles !== undefined) {
                    const uniques = new Set();
                    for (const f of this.status.files) {
                        uniques.add(f.fileName);
                    }
                    for (const f of aheadFiles) {
                        uniques.add(f.fileName);
                    }

                    files = uniques.size;
                }
            }
            else {
                const stats = await Container.git.getChangedFilesCount(this.repoPath, `${this.status.upstream}...`);
                if (stats !== undefined) {
                    files += stats.files;
                }
            }
        }

        const label = `${Strings.pluralize('file', files)} changed`;
        const item = new TreeItem(label, TreeItemCollapsibleState.Collapsed);
        item.id = this.id;
        item.contextValue = ResourceType.StatusFiles;
        item.iconPath = {
            dark: Container.context.asAbsolutePath(`images/dark/icon-diff.svg`),
            light: Container.context.asAbsolutePath(`images/light/icon-diff.svg`)
        };

        return item;
    }

    private get includeWorkingTree(): boolean {
        return this.explorer.config.includeWorkingTree;
    }

    private toStatusFile(file: GitStatusFile, ref: string, previousRef: string, date?: Date): GitFileWithCommit {
        return {
            status: file.status,
            repoPath: file.repoPath,
            indexStatus: file.indexStatus,
            workingTreeStatus: file.workingTreeStatus,
            fileName: file.fileName,
            originalFileName: file.originalFileName,
            commit: new GitLogCommit(
                GitCommitType.File,
                file.repoPath,
                ref,
                'You',
                undefined,
                date || new Date(),
                date || new Date(),
                '',
                file.fileName,
                [file],
                file.status,
                file.originalFileName,
                previousRef,
                file.fileName
            )
        };
    }
}
