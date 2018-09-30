'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { ShowCommitSearchCommandArgs } from '../../commands';
import { GlyphChars } from '../../constants';
import { GitRepoSearchBy } from '../../git/gitService';
import { Strings } from '../../system';
import { ResultsExplorer } from '../resultsExplorer';
import { CommandMessageNode, MessageNode } from './common';
import { ExplorerNode, ResourceType, unknownGitUri } from './explorerNode';

export class ResultsNode extends ExplorerNode {
    private _children: (ExplorerNode | MessageNode)[] = [];

    constructor(
        public readonly explorer: ResultsExplorer
    ) {
        super(unknownGitUri, undefined);
    }

    async getChildren(): Promise<ExplorerNode[]> {
        if (this._children.length === 0) {
            const command = {
                title: 'Search Commits',
                command: 'gitlens.showCommitSearch'
            };

            return [
                new CommandMessageNode(
                    this,
                    {
                        ...command,
                        arguments: [this, { searchBy: GitRepoSearchBy.Message } as ShowCommitSearchCommandArgs]
                    },
                    `Start a commit search by`,
                    'Click to search'
                ),
                new CommandMessageNode(
                    this,
                    {
                        ...command,
                        arguments: [this, { searchBy: GitRepoSearchBy.Message } as ShowCommitSearchCommandArgs]
                    },
                    `${GlyphChars.Space.repeat(4)} message ${Strings.pad(GlyphChars.Dash, 1, 1)} use <message-pattern>`,
                    'Click to search by message'
                ),
                new CommandMessageNode(
                    this,
                    {
                        ...command,
                        arguments: [this, { searchBy: GitRepoSearchBy.Author } as ShowCommitSearchCommandArgs]
                    },
                    `${GlyphChars.Space.repeat(4)} author ${Strings.pad(GlyphChars.Dash, 1, 1)} use @<author-pattern>`,
                    'Click to search by author'
                ),
                new CommandMessageNode(
                    this,
                    {
                        ...command,
                        arguments: [this, { searchBy: GitRepoSearchBy.Sha } as ShowCommitSearchCommandArgs]
                    },
                    `${GlyphChars.Space.repeat(4)} commit id  ${Strings.pad(GlyphChars.Dash, 1, 1)} use #<sha>`,
                    'Click to search by commit id'
                ),
                new CommandMessageNode(
                    this,
                    {
                        ...command,
                        arguments: [this, { searchBy: GitRepoSearchBy.Files } as ShowCommitSearchCommandArgs]
                    },
                    `${GlyphChars.Space.repeat(4)} files ${Strings.pad(GlyphChars.Dash, 1, 1)} use :<file-pattern>`,
                    'Click to search by files'
                ),
                new CommandMessageNode(
                    this,
                    {
                        ...command,
                        arguments: [this, { searchBy: GitRepoSearchBy.Changes } as ShowCommitSearchCommandArgs]
                    },
                    `${GlyphChars.Space.repeat(4)} changes ${Strings.pad(GlyphChars.Dash, 1, 1)} use =<pattern>`,
                    'Click to search by changes'
                ),
                new CommandMessageNode(
                    this,
                    {
                        ...command,
                        arguments: [this, { searchBy: GitRepoSearchBy.ChangedLines } as ShowCommitSearchCommandArgs]
                    },
                    `${GlyphChars.Space.repeat(4)} changed lines ${Strings.pad(GlyphChars.Dash, 1, 1)} use ~<pattern>`,
                    'Click to search by changed lines'
                )
            ];
        }

        return this._children;
    }

    getTreeItem(): TreeItem {
        const item = new TreeItem(`Results`, TreeItemCollapsibleState.Expanded);
        item.contextValue = ResourceType.Results;
        return item;
    }

    addOrReplace(results: ExplorerNode, replace: boolean) {
        if (this._children.includes(results)) return;

        if (this._children.length !== 0 && replace) {
            this._children.length = 0;
            this._children.push(results);
        }
        else {
            this._children.splice(0, 0, results);
        }

        this.explorer.triggerNodeUpdate();
    }

    clear() {
        if (this._children.length === 0) return;

        this._children.length = 0;
        this.explorer.triggerNodeUpdate();
    }

    dismiss(node: ExplorerNode) {
        if (this._children.length === 0) return;

        const index = this._children.findIndex(n => n === node);
        if (index === -1) return;

        this._children.splice(index, 1);
        this.explorer.triggerNodeUpdate();
    }

    async refresh() {
        if (this._children.length === 0) return;

        this._children.forEach(c => c.refresh());
    }
}
