'use strict';
import * as paths from 'path';
import { Command, Selection, TreeItem, TreeItemCollapsibleState } from 'vscode';
import { Commands, DiffWithPreviousCommandArgs } from '../../commands';
import { GlyphChars } from '../../constants';
import { Container } from '../../container';
import { CommitFormatter, GitFile, GitLogCommit, GitUri, StatusFileFormatter } from '../../git/gitService';
import { View } from '../viewBase';
import { ResourceType, ViewNode, ViewRefFileNode } from './viewNode';

export enum CommitFileNodeDisplayAs {
    CommitLabel = 1 << 0,
    FileLabel = 1 << 1,

    CommitIcon = 1 << 2,
    StatusIcon = 1 << 3,
    Gravatar = 1 << 4,

    File = FileLabel | StatusIcon
}

export class CommitFileNode extends ViewRefFileNode {
    constructor(
        view: View,
        parent: ViewNode,
        public readonly file: GitFile,
        public commit: GitLogCommit,
        private readonly _displayAs: CommitFileNodeDisplayAs,
        private readonly _selection?: Selection
    ) {
        super(GitUri.fromFile(file, commit.repoPath, commit.sha), view, parent);
    }

    get fileName(): string {
        return this.file.fileName;
    }

    get priority(): number {
        return 0;
    }

    get ref(): string {
        return this.commit.sha;
    }

    getChildren(): ViewNode[] {
        return [];
    }

    async getTreeItem(): Promise<TreeItem> {
        if (!this.commit.isFile) {
            // See if we can get the commit directly from the multi-file commit
            const commit = this.commit.toFileCommit(this.file);
            if (commit === undefined) {
                const log = await Container.git.getLogForFile(this.repoPath, this.file.fileName, {
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
        item.description = this.description;
        item.tooltip = this.tooltip;

        if ((this._displayAs & CommitFileNodeDisplayAs.CommitIcon) === CommitFileNodeDisplayAs.CommitIcon) {
            item.iconPath = {
                dark: Container.context.asAbsolutePath(paths.join('images', 'dark', 'icon-commit.svg')),
                light: Container.context.asAbsolutePath(paths.join('images', 'light', 'icon-commit.svg'))
            };
        }
        else if ((this._displayAs & CommitFileNodeDisplayAs.StatusIcon) === CommitFileNodeDisplayAs.StatusIcon) {
            const icon = GitFile.getStatusIcon(this.file.status);
            item.iconPath = {
                dark: Container.context.asAbsolutePath(paths.join('images', 'dark', icon)),
                light: Container.context.asAbsolutePath(paths.join('images', 'light', icon))
            };
        }
        else if ((this._displayAs & CommitFileNodeDisplayAs.Gravatar) === CommitFileNodeDisplayAs.Gravatar) {
            item.iconPath = this.commit.getGravatarUri(Container.config.defaultGravatarsStyle);
        }

        item.command = this.getCommand();

        // Only cache the label/description/tooltip for a single refresh
        this._label = undefined;
        this._description = undefined;
        this._tooltip = undefined;

        return item;
    }

    private _description: string | undefined;
    get description() {
        if (this._description === undefined) {
            this._description =
                this._displayAs & CommitFileNodeDisplayAs.CommitLabel
                    ? CommitFormatter.fromTemplate(this.getCommitDescriptionTemplate(), this.commit, {
                          truncateMessageAtNewLine: true,
                          dateFormat: Container.config.defaultDateFormat
                      })
                    : StatusFileFormatter.fromTemplate(this.getCommitFileDescriptionTemplate(), this.file, {
                          relativePath: this.relativePath
                      });
        }
        return this._description;
    }

    private _folderName: string | undefined;
    get folderName() {
        if (this._folderName === undefined) {
            this._folderName = paths.dirname(this.uri.getRelativePath());
        }
        return this._folderName;
    }

    private _label: string | undefined;
    get label() {
        if (this._label === undefined) {
            this._label =
                this._displayAs & CommitFileNodeDisplayAs.CommitLabel
                    ? CommitFormatter.fromTemplate(this.getCommitTemplate(), this.commit, {
                          truncateMessageAtNewLine: true,
                          dateFormat: Container.config.defaultDateFormat
                      })
                    : StatusFileFormatter.fromTemplate(this.getCommitFileTemplate(), this.file, {
                          relativePath: this.relativePath
                      });
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

    protected get resourceType(): string {
        if (!this.commit.isUncommitted) return ResourceType.CommitFile;

        return this.commit.isStagedUncommitted ? `${ResourceType.File}+staged` : `${ResourceType.File}+unstaged`;
    }

    private _tooltip: string | undefined;
    get tooltip() {
        if (this._tooltip === undefined) {
            if (this._displayAs & CommitFileNodeDisplayAs.CommitLabel) {
                // eslint-disable-next-line no-template-curly-in-string
                const status = StatusFileFormatter.fromTemplate('${status}${ (originalPath)}', this.file);
                this._tooltip = CommitFormatter.fromTemplate(
                    this.commit.isUncommitted
                        ? `\${author} ${GlyphChars.Dash} \${id}\n${status}\n\${ago} (\${date})`
                        : `\${author} ${GlyphChars.Dash} \${id}\n${status}\n\${ago} (\${date})\n\n\${message}`,
                    this.commit,
                    {
                        dateFormat: Container.config.defaultDateFormat
                    }
                );
            }
            else {
                this._tooltip = StatusFileFormatter.fromTemplate(
                    // eslint-disable-next-line no-template-curly-in-string
                    '${file}\n${directory}/\n\n${status}${ (originalPath)}',
                    this.file
                );
            }
        }
        return this._tooltip;
    }

    protected getCommitTemplate() {
        return this.view.config.commitFormat;
    }

    protected getCommitDescriptionTemplate() {
        return this.view.config.commitDescriptionFormat;
    }

    protected getCommitFileTemplate() {
        return this.view.config.commitFileFormat;
    }

    protected getCommitFileDescriptionTemplate() {
        return this.view.config.commitFileDescriptionFormat;
    }

    getCommand(): Command | undefined {
        const commandArgs: DiffWithPreviousCommandArgs = {
            commit: this.commit,
            line: this._selection !== undefined ? this._selection.active.line : 0,
            showOptions: {
                preserveFocus: true,
                preview: true
            }
        };
        return {
            title: 'Compare File with Previous Revision',
            command: Commands.DiffWithPrevious,
            arguments: [GitUri.fromFile(this.file, this.commit.repoPath), commandArgs]
        };
    }
}
