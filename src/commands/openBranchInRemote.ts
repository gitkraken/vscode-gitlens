'use strict';
import { commands, TextEditor, Uri, window } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { GitUri } from '../git/gitService';
import { Logger } from '../logger';
import { BranchesQuickPick, CommandQuickPickItem } from '../quickpicks';
import {
    ActiveEditorCommand,
    CommandContext,
    Commands,
    getCommandUri,
    getRepoPathOrActiveOrPrompt,
    isCommandViewContextWithBranch
} from './common';
import { OpenInRemoteCommandArgs } from './openInRemote';

export interface OpenBranchInRemoteCommandArgs {
    branch?: string;
    remote?: string;
}

export class OpenBranchInRemoteCommand extends ActiveEditorCommand {
    constructor() {
        super(Commands.OpenBranchInRemote);
    }

    protected async preExecute(context: CommandContext, args: OpenBranchInRemoteCommandArgs = {}): Promise<any> {
        if (isCommandViewContextWithBranch(context)) {
            args = { ...args };
            args.branch = context.node.branch.name;
            args.remote = context.node.branch.getRemote();
        }

        return this.execute(context.editor, context.uri, args);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: OpenBranchInRemoteCommandArgs = {}) {
        uri = getCommandUri(uri, editor);

        const gitUri = uri && (await GitUri.fromUri(uri));

        const repoPath = await getRepoPathOrActiveOrPrompt(
            gitUri,
            editor,
            `Open branch on remote for which repository${GlyphChars.Ellipsis}`
        );
        if (!repoPath) return undefined;

        try {
            if (args.branch === undefined) {
                args = { ...args };

                const branches = (await Container.git.getBranches(repoPath)).filter(b => b.tracking !== undefined);
                if (branches.length > 1) {
                    const pick = await BranchesQuickPick.show(
                        branches,
                        `Open which branch on remote${GlyphChars.Ellipsis}`
                    );
                    if (pick === undefined) return undefined;

                    if (pick instanceof CommandQuickPickItem) return undefined;

                    args.branch = pick.branch.name;
                }
                else if (branches.length === 1) {
                    args.branch = branches[0].name;
                }
            }

            const remotes = await Container.git.getRemotes(repoPath);

            return commands.executeCommand(Commands.OpenInRemote, uri, {
                resource: {
                    type: 'branch',
                    branch: args.branch || 'HEAD'
                },
                remote: args.remote,
                remotes
            } as OpenInRemoteCommandArgs);
        }
        catch (ex) {
            Logger.error(ex, 'OpenBranchInRemoteCommandArgs');
            return window.showErrorMessage(
                `Unable to open branch on remote provider. See output channel for more details`
            );
        }
    }
}
