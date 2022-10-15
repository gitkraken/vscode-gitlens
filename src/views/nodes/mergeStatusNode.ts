import { MarkdownString, ThemeColor, ThemeIcon, TreeItem, TreeItemCollapsibleState } from 'vscode';
import * as nls from 'vscode-nls';
import { ViewFilesLayout } from '../../configuration';
import { GitUri } from '../../git/gitUri';
import type { GitBranch } from '../../git/models/branch';
import type { GitMergeStatus } from '../../git/models/merge';
import { GitReference } from '../../git/models/reference';
import type { GitStatus } from '../../git/models/status';
import { makeHierarchical } from '../../system/array';
import { joinPaths, normalizePath } from '../../system/path';
import { sortCompare } from '../../system/string';
import type { ViewsWithCommits } from '../viewBase';
import { BranchNode } from './branchNode';
import type { FileNode } from './folderNode';
import { FolderNode } from './folderNode';
import { MergeConflictFileNode } from './mergeConflictFileNode';
import { ContextValues, ViewNode } from './viewNode';

const localize = nls.loadMessageBundle();
export class MergeStatusNode extends ViewNode<ViewsWithCommits> {
	static key = ':merge';
	static getId(repoPath: string, name: string, root: boolean): string {
		return `${BranchNode.getId(repoPath, name, root)}${this.key}`;
	}

	constructor(
		view: ViewsWithCommits,
		parent: ViewNode,
		public readonly branch: GitBranch,
		public readonly mergeStatus: GitMergeStatus,
		public readonly status: GitStatus | undefined,
		// Specifies that the node is shown as a root
		public readonly root: boolean,
	) {
		super(GitUri.fromRepoPath(mergeStatus.repoPath), view, parent);
	}

	override get id(): string {
		return MergeStatusNode.getId(this.mergeStatus.repoPath, this.mergeStatus.current.name, this.root);
	}

	get repoPath(): string {
		return this.uri.repoPath!;
	}

	getChildren(): ViewNode[] {
		if (this.status?.hasConflicts !== true) return [];

		let children: FileNode[] = this.status.conflicts.map(
			f => new MergeConflictFileNode(this.view, this, f, this.mergeStatus),
		);

		if (this.view.config.files.layout !== ViewFilesLayout.List) {
			const hierarchy = makeHierarchical(
				children,
				n => n.uri.relativePath.split('/'),
				(...parts: string[]) => normalizePath(joinPaths(...parts)),
				this.view.config.files.compact,
			);

			const root = new FolderNode(this.view, this, this.repoPath, '', hierarchy);
			children = root.getChildren() as FileNode[];
		} else {
			children.sort((a, b) => sortCompare(a.label!, b.label!));
		}

		return children;
	}

	getTreeItem(): TreeItem {
		const item = new TreeItem(
			this.status?.hasConflicts
				? this.mergeStatus.incoming != null
					? localize(
							'resolveConflictsBeforeMergingBranchIntoBranch',
							'Resolve conflicts before merging {0} into {1}',
							GitReference.toString(this.mergeStatus.incoming, { expand: false, icon: false }),
							GitReference.toString(this.mergeStatus.current, { expand: false, icon: false }),
					  )
					: localize(
							'resolveConflictsBeforeMergingIntoBranch',
							'Resolve conflicts before merging into {0}',
							GitReference.toString(this.mergeStatus.current, { expand: false, icon: false }),
					  )
				: this.mergeStatus.incoming != null
				? localize(
						'mergingBranchIntoBranch',
						'Merging {0} into {1}',
						GitReference.toString(this.mergeStatus.incoming, { expand: false, icon: false }),
						GitReference.toString(this.mergeStatus.current, { expand: false, icon: false }),
				  )
				: localize(
						'mergingIntoBranch',
						'Merging into {0}',
						GitReference.toString(this.mergeStatus.current, { expand: false, icon: false }),
				  ),
			TreeItemCollapsibleState.Expanded,
		);
		item.id = this.id;
		item.contextValue = ContextValues.Merge;
		item.description = this.status?.hasConflicts
			? this.status.conflicts.length === 1
				? localize('oneConflict', '1 conflict')
				: localize('conflicts', '{0} conflicts', this.status.conflicts.length)
			: undefined;
		item.iconPath = this.status?.hasConflicts
			? new ThemeIcon('warning', new ThemeColor('list.warningForeground'))
			: new ThemeIcon('debug-pause', new ThemeColor('list.foreground'));

		const markdown = new MarkdownString(
			`${
				this.mergeStatus.incoming != null
					? localize(
							'mergingBranchIntoBranch',
							'Merging {0} into {1}',
							GitReference.toString(this.mergeStatus.incoming),
							GitReference.toString(this.mergeStatus.current),
					  )
					: localize('mergingIntoBranch', 'Merging into {0}', GitReference.toString(this.mergeStatus.current))
			}
			${
				this.status?.hasConflicts
					? `\n\n${
							this.status.conflicts.length === 1
								? localize('oneConflictedFile', '1 conflicted file')
								: localize('conflictedFiles', '{0} conflicted files', this.status.conflicts.length)
					  }`
					: ''
			}`,
			true,
		);
		markdown.supportHtml = true;
		markdown.isTrusted = true;

		item.tooltip = markdown;

		return item;
	}
}
