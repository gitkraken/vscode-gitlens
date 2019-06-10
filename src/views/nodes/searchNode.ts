'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { SearchCommitsCommandArgs } from '../../commands';
import { GlyphChars } from '../../constants';
import { GitRepoSearchBy } from '../../git/gitService';
import { debug, Functions, gate, Iterables, log } from '../../system';
import { View } from '../viewBase';
import { CommandMessageNode, MessageNode } from './common';
import { ResourceType, unknownGitUri, ViewNode } from './viewNode';

export class SearchNode extends ViewNode {
    private _children: (ViewNode | MessageNode)[] = [];

    constructor(view: View) {
        super(unknownGitUri, view);
    }

    getChildren(): ViewNode[] {
        if (this._children.length === 0) {
            const command = {
                title: ' ',
                command: 'gitlens.showCommitSearch'
            };

            const getCommandArgs = (searchBy: GitRepoSearchBy): SearchCommitsCommandArgs => {
                return {
                    searchBy: searchBy
                };
            };

            return [
                new CommandMessageNode(
                    this.view,
                    this,
                    {
                        ...command,
                        arguments: [this, getCommandArgs(GitRepoSearchBy.Message)]
                    },
                    'Search commits by message',
                    'message-pattern',
                    'Click to search commits by message'
                ),
                new CommandMessageNode(
                    this.view,
                    this,
                    {
                        ...command,
                        arguments: [this, getCommandArgs(GitRepoSearchBy.Author)]
                    },
                    `${GlyphChars.Space.repeat(4)} or, by author`,
                    '@ author-pattern',
                    'Click to search commits by author'
                ),
                new CommandMessageNode(
                    this.view,
                    this,
                    {
                        ...command,
                        arguments: [this, getCommandArgs(GitRepoSearchBy.Sha)]
                    },
                    `${GlyphChars.Space.repeat(4)} or, by commit id`,
                    '# sha',
                    'Click to search commits by commit id'
                ),
                new CommandMessageNode(
                    this.view,
                    this,
                    {
                        ...command,
                        arguments: [this, getCommandArgs(GitRepoSearchBy.Files)]
                    },
                    `${GlyphChars.Space.repeat(4)} or, by files`,
                    ': file-path/glob',
                    'Click to search commits by files'
                ),
                new CommandMessageNode(
                    this.view,
                    this,
                    {
                        ...command,
                        arguments: [this, getCommandArgs(GitRepoSearchBy.Changes)]
                    },
                    `${GlyphChars.Space.repeat(4)} or, by changes`,
                    '~ pattern',
                    'Click to search commits by changes'
                )
            ];
        }

        return this._children;
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem('Search', TreeItemCollapsibleState.Expanded);
        item.contextValue = ResourceType.Search;
        return item;
    }

    addOrReplace(results: ViewNode, replace: boolean) {
        if (this._children.includes(results)) return;

        if (this._children.length !== 0 && replace) {
            this._children.length = 0;
            this._children.push(results);
        }
        else {
            this._children.splice(0, 0, results);
        }

        this.view.triggerNodeChange();
    }

    @log()
    clear() {
        if (this._children.length === 0) return;

        this._children.length = 0;
        this.view.triggerNodeChange();
    }

    @log({
        args: { 0: (n: ViewNode) => n.toString() }
    })
    dismiss(node: ViewNode) {
        if (this._children.length === 0) return;

        const index = this._children.findIndex(n => n === node);
        if (index === -1) return;

        this._children.splice(index, 1);
        this.view.triggerNodeChange();
    }

    @gate()
    @debug()
    async refresh() {
        if (this._children.length === 0) return;

        const promises: Promise<any>[] = [
            ...Iterables.filterMap(this._children, c => {
                const result = c.refresh === undefined ? false : c.refresh();
                return Functions.isPromise<boolean | void>(result) ? result : undefined;
            })
        ];
        await Promise.all(promises);
    }
}
