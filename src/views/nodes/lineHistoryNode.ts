'use strict';
import { Disposable, Selection, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Container } from '../../container';
import { GitCommitType, GitFile, GitLogCommit } from '../../git/git';
import {
    GitService,
    GitUri,
    RepositoryChange,
    RepositoryChangeEvent,
    RepositoryFileSystemChangeEvent
} from '../../git/gitService';
import { Logger } from '../../logger';
import { Iterables } from '../../system';
import { LineHistoryExplorer } from '../lineHistoryExplorer';
import { CommitFileNode, CommitFileNodeDisplayAs } from './commitFileNode';
import { MessageNode } from './common';
import { ExplorerNode, ResourceType, SubscribeableExplorerNode } from './explorerNode';
import { insertDateMarkers } from './helpers';

export class LineHistoryNode extends SubscribeableExplorerNode<LineHistoryExplorer> {
    constructor(
        uri: GitUri,
        public readonly selection: Selection,
        parent: ExplorerNode,
        explorer: LineHistoryExplorer
    ) {
        super(uri, parent, explorer);
    }

    async getChildren(): Promise<ExplorerNode[]> {
        const children: ExplorerNode[] = [];

        const displayAs =
            CommitFileNodeDisplayAs.CommitLabel |
            (this.explorer.config.avatars ? CommitFileNodeDisplayAs.Gravatar : CommitFileNodeDisplayAs.StatusIcon);

        const log = await Container.git.getLogForFile(this.uri.repoPath, this.uri.fsPath, {
            ref: this.uri.sha,
            range: this.selection
        });
        if (log !== undefined) {
            children.push(
                ...insertDateMarkers(
                    Iterables.filterMap(
                        log.commits.values(),
                        c => new CommitFileNode(c.files[0], c, this, this.explorer, displayAs, this.selection)
                    ),
                    this
                )
            );
        }

        const blame = await Container.git.getBlameForLine(this.uri, this.selection.active.line);
        if (blame !== undefined) {
            let first = children[0] as CommitFileNode | undefined;
            if (first !== undefined && !(first instanceof CommitFileNode)) {
                first = children[1] as CommitFileNode | undefined;
            }

            if (first === undefined || first.commit.sha !== blame.commit.sha) {
                const file: GitFile = {
                    fileName: blame.commit.fileName,
                    indexStatus: '?',
                    originalFileName: blame.commit.originalFileName,
                    repoPath: this.uri.repoPath!,
                    status: 'M',
                    workingTreeStatus: '?'
                };

                const commit = new GitLogCommit(
                    GitCommitType.File,
                    this.uri.repoPath!,
                    blame.commit.sha,
                    'You',
                    blame.commit.email,
                    blame.commit.date,
                    // TODO: Add committed date to blame?
                    blame.commit.date,
                    blame.commit.message,
                    blame.commit.fileName,
                    [file],
                    'M',
                    blame.commit.originalFileName,
                    blame.commit.previousSha,
                    blame.commit.originalFileName || blame.commit.fileName
                );

                children.splice(0, 0, new CommitFileNode(file, commit, this, this.explorer, displayAs, this.selection));
            }
        }

        if (children.length === 0) return [new MessageNode(this, 'No line history')];
        return children;
    }

    getTreeItem(): TreeItem {
        const lines = this.selection.isSingleLine
            ? ` #${this.selection.start.line + 1}`
            : ` #${this.selection.start.line + 1}-${this.selection.end.line + 1}`;
        const item = new TreeItem(
            `${this.uri.getFormattedPath({
                suffix: `${lines}${
                    this.uri.sha
                        ? ` ${
                              this.uri.sha === GitService.deletedOrMissingSha
                                  ? this.uri.shortSha
                                  : `(${this.uri.shortSha})`
                          }`
                        : ''
                }`
            })}`,
            TreeItemCollapsibleState.Expanded
        );
        item.contextValue = ResourceType.FileHistory;
        item.tooltip = `History of ${this.uri.getFilename()}${lines}\n${this.uri.getDirectory()}/`;

        item.iconPath = {
            dark: Container.context.asAbsolutePath('images/dark/icon-history.svg'),
            light: Container.context.asAbsolutePath('images/light/icon-history.svg')
        };

        void this.ensureSubscription();

        return item;
    }

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

        Logger.log(`LineHistoryNode.onRepoChanged(${e.changes.join()}); triggering node refresh`);

        void this.explorer.refreshNode(this);
    }

    private onRepoFileSystemChanged(e: RepositoryFileSystemChangeEvent) {
        if (!e.uris.some(uri => uri.toString(true) === this.uri.toString(true))) return;

        Logger.log(`LineHistoryNode.onRepoFileSystemChanged; triggering node refresh`);

        void this.explorer.refreshNode(this);
    }
}
