'use strict';
import { TreeItem, TreeItemCollapsibleState } from 'vscode';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { CompareView } from '../compareView';
import { CompareNode } from './compareNode';
import { ResourceType, unknownGitUri, ViewNode } from './viewNode';

export class ComparePickerNode extends ViewNode<CompareView> {
    constructor(view: CompareView, protected readonly parent: CompareNode) {
        super(unknownGitUri, view, parent);
    }

    getChildren(): ViewNode[] {
        return [];
    }

    async getTreeItem(): Promise<TreeItem> {
        const selectedRef = this.parent.selectedRef;
        const repoPath = selectedRef !== undefined ? selectedRef.repoPath : undefined;

        let description;
        if (repoPath !== undefined) {
            if ((await Container.git.getRepositoryCount()) > 1) {
                const repo = await Container.git.getRepository(repoPath);
                description = (repo && repo.formattedName) || repoPath;
            }
        }

        let item;
        if (selectedRef === undefined) {
            item = new TreeItem(
                'Compare <branch, tag, or ref> with <branch, tag, or ref>',
                TreeItemCollapsibleState.None
            );
            item.contextValue = ResourceType.ComparePicker;
            item.description = description;
            item.tooltip = `Click to select or enter a reference for compare${GlyphChars.Ellipsis}`;
            item.command = {
                title: `Compare${GlyphChars.Ellipsis}`,
                command: this.view.getQualifiedCommand('selectForCompare')
            };
        }
        else {
            item = new TreeItem(
                `Compare ${selectedRef.label} with <branch, tag, or ref>`,
                TreeItemCollapsibleState.None
            );
            item.contextValue = ResourceType.ComparePickerWithRef;
            item.description = description;
            item.tooltip = `Click to compare ${selectedRef.label} with${GlyphChars.Ellipsis}`;
            item.command = {
                title: `Compare ${selectedRef.label} with${GlyphChars.Ellipsis}`,
                command: this.view.getQualifiedCommand('compareWithSelected')
            };
        }

        return item;
    }
}
