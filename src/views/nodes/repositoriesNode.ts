'use strict';
import { Disposable, ProgressLocation, TextEditor, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import { Container } from '../../container';
import { GitUri } from '../../git/gitService';
import { Logger } from '../../logger';
import { Functions } from '../../system';
import { RefreshReason } from '../explorer';
import { RepositoriesExplorer } from '../repositoriesExplorer';
import { MessageNode } from './common';
import { ExplorerNode, ResourceType, SubscribeableExplorerNode, unknownGitUri } from './explorerNode';
import { RepositoryNode } from './repositoryNode';

export class RepositoriesNode extends SubscribeableExplorerNode<RepositoriesExplorer> {
    private _children: (RepositoryNode | MessageNode)[] | undefined;

    constructor(explorer: RepositoriesExplorer) {
        super(unknownGitUri, undefined, explorer);
    }

    dispose() {
        super.dispose();

        if (this._children !== undefined) {
            for (const child of this._children) {
                if (child instanceof RepositoryNode) {
                    child.dispose();
                }
            }
            this._children = undefined;
        }
    }

    async getChildren(): Promise<ExplorerNode[]> {
        if (this._children === undefined) {
            const repositories = [...(await Container.git.getRepositories())];
            if (repositories.length === 0) return [new MessageNode(this, 'No repositories found')];

            const children = [];
            for (const repo of repositories.sort((a, b) => a.index - b.index)) {
                if (repo.closed) continue;

                children.push(new RepositoryNode(GitUri.fromRepoPath(repo.path), repo, this, this.explorer));
            }

            this._children = children;
        }

        return this._children;
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(`Repositories`, TreeItemCollapsibleState.Expanded);
        item.contextValue = ResourceType.Repositories;

        void this.ensureSubscription();

        return item;
    }

    async fetchAll() {
        if (this._children === undefined || this._children.length === 0) return;

        const children = this._children;
        await window.withProgress(
            {
                location: ProgressLocation.Notification,
                title: `Fetching repositories`,
                cancellable: false
            },
            async progress => {
                const total = children.length + 1;
                let i = 0;
                for (const node of children) {
                    if (node instanceof MessageNode) continue;

                    i++;
                    progress.report({
                        message: `${node.repo.formattedName}...`,
                        increment: (i / total) * 100
                    });

                    await node.fetch(false);
                }
            }
        );
    }

    async pullAll() {
        if (this._children === undefined || this._children.length === 0) return;

        const children = this._children;
        await window.withProgress(
            {
                location: ProgressLocation.Notification,
                title: `Pulling repositories`,
                cancellable: false
            },
            async progress => {
                const total = children.length + 1;
                let i = 0;
                for (const node of children) {
                    if (node instanceof MessageNode) continue;

                    i++;
                    progress.report({
                        message: `${node.repo.formattedName}...`,
                        increment: (i / total) * 100
                    });

                    await node.pull(false);
                }
            }
        );
    }

    async refresh(reason?: RefreshReason) {
        if (this._children === undefined) return;

        const repositories = [...(await Container.git.getRepositories())];
        if (repositories.length === 0 && (this._children === undefined || this._children.length === 0)) return;

        if (repositories.length === 0) {
            this._children = [new MessageNode(this, 'No repositories found')];
            return;
        }

        const children = [];
        for (const repo of repositories.sort((a, b) => a.index - b.index)) {
            const normalizedPath = repo.normalizedPath;
            const child = (this._children as RepositoryNode[]).find(c => c.repo.normalizedPath === normalizedPath);
            if (child !== undefined) {
                children.push(child);
                child.refresh();
            }
            else {
                children.push(new RepositoryNode(GitUri.fromRepoPath(repo.path), repo, this, this.explorer));
            }
        }

        for (const child of this._children as RepositoryNode[]) {
            if (children.includes(child)) continue;

            child.dispose();
        }

        this._children = children;

        // Reset our subscription if the configuration changed
        if (reason === RefreshReason.ConfigurationChanged) {
            this.unsubscribe();
        }

        void this.ensureSubscription();
    }

    protected async subscribe() {
        const subscriptions = [Container.git.onDidChangeRepositories(this.onRepositoriesChanged, this)];

        if (this.explorer.config.autoReveal) {
            subscriptions.push(
                window.onDidChangeActiveTextEditor(Functions.debounce(this.onActiveEditorChanged, 500), this)
            );
        }

        return Disposable.from(...subscriptions);
    }

    private async onActiveEditorChanged(editor: TextEditor | undefined) {
        if (editor == null || this._children === undefined || this._children.length === 1) {
            return;
        }

        try {
            const uri = editor.document.uri;
            const gitUri = await Container.git.getVersionedUri(uri);

            const node = this._children.find(n => n instanceof RepositoryNode && n.repo.containsUri(gitUri || uri)) as
                | RepositoryNode
                | undefined;
            if (node === undefined) return;

            // Check to see if this repo has a descendent that is already selected
            let parent = this.explorer.selection.length === 0 ? undefined : this.explorer.selection[0];
            while (parent !== undefined) {
                if (parent === node) return;

                parent = parent.getParent();
            }

            // HACK: Since we have no expand/collapse api, reveal the first child to force an expand
            // See https://github.com/Microsoft/vscode/issues/55879
            const children = await node.getChildren();
            await this.explorer.reveal(children !== undefined && children.length !== 0 ? children[0] : node);
        }
        catch (ex) {
            Logger.error(ex);
        }
    }

    private onRepositoriesChanged() {
        void this.explorer.refreshNode(this);
    }
}
