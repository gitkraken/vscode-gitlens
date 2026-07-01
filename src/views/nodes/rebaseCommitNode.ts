import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { CommitFormatter } from '../../git/formatters/commitFormatter.js';
import { ContextValues } from './abstract/viewNode.js';
import { CommitNode } from './commitNode.js';

export class RebaseCommitNode extends CommitNode {
	// oxlint-disable-next-line typescript/require-await
	override async getTreeItem(): Promise<TreeItem> {
		const item = new TreeItem(
			`Paused at commit ${this.commit.shortSha}`,
			this._options.expand ? TreeItemCollapsibleState.Expanded : TreeItemCollapsibleState.Collapsed,
		);
		item.id = this.id;
		item.contextValue = `${ContextValues.Commit}+rebase`;
		item.description = CommitFormatter.fromTemplate(`\${message}`, this.commit, {
			messageTruncateAtNewLine: true,
		});
		item.iconPath = new ThemeIcon('gitlens-pause');

		return item;
	}

	protected override getTooltipTemplate(): string {
		return `Rebase paused at ${super.getTooltipTemplate()}`;
	}
}
