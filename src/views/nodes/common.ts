import { Command, ThemeIcon, TreeItem, TreeItemCollapsibleState, Uri } from 'vscode';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { Explorer } from '../explorer';
import { RefreshNodeCommandArgs } from '../explorerCommands';
import { ExplorerNode, ResourceType, unknownGitUri } from '../nodes/explorerNode';

export class MessageNode extends ExplorerNode {
    constructor(
        private readonly _message: string,
        private readonly _tooltip?: string,
        private readonly _iconPath?:
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
        const item = new TreeItem(this._message, TreeItemCollapsibleState.None);
        item.contextValue = ResourceType.Message;
        item.tooltip = this._tooltip;
        item.iconPath = this._iconPath;
        return item;
    }
}

export class UpdateableMessageNode extends ExplorerNode {
    constructor(
        public readonly id: string,
        private _message: string,
        private _tooltip?: string,
        private _iconPath?:
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
        const item = new TreeItem(this._message, TreeItemCollapsibleState.None);
        item.id = this.id;
        item.contextValue = ResourceType.Message;
        item.tooltip = this._tooltip;
        item.iconPath = this._iconPath;
        return item;
    }

    update(
        changes: {
            message?: string;
            tooltip?: string | null;
            iconPath?:
                | string
                | null
                | Uri
                | {
                      light: string | Uri;
                      dark: string | Uri;
                  }
                | ThemeIcon;
        },
        explorer: Explorer
    ) {
        if (changes.message !== undefined) {
            this._message = changes.message;
        }

        if (changes.tooltip !== undefined) {
            this._tooltip = changes.tooltip === null ? undefined : changes.tooltip;
        }

        if (changes.iconPath !== undefined) {
            this._iconPath = changes.iconPath === null ? undefined : changes.iconPath;
        }

        explorer.triggerNodeUpdate(this);
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
