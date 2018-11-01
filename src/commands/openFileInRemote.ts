'use strict';
import { commands, Range, TextEditor, Uri, window } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitUri } from '../git/gitService';
import { Logger } from '../logger';
import { BranchesQuickPick, CommandQuickPickItem } from '../quickpicks';
import {
    ActiveEditorCommand,
    command,
    CommandContext,
    Commands,
    getCommandUri,
    isCommandViewContextWithBranch,
    isCommandViewContextWithCommit
} from './common';
import { OpenInRemoteCommandArgs } from './openInRemote';

export interface OpenFileInRemoteCommandArgs {
    branch?: string;
    range?: boolean;
    clipboard?: boolean;
}

@command()
export class OpenFileInRemoteCommand extends ActiveEditorCommand {
    constructor() {
        super(Commands.OpenFileInRemote);
    }

    protected async preExecute(
        context: CommandContext,
        args: OpenFileInRemoteCommandArgs = { range: true }
    ): Promise<any> {
        if (isCommandViewContextWithCommit(context)) {
            args = { ...args };
            args.range = false;
            if (isCommandViewContextWithBranch(context)) {
                args.branch = context.node.branch !== undefined ? context.node.branch.name : undefined;
            }
            return this.execute(context.editor, context.node.commit.uri, args);
        }

        return this.execute(context.editor, context.uri, args);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: OpenFileInRemoteCommandArgs = { range: true }) {
        uri = getCommandUri(uri, editor);
        if (uri == null) return undefined;

        const gitUri = await GitUri.fromUri(uri);
        if (!gitUri.repoPath) return undefined;

        if (args.branch === undefined) {
            const branch = await Container.git.getBranch(gitUri.repoPath);
            if (branch === undefined || branch.tracking === undefined) {
                const branches = (await Container.git.getBranches(gitUri.repoPath)).filter(
                    b => b.tracking !== undefined
                );
                if (branches.length > 1) {
                    const pick = await BranchesQuickPick.show(
                        branches,
                        args.clipboard
                            ? `Copy url for ${gitUri.getRelativePath()} to clipboard for which branch${
                                  GlyphChars.Ellipsis
                              }`
                            : `Open ${gitUri.getRelativePath()} on remote for which branch${GlyphChars.Ellipsis}`
                    );
                    if (pick === undefined) return undefined;

                    if (pick instanceof CommandQuickPickItem) return undefined;

                    args.branch = pick.branch.name;
                }
                else if (branches.length === 1) {
                    args.branch = branches[0].name;
                }
            }
            else {
                args.branch = branch.name;
            }
        }

        try {
            const remotes = await Container.git.getRemotes(gitUri.repoPath);
            const range =
                args.range && editor != null
                    ? new Range(
                          editor.selection.start.with({ line: editor.selection.start.line + 1 }),
                          editor.selection.end.with({ line: editor.selection.end.line + 1 })
                      )
                    : undefined;

            return commands.executeCommand(Commands.OpenInRemote, uri, {
                resource: {
                    type: gitUri.sha === undefined ? 'file' : 'revision',
                    branch: args.branch || 'HEAD',
                    fileName: gitUri.getRelativePath(),
                    range: range,
                    sha: gitUri.sha
                },
                remotes,
                clipboard: args.clipboard
            } as OpenInRemoteCommandArgs);
        }
        catch (ex) {
            Logger.error(ex, 'OpenFileInRemoteCommand');
            return window.showErrorMessage(
                `Unable to open file on remote provider. See output channel for more details`
            );
        }
    }
}
