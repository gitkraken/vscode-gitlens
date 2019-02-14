'use strict';
import { Range, TextDocumentShowOptions, TextEditor, Uri } from 'vscode';
import { GlyphChars } from '../constants';
import { GitBranch, GitTag, GitUri } from '../git/gitService';
import { BranchesAndTagsQuickPick, BranchQuickPickItem, TagQuickPickItem } from '../quickpicks';
import { Strings } from '../system';
import { ActiveEditorCommand, command, Commands, getCommandUri, openEditor } from './common';

export interface OpenFileRevisionFromBranchCommandArgs {
    branchOrTag?: GitBranch | GitTag;

    line?: number;
    showOptions?: TextDocumentShowOptions;
}

@command()
export class OpenFileRevisionFromBranchCommand extends ActiveEditorCommand {
    constructor() {
        super(Commands.OpenFileRevisionFromBranch);
    }

    async execute(editor: TextEditor | undefined, uri?: Uri, args: OpenFileRevisionFromBranchCommandArgs = {}) {
        uri = getCommandUri(uri, editor);
        if (uri == null) return undefined;

        const gitUri = await GitUri.fromUri(uri);
        if (!gitUri.repoPath) return undefined;

        if (args.branchOrTag === undefined) {
            const placeHolder = `Open revision of ${gitUri.getFormattedPath()}${
                gitUri.sha ? ` ${Strings.pad(GlyphChars.Dot, 1, 1)} ${gitUri.shortSha}` : ''
            } from Branch or Tag${GlyphChars.Ellipsis}`;

            const pick = await new BranchesAndTagsQuickPick(gitUri.repoPath).show(placeHolder, {
                allowCommitId: false
            });
            if (pick === undefined) return undefined;

            if (!(pick instanceof BranchQuickPickItem) && !(pick instanceof TagQuickPickItem)) {
                return undefined;
            }

            args.branchOrTag = pick.item;
        }

        if (args.line !== undefined && args.line !== 0) {
            if (args.showOptions === undefined) {
                args.showOptions = {};
            }
            args.showOptions.selection = new Range(args.line, 0, args.line, 0);
        }

        return openEditor(GitUri.toRevisionUri(args.branchOrTag.ref, gitUri.fsPath, gitUri.repoPath), {
            ...args.showOptions,
            rethrow: true
        });
    }
}
