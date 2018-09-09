'use strict';
import * as path from 'path';
import { Command, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Commands, DiffWithPreviousCommandArgs } from '../../commands';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import {
    CommitFormatter,
    getGitStatusIcon,
    GitLogCommit,
    GitUri,
    ICommitFormatOptions,
    IGitStatusFile,
    IStatusFormatOptions,
    StatusFileFormatter
} from '../../git/gitService';
import { Explorer, ExplorerNode, ExplorerRefNode, ResourceType } from './explorerNode';

export enum CommitFileNodeDisplayAs {
    CommitLabel = 1 << 0,
    FileLabel = 1 << 1,

    CommitIcon = 1 << 2,
    StatusIcon = 1 << 3,
    Gravatar = 1 << 4,

    File = FileLabel | StatusIcon
}

export class CommitFileNode extends ExplorerRefNode {
    readonly priority: boolean = false;

    constructor(
        public readonly status: IGitStatusFile,
        public commit: GitLogCommit,
        protected readonly explorer: Explorer,
        private displayAs: CommitFileNodeDisplayAs
    ) {
        super(GitUri.fromFileStatus(status, commit.repoPath, commit.sha));
    }

    get ref(): string {
        return this.commit.sha;
    }

    async getChildren(): Promise<ExplorerNode[]> {
        return [];
    }

    async getTreeItem(): Promise<TreeItem> {
        if (!this.commit.isFile) {
            // See if we can get the commit directly from the multi-file commit
            const commit = this.commit.toFileCommit(this.status);
            if (commit === undefined) {
                const log = await Container.git.getLogForFile(this.repoPath, this.status.fileName, {
                    maxCount: 2,
                    ref: this.commit.sha
                });
                if (log !== undefined) {
                    this.commit = log.commits.get(this.commit.sha) || this.commit;
                }
            }
            else {
                this.commit = commit;
            }
        }

        const item = new TreeItem(this.label, TreeItemCollapsibleState.None);
        item.contextValue = this.resourceType;
        item.tooltip = this.tooltip;

        if ((this.displayAs & CommitFileNodeDisplayAs.CommitIcon) === CommitFileNodeDisplayAs.CommitIcon) {
            item.iconPath = {
                dark: Container.context.asAbsolutePath(path.join('images', 'dark', 'icon-commit.svg')),
                light: Container.context.asAbsolutePath(path.join('images', 'light', 'icon-commit.svg'))
            };
        }
        else if ((this.displayAs & CommitFileNodeDisplayAs.StatusIcon) === CommitFileNodeDisplayAs.StatusIcon) {
            const icon = getGitStatusIcon(this.status.status);
            item.iconPath = {
                dark: Container.context.asAbsolutePath(path.join('images', 'dark', icon)),
                light: Container.context.asAbsolutePath(path.join('images', 'light', icon))
            };
        }
        else if ((this.displayAs & CommitFileNodeDisplayAs.Gravatar) === CommitFileNodeDisplayAs.Gravatar) {
            item.iconPath = this.commit.getGravatarUri(Container.config.defaultGravatarsStyle);
        }

        item.command = this.getCommand();

        // Only cache the label/tooltip for a single refresh
        this._label = undefined;
        this._tooltip = undefined;

        return item;
    }

    private _folderName: string | undefined;
    get folderName() {
        if (this._folderName === undefined) {
            this._folderName = path.dirname(this.uri.getRelativePath());
        }
        return this._folderName;
    }

    private _label: string | undefined;
    get label() {
        if (this._label === undefined) {
            this._label =
                this.displayAs & CommitFileNodeDisplayAs.CommitLabel
                    ? CommitFormatter.fromTemplate(this.getCommitTemplate(), this.commit, {
                          truncateMessageAtNewLine: true,
                          dateFormat: Container.config.defaultDateFormat
                      } as ICommitFormatOptions)
                    : StatusFileFormatter.fromTemplate(this.getCommitFileTemplate(), this.status, {
                          relativePath: this.relativePath
                      } as IStatusFormatOptions);
        }
        return this._label;
    }

    private _relativePath: string | undefined;
    get relativePath(): string | undefined {
        return this._relativePath;
    }
    set relativePath(value: string | undefined) {
        this._relativePath = value;
        this._label = undefined;
        this._tooltip = undefined;
    }

    protected get resourceType(): ResourceType {
        return ResourceType.CommitFile;
    }

    private _tooltip: string | undefined;
    get tooltip() {
        if (this._tooltip === undefined) {
            if (this.displayAs & CommitFileNodeDisplayAs.CommitLabel) {
                this._tooltip = CommitFormatter.fromTemplate(
                    this.commit.isUncommitted
                        ? `\${author} ${GlyphChars.Dash} \${id}\n\${ago} (\${date})`
                        : `\${author} ${GlyphChars.Dash} \${id}\n\${ago} (\${date})\n\n\${message}`,
                    this.commit,
                    {
                        dateFormat: Container.config.defaultDateFormat
                    } as ICommitFormatOptions
                );
            }
            else {
                this._tooltip = StatusFileFormatter.fromTemplate('${file}\n${directory}/\n\n${status}', this.status);
            }
        }
        return this._tooltip;
    }

    protected getCommitTemplate() {
        return this.explorer.config.commitFormat;
    }

    protected getCommitFileTemplate() {
        return this.explorer.config.commitFileFormat;
    }

    getCommand(): Command | undefined {
        return {
            title: 'Compare File with Previous Revision',
            command: Commands.DiffWithPrevious,
            arguments: [
                GitUri.fromFileStatus(this.status, this.commit.repoPath),
                {
                    commit: this.commit,
                    line: 0,
                    showOptions: {
                        preserveFocus: true,
                        preview: true
                    }
                } as DiffWithPreviousCommandArgs
            ]
        };
    }
}
