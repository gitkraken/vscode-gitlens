'use strict';
import { commands, TextEditor, Uri, window } from 'vscode';
import { BuiltInCommands, GlyphChars } from '../constants';
import { Container } from '../container';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { BranchesAndTagsQuickPick, CommandQuickPickItem } from '../quickpicks';
import { CompareResultsNode } from '../views/nodes';
import {
    ActiveEditorCommand,
    command,
    CommandContext,
    Commands,
    getCommandUri,
    getRepoPathOrActiveOrPrompt,
    isCommandViewContextWithRef
} from './common';

export interface DiffDirectoryCommandArgs {
    ref1?: string;
    ref2?: string;
}

@command()
export class DiffDirectoryCommand extends ActiveEditorCommand {
    constructor() {
        super([Commands.DiffDirectory, Commands.ViewsOpenDirectoryDiff, Commands.ViewsOpenDirectoryDiffWithWorking]);
    }

    protected async preExecute(context: CommandContext, args: DiffDirectoryCommandArgs = {}): Promise<any> {
        switch (context.command) {
            case Commands.ViewsOpenDirectoryDiff:
                if (context.type === 'viewItem' && context.node instanceof CompareResultsNode) {
                    args.ref1 = context.node.ref1.ref;
                    args.ref2 = context.node.ref2.ref;
                }
                break;

            case Commands.ViewsOpenDirectoryDiffWithWorking:
                if (isCommandViewContextWithRef(context)) {
                    args.ref1 = context.node.ref;
                    args.ref2 = undefined;
                }
                break;
        }

        return this.execute(context.editor, context.uri, args);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: DiffDirectoryCommandArgs = {}): Promise<any> {
        uri = getCommandUri(uri, editor);

        try {
            const repoPath = await getRepoPathOrActiveOrPrompt(
                uri,
                editor,
                `Compare directory in which repository${GlyphChars.Ellipsis}`
            );
            if (!repoPath) return undefined;

            if (!args.ref1) {
                args = { ...args };

                const pick = await new BranchesAndTagsQuickPick(repoPath).show(
                    `Compare Working Tree with${GlyphChars.Ellipsis}`,
                    { allowCommitId: true }
                );
                if (pick === undefined) return undefined;

                if (pick instanceof CommandQuickPickItem) return pick.execute();

                args.ref1 = pick.ref;
                if (args.ref1 === undefined) return undefined;
            }

            await Container.git.openDirectoryDiff(repoPath, args.ref1, args.ref2);
            return undefined;
        }
        catch (ex) {
            const msg = ex && ex.toString();
            if (msg === 'No diff tool found') {
                const result = await window.showWarningMessage(
                    `Unable to open directory compare because there is no Git diff tool configured`,
                    'View Git Docs'
                );
                if (!result) return undefined;

                return commands.executeCommand(
                    BuiltInCommands.Open,
                    Uri.parse('https://git-scm.com/docs/git-config#git-config-difftool')
                );
            }

            Logger.error(ex, 'DiffDirectoryCommand');
            return Messages.showGenericErrorMessage('Unable to open directory compare');
        }
    }
}
