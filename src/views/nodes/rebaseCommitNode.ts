import { ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { CommitFormatter } from '../../git/formatters/commitFormatter';
import { ContextValues } from './abstract/viewNode';
import { CommitNode } from './commitNode';

export class RebaseCommitNode extends CommitNode {
	// eslint-disable-next-line @typescript-eslint/require-await
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
		item.iconPath = new ThemeIcon('debug-pause');

		return item;
	}

	protected override getTooltipTemplate(): string {
		return `Rebase paused at ${super.getTooltipTemplate()}`;
	}
}
