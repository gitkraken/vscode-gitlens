'use strict';
import { Disposable, TextEditor, TreeItem, TreeItemCollapsibleState, window } from 'vscode';
import { Container } from '../../container';
import { GitUri } from '../../git/gitService';
import { Logger } from '../../logger';
import { Functions } from '../../system';
import { GitExplorer } from '../gitExplorer';
import { MessageNode } from './common';
import { ExplorerNode, ResourceType, SubscribeableExplorerNode, unknownGitUri } from './explorerNode';
import { RepositoryNode } from './repositoryNode';

export class RepositoriesNode extends SubscribeableExplorerNode<GitExplorer> {
    private _children: (RepositoryNode | MessageNode)[] | undefined;

    constructor(explorer: GitExplorer) {
        super(unknownGitUri, explorer);
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
            if (repositories.length === 0) return [new MessageNode('No repositories found')];

            const children = [];
            for (const repo of repositories.sort((a, b) => a.index - b.index)) {
                if (repo.closed) continue;

                children.push(new RepositoryNode(GitUri.fromRepoPath(repo.path), repo, this.explorer));
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

        for (const node of this._children) {
            if (node instanceof MessageNode) continue;

            await node.fetch();
        }
    }

    async refresh() {
        if (this._children === undefined) return;

        const repositories = [...(await Container.git.getRepositories())];
        if (repositories.length === 0 && (this._children === undefined || this._children.length === 0)) return;

        if (repositories.length === 0) {
            this._children = [new MessageNode('No repositories found')];
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
                children.push(new RepositoryNode(GitUri.fromRepoPath(repo.path), repo, this.explorer));
            }
        }

        for (const child of this._children as RepositoryNode[]) {
            if (children.includes(child)) continue;

            child.dispose();
        }

        this._children = children;
        void this.ensureSubscription();
    }

    protected async subscribe() {
        return Disposable.from(
            window.onDidChangeActiveTextEditor(Functions.debounce(this.onActiveEditorChanged, 500), this),
            Container.git.onDidChangeRepositories(this.onRepositoriesChanged, this)
        );
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
