'use strict';
import { Disposable, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Container } from '../../container';
import {
    GitCommitType,
    GitLogCommit,
    GitService,
    GitUri,
    RepositoryChange,
    RepositoryChangeEvent,
    RepositoryFileSystemChangeEvent
} from '../../git/gitService';
import { Logger } from '../../logger';
import { debug, Iterables } from '../../system';
import { View } from '../viewBase';
import { CommitFileNode } from './commitFileNode';
import { MessageNode, ShowMoreNode } from './common';
import { insertDateMarkers } from './helpers';
import { PageableViewNode, ResourceType, SubscribeableViewNode, ViewNode } from './viewNode';

export class FileHistoryNode extends SubscribeableViewNode implements PageableViewNode {
    readonly supportsPaging = true;
    maxCount: number | undefined;

    constructor(uri: GitUri, view: View, parent: ViewNode) {
        super(uri, view, parent);
    }

    toClipboard(): string {
        return this.uri.fileName;
    }

    async getChildren(): Promise<ViewNode[]> {
        const children: ViewNode[] = [];

        if (this.uri.sha === undefined) {
            const status = await Container.git.getStatusForFile(this.uri.repoPath!, this.uri.fsPath);
            if (status !== undefined && (status.indexStatus !== undefined || status.workingTreeStatus !== undefined)) {
                let sha;
                let previousSha;
                if (status.workingTreeStatus !== undefined) {
                    sha = GitService.uncommittedSha;
                    if (status.indexStatus !== undefined) {
                        previousSha = GitService.uncommittedStagedSha;
                    }
                    else if (status.workingTreeStatus !== '?') {
                        previousSha = 'HEAD';
                    }
                }
                else {
                    sha = GitService.uncommittedStagedSha;
                    previousSha = 'HEAD';
                }

                const user = await Container.git.getCurrentUser(this.uri.repoPath!);
                const commit = new GitLogCommit(
                    GitCommitType.LogFile,
                    this.uri.repoPath!,
                    sha,
                    'You',
                    user !== undefined ? user.email : undefined,
                    new Date(),
                    new Date(),
                    '',
                    status.fileName,
                    [status],
                    status.status,
                    status.originalFileName,
                    previousSha,
                    status.originalFileName || status.fileName
                );
                children.push(
                    new CommitFileNode(this.view, this, status, commit, { displayAsCommit: true, inFileHistory: true })
                );
            }
        }

        const log = await Container.git.getLogForFile(this.uri.repoPath, this.uri.fsPath, {
            maxCount: this.maxCount !== undefined ? this.maxCount : undefined,
            ref: this.uri.sha
        });
        if (log !== undefined) {
            children.push(
                ...insertDateMarkers(
                    Iterables.map(
                        log.commits.values(),
                        c =>
                            new CommitFileNode(this.view, this, c.files[0], c, {
                                displayAsCommit: true,
                                inFileHistory: true
                            })
                    ),
                    this
                )
            );

            if (log.truncated) {
                children.push(
                    new ShowMoreNode(this.view, this, 'Commits', log.maxCount, children[children.length - 1])
                );
            }
        }

        if (children.length === 0) return [new MessageNode(this.view, this, 'No file history could be found.')];
        return children;
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(
            `${this.uri.fileName}${
                this.uri.sha
                    ? ` ${
                          this.uri.sha === GitService.deletedOrMissingSha ? this.uri.shortSha : `(${this.uri.shortSha})`
                      }`
                    : ''
            }`,
            TreeItemCollapsibleState.Expanded
        );
        item.contextValue = ResourceType.FileHistory;
        item.description = this.uri.directory;
        item.tooltip = `History of ${this.uri.fileName}\n${this.uri.directory}/${
            this.uri.sha === undefined ? '' : `\n\n${this.uri.sha}`
        }`;

        item.iconPath = {
            dark: Container.context.asAbsolutePath('images/dark/icon-history.svg'),
            light: Container.context.asAbsolutePath('images/light/icon-history.svg')
        };

        void this.ensureSubscription();

        return item;
    }

    @debug()
    protected async subscribe() {
        const repo = await Container.git.getRepository(this.uri);
        if (repo === undefined) return undefined;

        const subscription = Disposable.from(
            repo.onDidChange(this.onRepoChanged, this),
            repo.onDidChangeFileSystem(this.onRepoFileSystemChanged, this),
            { dispose: () => repo.stopWatchingFileSystem() }
        );

        repo.startWatchingFileSystem();

        return subscription;
    }

    private onRepoChanged(e: RepositoryChangeEvent) {
        if (!e.changed(RepositoryChange.Repository)) return;

        Logger.log(`FileHistoryNode.onRepoChanged(${e.changes.join()}); triggering node refresh`);

        void this.triggerChange();
    }

    private onRepoFileSystemChanged(e: RepositoryFileSystemChangeEvent) {
        if (!e.uris.some(uri => uri.toString(true) === this.uri.toString(true))) return;

        Logger.debug(
            `FileHistoryNode${this.id}.onRepoFileSystemChanged(${this.uri.toString(true)}); triggering node refresh`
        );

        void this.triggerChange();
    }
}
