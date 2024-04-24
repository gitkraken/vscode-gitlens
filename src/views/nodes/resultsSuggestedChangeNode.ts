import type { TreeItemCheckboxState } from 'vscode';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GitUri } from '../../git/gitUri';
import type { View } from '../viewBase';
import { ContextValues, ViewNode } from './abstract/viewNode';
import type { Draft } from '../../gk/models/drafts';

type State = {
	checked: TreeItemCheckboxState;
};

export class ResultsSuggestedChangeNode extends ViewNode<'results-suggested-change', View, State> {
	constructor(view: View, parent: ViewNode, repoPath: string, draft: Draft) {
		super('results-suggested-change', GitUri.fromRepoPath(repoPath), view, parent);

		this.updateContext({ draft: draft });
		this._uniqueId = draft.id;
	}

	getChildren(): ViewNode[] {
		return [];
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(this.label || 'a draft', TreeItemCollapsibleState.None);
		item.contextValue = ContextValues.ResultsFile;
		item.description = this.description;
		return item;
	}

	private _description: string | undefined;
	get description() {
		if (this._description === undefined) {
			this._description = this.context.draft?.description;
		}
		return this._description;
	}

	private _label: string | undefined;
	get label() {
		if (this._label === undefined) {
			this._label = this.context.draft?.title;
		}
		return this._label;
	}
}
