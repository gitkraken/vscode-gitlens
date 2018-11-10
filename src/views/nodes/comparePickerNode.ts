'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { Strings } from '../../system';
import { ResultsView } from '../resultsView';
import { ResultsNode } from './resultsNode';
import { ResourceType, unknownGitUri, ViewNode } from './viewNode';

export class ComparePickerNode extends ViewNode<ResultsView> {
    constructor(
        view: ResultsView,
        protected readonly parent: ResultsNode
    ) {
        super(unknownGitUri, view, parent);
    }

    getChildren(): ViewNode[] {
        return [];
    }

    async getTreeItem(): Promise<TreeItem> {
        const selectedRef = this.parent.selectedRef;
        const repoPath = selectedRef !== undefined ? selectedRef.repoPath : undefined;

        let repository = '';
        if (repoPath !== undefined) {
            if ((await Container.git.getRepositoryCount()) > 1) {
                const repo = await Container.git.getRepository(repoPath);
                repository = ` ${Strings.pad(GlyphChars.Dash, 1, 1)} ${(repo && repo.formattedName) || repoPath}`;
            }
        }

        let item;
        if (selectedRef === undefined) {
            item = new TreeItem(
                `Compare &lt;branch, tag, or ref&gt; to &lt;branch, tag, or ref&gt;${repository}`,
                TreeItemCollapsibleState.None
            );
            item.contextValue = ResourceType.ComparePicker;
            item.tooltip = `Click to select branch or tag for compare${GlyphChars.Ellipsis}`;
            item.command = {
                title: `Select branch or tag for compare${GlyphChars.Ellipsis}`,
                command: 'gitlens.views.results.selectForCompare'
            };
        }
        else {
            item = new TreeItem(
                `Compare ${selectedRef.label} to &lt;branch, tag, or ref&gt;${repository}`,
                TreeItemCollapsibleState.None
            );
            item.contextValue = ResourceType.ComparePickerWithRef;
            item.tooltip = `Click to compare ${selectedRef.label} to${GlyphChars.Ellipsis}`;
            item.command = {
                title: `Compare ${selectedRef.label} with${GlyphChars.Ellipsis}`,
                command: 'gitlens.views.results.compareWithSelected'
            };
        }

        return item;
    }
}
