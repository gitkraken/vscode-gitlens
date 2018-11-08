'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ShowCommitSearchCommandArgs } from '../../commands';
import { GlyphChars } from '../../constants';
import { GitRepoSearchBy } from '../../git/gitService';
import { debug, Functions, gate, log } from '../../system';
import { View } from '../viewBase';
import { CommandMessageNode, MessageNode } from './common';
import { ResourceType, unknownGitUri, ViewNode } from './viewNode';

export class SearchNode extends ViewNode {
    private _children: (ViewNode | MessageNode)[] = [];

    constructor(view: View) {
        super(unknownGitUri, view);
    }

    async getChildren(): Promise<ViewNode[]> {
        if (this._children.length === 0) {
            const command = {
                title: ' ',
                command: 'gitlens.showCommitSearch'
            };

            return [
                new CommandMessageNode(
                    this.view,
                    this,
                    {
                        ...command,
                        arguments: [this, { searchBy: GitRepoSearchBy.Message } as ShowCommitSearchCommandArgs]
                    },
                    `Search commits by message (use &lt;message-pattern&gt;)`,
                    'Click to search commits by message'
                ),
                new CommandMessageNode(
                    this.view,
                    this,
                    {
                        ...command,
                        arguments: [this, { searchBy: GitRepoSearchBy.Author } as ShowCommitSearchCommandArgs]
                    },
                    `${GlyphChars.Space.repeat(4)} or, by author (use @&lt;author-pattern&gt;)`,
                    'Click to search commits by author'
                ),
                new CommandMessageNode(
                    this.view,
                    this,
                    {
                        ...command,
                        arguments: [this, { searchBy: GitRepoSearchBy.Sha } as ShowCommitSearchCommandArgs]
                    },
                    `${GlyphChars.Space.repeat(4)} or, by commit id (use #&lt;sha&gt;)`,
                    'Click to search commits by commit id'
                ),
                new CommandMessageNode(
                    this.view,
                    this,
                    {
                        ...command,
                        arguments: [this, { searchBy: GitRepoSearchBy.Files } as ShowCommitSearchCommandArgs]
                    },
                    `${GlyphChars.Space.repeat(4)} or, by files (use :&lt;file-pattern&gt;)`,
                    'Click to search commits by files'
                ),
                new CommandMessageNode(
                    this.view,
                    this,
                    {
                        ...command,
                        arguments: [this, { searchBy: GitRepoSearchBy.Changes } as ShowCommitSearchCommandArgs]
                    },
                    `${GlyphChars.Space.repeat(4)} or, by changes (use =&lt;pattern&gt;)`,
                    'Click to search commits by changes'
                ),
                new CommandMessageNode(
                    this.view,
                    this,
                    {
                        ...command,
                        arguments: [this, { searchBy: GitRepoSearchBy.ChangedLines } as ShowCommitSearchCommandArgs]
                    },
                    `${GlyphChars.Space.repeat(4)} or, by changed lines (use ~&lt;pattern&gt;)`,
                    'Click to search commits by changed lines'
                )
            ];
        }

        return this._children;
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(`Search`, TreeItemCollapsibleState.Expanded);
        item.contextValue = ResourceType.Results;
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

        await Promise.all(this._children.map(c => c.refresh()).filter(Functions.isPromise) as Promise<any>[]);
    }
}
