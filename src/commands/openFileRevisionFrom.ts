'use strict';
import { Range, TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { GlyphChars } from '../constants';
import { GitBranch, GitReference, GitTag, GitUri } from '../git/gitService';
import { CommandQuickPickItem, ReferencesQuickPick } from '../quickpicks';
import { Strings } from '../system';
import { ActiveEditorCommand, command, Commands, getCommandUri, openEditor } from './common';

export interface OpenFileRevisionFromCommandArgs {
    reference?: GitBranch | GitTag | GitReference;

    line?: number;
    showOptions?: TextDocumentShowOptions;
}

@command()
export class OpenFileRevisionFromCommand extends ActiveEditorCommand {
    constructor() {
        super([Commands.OpenFileRevisionFrom, Commands.OpenFileRevisionFromBranch]);
    }

    async execute(editor: TextEditor | undefined, uri?: Uri, args: OpenFileRevisionFromCommandArgs = {}) {
        uri = getCommandUri(uri, editor);
        if (uri == null) return undefined;

        const gitUri = await GitUri.fromUri(uri);
        if (!gitUri.repoPath) return undefined;

        if (args.reference === undefined) {
            const placeHolder = `Open revision of ${gitUri.getFormattedPath()}${
                gitUri.sha ? ` ${Strings.pad(GlyphChars.Dot, 1, 1)} ${gitUri.shortSha}` : ''
            } from${GlyphChars.Ellipsis}`;

            const pick = await new ReferencesQuickPick(gitUri.repoPath).show(placeHolder, {
                allowEnteringRefs: true
            });
            if (pick === undefined) return undefined;
            if (pick instanceof CommandQuickPickItem) return pick.execute();

            args.reference = pick.item;
        }

        if (args.line !== undefined && args.line !== 0) {
            if (args.showOptions === undefined) {
                args.showOptions = {};
            }
            args.showOptions.selection = new Range(args.line, 0, args.line, 0);
        }

        return openEditor(GitUri.toRevisionUri(args.reference.ref, gitUri.fsPath, gitUri.repoPath), {
            ...args.showOptions,
            rethrow: true
        });
    }
}
