'use strict';
import { TextEditor, Uri } from 'vscode';
import { GlyphChars } from '../constants';
import { Container } from '../container';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { BranchesAndTagsQuickPick, CommandQuickPickItem } from '../quickpicks';
import {
    ActiveEditorCommand,
    command,
    CommandContext,
    Commands,
    getCommandUri,
    getRepoPathOrActiveOrPrompt
} from './common';

export interface DiffBranchWithBranchCommandArgs {
    ref1?: string;
    ref2?: string;
}

@command()
export class DiffBranchWithBranchCommand extends ActiveEditorCommand {
    constructor() {
        super([Commands.DiffHeadWithBranch, Commands.DiffWorkingWithBranch]);
    }

    protected async preExecute(context: CommandContext, args: DiffBranchWithBranchCommandArgs = {}): Promise<any> {
        switch (context.command) {
            case Commands.DiffHeadWithBranch:
                args.ref2 = 'HEAD';
                break;

            case Commands.DiffWorkingWithBranch:
                args.ref2 = '';
                break;
        }

        return this.execute(context.editor, context.uri, args);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: DiffBranchWithBranchCommandArgs = {}): Promise<any> {
        if (args.ref2 === undefined) return;

        uri = getCommandUri(uri, editor);

        try {
            const repoPath = await getRepoPathOrActiveOrPrompt(
                uri,
                editor,
                `Compare with branch or tag in which repository${GlyphChars.Ellipsis}`
            );
            if (!repoPath) return undefined;

            if (!args.ref1) {
                let placeHolder;
                switch (args.ref2) {
                    case '':
                        placeHolder = `Compare Working Tree with${GlyphChars.Ellipsis}`;
                        break;
                    case 'HEAD':
                        placeHolder = `Compare HEAD with${GlyphChars.Ellipsis}`;
                        break;
                    default:
                        placeHolder = `Compare ${args.ref2} with${GlyphChars.Ellipsis}`;
                        break;
                }

                const pick = await new BranchesAndTagsQuickPick(repoPath).show(placeHolder, {
                    allowCommitId: true
                });
                if (pick === undefined) return undefined;

                if (pick instanceof CommandQuickPickItem) return pick.execute();

                args.ref1 = pick.ref;
                if (args.ref1 === undefined) return undefined;
            }

            await Container.compareView.compare(repoPath, args.ref1, args.ref2);

            return undefined;
        }
        catch (ex) {
            Logger.error(ex, 'DiffBranchWithBranchCommand');
            return Messages.showGenericErrorMessage('Unable to open branch compare');
        }
    }
}
