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
import { debug, Iterables } from '../../system';
import { View } from '../viewBase';
import { CommitFileNode, CommitFileNodeDisplayAs } from './commitFileNode';
import { MessageNode } from './common';
import { insertDateMarkers } from './helpers';
import { ResourceType, SubscribeableViewNode, ViewNode } from './viewNode';

export class LineHistoryNode extends SubscribeableViewNode {
    constructor(
        uri: GitUri,
        view: View,
        parent: ViewNode,
        public readonly selection: Selection
    ) {
        super(uri, view, parent);
    }

    async getChildren(): Promise<ViewNode[]> {
        const children: ViewNode[] = [];

        const displayAs =
            CommitFileNodeDisplayAs.CommitLabel |
            (this.view.config.avatars ? CommitFileNodeDisplayAs.Gravatar : CommitFileNodeDisplayAs.StatusIcon);

        const log = await Container.git.getLogForFile(this.uri.repoPath, this.uri.fsPath, {
            ref: this.uri.sha,
            range: this.selection
        });
        if (log !== undefined) {
            children.push(
                ...insertDateMarkers(
                    Iterables.filterMap(
                        log.commits.values(),
                        c => new CommitFileNode(this.view, this, c.files[0], c, displayAs, this.selection)
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

                children.splice(0, 0, new CommitFileNode(this.view, this, file, commit, displayAs, this.selection));
            }
        }

        if (children.length === 0) return [new MessageNode(this.view, this, 'No line history could be found.')];
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
        item.contextValue = ResourceType.LineHistory;
        item.tooltip = `History of ${this.uri.getFilename()}${lines}\n${this.uri.getDirectory()}/${
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

        Logger.log(`LineHistoryNode.onRepoChanged(${e.changes.join()}); triggering node refresh`);

        void this.triggerChange();
    }

    private onRepoFileSystemChanged(e: RepositoryFileSystemChangeEvent) {
        if (!e.uris.some(uri => uri.toString(true) === this.uri.toString(true))) return;

        Logger.debug(`LineHistoryNode.onRepoFileSystemChanged(${this.uri.toString(true)}); triggering node refresh`);

        void this.triggerChange();
    }
}
