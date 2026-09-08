import { l10n, MarkdownString, ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { escapeMarkdown } from '@gitlens/utils/markdown.js';
import type { Colors } from '../../constants.colors.js';
import { unknownGitUri } from '../../git/gitUri.js';
import type {
	CloudWorkspace,
	CloudWorkspaceRepositoryDescriptor,
} from '../../plus/workspaces/models/cloudWorkspace.js';
import type {
	LocalWorkspace,
	LocalWorkspaceRepositoryDescriptor,
} from '../../plus/workspaces/models/localWorkspace.js';
import { createViewDecorationUri } from '../viewDecorationProvider.js';
import type { WorkspacesView } from '../workspacesView.js';
import { ContextValues, getViewNodeId, ViewNode } from './abstract/viewNode.js';

export class WorkspaceMissingRepositoryNode extends ViewNode<'workspace-missing-repository', WorkspacesView> {
	constructor(
		view: WorkspacesView,
		parent: ViewNode,
		public readonly workspace: CloudWorkspace | LocalWorkspace,
		public readonly wsRepositoryDescriptor: CloudWorkspaceRepositoryDescriptor | LocalWorkspaceRepositoryDescriptor,
	) {
		super('workspace-missing-repository', unknownGitUri, view, parent);

		this.updateContext({ wsRepositoryDescriptor: wsRepositoryDescriptor });
		this._uniqueId = getViewNodeId(this.type, this.context);
	}

	override get id(): string {
		return this._uniqueId;
	}

	override toClipboard(): string {
		return this.name;
	}

	get name(): string {
		return this.wsRepositoryDescriptor.name;
	}

	get workspaceId(): string {
		return this.wsRepositoryDescriptor.workspaceId;
	}

	getChildren(): ViewNode[] {
		return [];
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(this.name, TreeItemCollapsibleState.None);
		item.id = this.id;
		item.description = l10n.t('missing');
		const tooltip = new MarkdownString();
		tooltip.appendMarkdown(escapeMarkdown(this.name));
		tooltip.appendMarkdown('\n\n');
		tooltip.appendMarkdown(escapeMarkdown(l10n.t('Repository could not be found')));
		item.tooltip = tooltip;
		item.contextValue = ContextValues.WorkspaceMissingRepository;
		item.iconPath = new ThemeIcon(
			'question',
			new ThemeColor('gitlens.decorations.workspaceRepoMissingForegroundColor' satisfies Colors),
		);
		item.resourceUri = createViewDecorationUri('repository', { state: 'missing', workspace: true });

		return item;
	}
}
