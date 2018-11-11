'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { Strings } from '../../system';
import { CompareView } from '../compareView';
import { CompareNode } from './compareNode';
import { ResourceType, unknownGitUri, ViewNode } from './viewNode';

export class ComparePickerNode extends ViewNode<CompareView> {
    constructor(
        view: CompareView,
        protected readonly parent: CompareNode
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
                `Compare &lt;branch, tag, or ref&gt; with &lt;branch, tag, or ref&gt;${repository}`,
                TreeItemCollapsibleState.None
            );
            item.contextValue = ResourceType.ComparePicker;
            item.tooltip = `Click to select branch or tag for compare${GlyphChars.Ellipsis}`;
            item.command = {
                title: `Select branch or tag for compare${GlyphChars.Ellipsis}`,
                command: this.view.getQualifiedCommand('selectForCompare')
            };
        }
        else {
            item = new TreeItem(
                `Compare ${selectedRef.label} with &lt;branch, tag, or ref&gt;${repository}`,
                TreeItemCollapsibleState.None
            );
            item.contextValue = ResourceType.ComparePickerWithRef;
            item.tooltip = `Click to compare ${selectedRef.label} with${GlyphChars.Ellipsis}`;
            item.command = {
                title: `Compare ${selectedRef.label} with${GlyphChars.Ellipsis}`,
                command: this.view.getQualifiedCommand('compareWithSelected')
            };
        }

        return item;
    }
}
