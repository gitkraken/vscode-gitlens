import { Command, ThemeIcon, TreeItem, TreeItemCollapsibleState, Uri } from 'vscode';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { Explorer } from '../explorer';
import { RefreshNodeCommandArgs } from '../explorerCommands';
import { ExplorerNode, ResourceType, unknownGitUri } from '../nodes/explorerNode';

export class MessageNode extends ExplorerNode {
    constructor(
        private readonly message: string,
        private readonly tooltip?: string,
        private readonly iconPath?:
            | string
            | Uri
            | {
                  light: string | Uri;
                  dark: string | Uri;
              }
            | ThemeIcon
    ) {
        super(unknownGitUri);
    }

    getChildren(): ExplorerNode[] | Promise<ExplorerNode[]> {
        return [];
    }

    getTreeItem(): TreeItem | Promise<TreeItem> {
        const item = new TreeItem(this.message, TreeItemCollapsibleState.None);
        item.contextValue = ResourceType.Message;
        item.tooltip = this.tooltip;
        item.iconPath = this.iconPath;
        return item;
    }
}

export abstract class PagerNode extends ExplorerNode {
    protected _args: RefreshNodeCommandArgs = {};

    constructor(
        protected readonly message: string,
        protected readonly node: ExplorerNode,
        protected readonly explorer: Explorer
    ) {
        super(unknownGitUri);
    }

    getChildren(): ExplorerNode[] | Promise<ExplorerNode[]> {
        return [];
    }

    getTreeItem(): TreeItem | Promise<TreeItem> {
        const item = new TreeItem(this.message, TreeItemCollapsibleState.None);
        item.contextValue = ResourceType.Pager;
        item.command = this.getCommand();
        item.iconPath = {
            dark: Container.context.asAbsolutePath('images/dark/icon-unfold.svg'),
            light: Container.context.asAbsolutePath('images/light/icon-unfold.svg')
        };
        return item;
    }

    getCommand(): Command | undefined {
        return {
            title: 'Refresh',
            command: this.explorer.getQualifiedCommand('refreshNode'),
            arguments: [this.node, this._args]
        } as Command;
    }
}

export class ShowMoreNode extends PagerNode {
    constructor(
        type: string,
        node: ExplorerNode,
        explorer: Explorer,
        maxCount: number = Container.config.advanced.maxListItems
    ) {
        super(
            maxCount === 0
                ? `Show All ${type} ${GlyphChars.Space}${GlyphChars.Dash}${GlyphChars.Space} this may take a while`
                : `Show More ${type}`,
            node,
            explorer
        );
        this._args.maxCount = maxCount;
    }
}

export class ShowAllNode extends ShowMoreNode {
    constructor(type: string, node: ExplorerNode, explorer: Explorer) {
        super(type, node, explorer, 0);
    }
}
