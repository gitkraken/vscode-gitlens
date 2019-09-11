'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { SearchCommitsCommandArgs } from '../../commands';
import { GlyphChars } from '../../constants';
import { debug, gate, Iterables, log, Promises } from '../../system';
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

			const getCommandArgs = (
				search: '' | 'author:' | 'change:' | 'commit:' | 'file:'
			): SearchCommitsCommandArgs => {
				return {
					search: { pattern: search },
					prefillOnly: true
				};
			};

			return [
				new CommandMessageNode(
					this.view,
					this,
					{
						...command,
						arguments: [this, getCommandArgs('')]
					},
					'Search by Message',
					`pattern ${GlyphChars.Dash} use quotes to search for phrases`,
					`Click to search for commits with matching messages ${GlyphChars.Dash} use quotes to search for phrases`
				),
				new CommandMessageNode(
					this.view,
					this,
					{
						...command,
						arguments: [this, getCommandArgs('author:')]
					},
					`${GlyphChars.Space.repeat(4)} or, Author or Committer`,
					'author: pattern',
					'Click to search for commits with matching authors or committers'
				),
				new CommandMessageNode(
					this.view,
					this,
					{
						...command,
						arguments: [this, getCommandArgs('commit:')]
					},
					`${GlyphChars.Space.repeat(4)} or, Commit ID`,
					'commit: sha',
					'Click to search for commits with matching commit ids'
				),
				new CommandMessageNode(
					this.view,
					this,
					{
						...command,
						arguments: [this, getCommandArgs('file:')]
					},
					`${GlyphChars.Space.repeat(4)} or, Files`,
					'file: glob',
					'Click to search for commits with matching files'
				),
				new CommandMessageNode(
					this.view,
					this,
					{
						...command,
						arguments: [this, getCommandArgs('change:')]
					},
					`${GlyphChars.Space.repeat(4)} or, Changes`,
					'change: pattern',
					'Click to search for commits with matching changes'
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
		} else {
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
				return Promises.is<boolean | void>(result) ? result : undefined;
			})
		];
		await Promise.all(promises);
	}
}
