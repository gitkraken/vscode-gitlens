import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import * as nls from 'vscode-nls';
import { GlyphChars } from '../../constants';
import { unknownGitUri } from '../../git/gitUri';
import type { StoredNamedRef } from '../../storage';
import type { SearchAndCompareView, SearchAndCompareViewNode } from '../searchAndCompareView';
import { ContextValues, ViewNode } from './viewNode';

const localize = nls.loadMessageBundle();
interface RepoRef {
	label: string;
	repoPath: string;
	ref: string | StoredNamedRef;
}

export class ComparePickerNode extends ViewNode<SearchAndCompareView> {
	readonly order: number = Date.now();
	readonly pinned: boolean = false;

	constructor(view: SearchAndCompareView, parent: SearchAndCompareViewNode, public readonly selectedRef: RepoRef) {
		super(unknownGitUri, view, parent);
	}

	get canDismiss(): boolean {
		return true;
	}

	getChildren(): ViewNode[] {
		return [];
	}

	getTreeItem(): TreeItem {
		const selectedRef = this.selectedRef;
		const repoPath = selectedRef?.repoPath;

		let description;
		if (repoPath !== undefined) {
			if (this.view.container.git.repositoryCount > 1) {
				const repo = this.view.container.git.getRepository(repoPath);
				description = repo?.formattedName ?? repoPath;
			}
		}

		let item;
		if (selectedRef == null) {
			item = new TreeItem(
				localize(
					'compareBranchTagOrRefWithBranchTagOrRef',
					'Compare <branch, tag, or ref> with <branch, tag, or ref>',
				),
				TreeItemCollapsibleState.None,
			);
			item.contextValue = ContextValues.ComparePicker;
			item.description = description;
			item.tooltip = `${localize(
				'clickToSelectOrEnterReferenceForCompare',
				'Click to select or enter a reference for compare',
			)}${GlyphChars.Ellipsis}`;
			item.command = {
				title: `${localize('compare', 'Compare')}${GlyphChars.Ellipsis}`,
				command: this.view.getQualifiedCommand('selectForCompare'),
			};
		} else {
			item = new TreeItem(
				localize(
					'compareSelectedRefWithBranchTagOrRef',
					'Compare {0} with <branch, tag, or ref>',
					selectedRef.label,
				),
				TreeItemCollapsibleState.None,
			);
			item.contextValue = ContextValues.ComparePickerWithRef;
			item.description = description;
			item.tooltip = `${localize('clickToCompareSelectedRefWith', 'Click to compare {0} with')}${
				GlyphChars.Ellipsis
			}`;
			item.command = {
				title: `${localize('compareSelectedRefWith', 'Compare {0} with', selectedRef.label)}${
					GlyphChars.Ellipsis
				}`,
				command: this.view.getQualifiedCommand('compareWithSelected'),
			};
		}

		return item;
	}
}
