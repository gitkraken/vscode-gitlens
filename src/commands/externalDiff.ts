'use strict';
import { commands, SourceControlResourceState, Uri, window } from 'vscode';
import { BuiltInCommands, GlyphChars } from '../constants';
import { Container } from '../container';
import { GitService, GitUri } from '../git/gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { Arrays } from '../system';
import {
    Command,
    CommandContext,
    Commands,
    getRepoPathOrPrompt,
    isCommandViewContextWithFileCommit,
    isCommandViewContextWithFileRefs
} from './common';

enum Status {
    INDEX_MODIFIED,
    INDEX_ADDED,
    INDEX_DELETED,
    INDEX_RENAMED,
    INDEX_COPIED,

    MODIFIED,
    DELETED,
    UNTRACKED,
    IGNORED,

    ADDED_BY_US,
    ADDED_BY_THEM,
    DELETED_BY_US,
    DELETED_BY_THEM,
    BOTH_ADDED,
    BOTH_DELETED,
    BOTH_MODIFIED
}

enum ResourceGroupType {
    Merge,
    Index,
    WorkingTree
}

interface Resource extends SourceControlResourceState {
    readonly resourceGroupType: ResourceGroupType;
    readonly type: Status;
}

class ExternalDiffFile {
    constructor(
        public readonly uri: Uri,
        public readonly staged: boolean,
        public readonly ref1?: string,
        public readonly ref2?: string
    ) {}
}

export interface ExternalDiffCommandArgs {
    files?: ExternalDiffFile[];
}

export class ExternalDiffCommand extends Command {
    constructor() {
        super([Commands.ExternalDiff, Commands.ExternalDiffAll]);
    }

    protected async preExecute(context: CommandContext, args: ExternalDiffCommandArgs = {}): Promise<any> {
        if (isCommandViewContextWithFileCommit(context)) {
            args = { ...args };

            const ref1 = GitService.isUncommitted(context.node.commit.previousFileSha)
                ? ''
                : context.node.commit.previousFileSha;
            const ref2 = context.node.commit.isUncommitted ? '' : context.node.commit.sha;

            args.files = [
                new ExternalDiffFile(
                    GitUri.fromFile(context.node.file, context.node.file.repoPath || context.node.repoPath),
                    context.node.commit.isStagedUncommitted || context.node.file.indexStatus !== undefined,
                    ref1,
                    ref2
                )
            ];

            return this.execute(args);
        }

        if (isCommandViewContextWithFileRefs(context)) {
            args = { ...args };

            args.files = [
                new ExternalDiffFile(
                    GitUri.fromFile(context.node.file, context.node.file.repoPath || context.node.repoPath),
                    context.node.file.indexStatus !== undefined,
                    context.node.ref1,
                    context.node.ref2
                )
            ];

            return this.execute(args);
        }

        if (args.files === undefined) {
            if (context.type === 'scm-states') {
                args = { ...args };
                args.files = context.scmResourceStates.map(
                    r =>
                        new ExternalDiffFile(
                            r.resourceUri,
                            (r as Resource).resourceGroupType === ResourceGroupType.Index
                        )
                );
            }
            else if (context.type === 'scm-groups') {
                args = { ...args };
                args.files = Arrays.filterMap(
                    context.scmResourceGroups[0].resourceStates,
                    r =>
                        this.isModified(r)
                            ? new ExternalDiffFile(
                                  r.resourceUri,
                                  (r as Resource).resourceGroupType === ResourceGroupType.Index
                              )
                            : undefined
                );
            }
        }

        if (context.command === Commands.ExternalDiffAll) {
            if (args.files === undefined) {
                const repoPath = await getRepoPathOrPrompt(
                    undefined,
                    `Open changes from which repository${GlyphChars.Ellipsis}`
                );
                if (!repoPath) return undefined;

                const status = await Container.git.getStatusForRepo(repoPath);
                if (status === undefined) {
                    return window.showInformationMessage("The repository doesn't have any changes");
                }

                args.files = [];

                for (const file of status.files) {
                    if (file.indexStatus === 'M') {
                        args.files.push(new ExternalDiffFile(file.uri, true));
                    }

                    if (file.workingTreeStatus === 'M') {
                        args.files.push(new ExternalDiffFile(file.uri, false));
                    }
                }
            }
        }

        return this.execute(args);
    }

    private isModified(resource: SourceControlResourceState) {
        const status = (resource as Resource).type;
        return status === Status.BOTH_MODIFIED || status === Status.INDEX_MODIFIED || status === Status.MODIFIED;
    }

    async execute(args: ExternalDiffCommandArgs = {}) {
        try {
            let repoPath;
            if (args.files === undefined) {
                const editor = window.activeTextEditor;
                if (editor === undefined) return undefined;

                repoPath = await Container.git.getRepoPathOrActive(undefined, editor);
                if (!repoPath) return undefined;

                const uri = editor.document.uri;
                const status = await Container.git.getStatusForFile(repoPath, uri.fsPath);
                if (status === undefined) {
                    return window.showInformationMessage("The current file doesn't have any changes");
                }

                args.files = [];
                if (status.indexStatus === 'M') {
                    args.files.push(new ExternalDiffFile(status.uri, true));
                }

                if (status.workingTreeStatus === 'M') {
                    args.files.push(new ExternalDiffFile(status.uri, false));
                }
            }
            else {
                repoPath = await Container.git.getRepoPath(args.files[0].uri.fsPath);
                if (!repoPath) return undefined;
            }

            const tool = await Container.git.getDiffTool(repoPath);
            if (tool === undefined) {
                const result = await window.showWarningMessage(
                    `Unable to open changes in diff tool. No Git diff tool is configured`,
                    'View Git Docs'
                );
                if (!result) return undefined;

                return commands.executeCommand(
                    BuiltInCommands.Open,
                    Uri.parse('https://git-scm.com/docs/git-config#git-config-difftool')
                );
            }

            for (const file of args.files) {
                void Container.git.openDiffTool(repoPath, file.uri, {
                    ref1: file.ref1,
                    ref2: file.ref2,
                    staged: file.staged,
                    tool: tool
                });
            }

            return undefined;
        }
        catch (ex) {
            Logger.error(ex, 'ExternalDiffCommand');
            return Messages.showGenericErrorMessage('Unable to open changes in diff tool');
        }
    }
}
