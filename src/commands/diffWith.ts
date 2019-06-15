'use strict';
import * as paths from 'path';
import { commands, Range, TextDocumentShowOptions, TextEditor, Uri, ViewColumn } from 'vscode';
import { BuiltInCommands, GlyphChars } from '../constants';
import { Container } from '../container';
import { GitCommit, GitService, GitUri } from '../git/gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { ActiveEditorCommand, command, Commands } from './common';

export interface DiffWithCommandArgsRevision {
    sha: string;
    uri: Uri;
    title?: string;
}

export interface DiffWithCommandArgs {
    lhs: DiffWithCommandArgsRevision;
    rhs: DiffWithCommandArgsRevision;
    repoPath: string | undefined;

    line?: number;
    showOptions?: TextDocumentShowOptions;
}

@command()
export class DiffWithCommand extends ActiveEditorCommand {
    static getMarkdownCommandArgs(args: DiffWithCommandArgs): string;
    static getMarkdownCommandArgs(commit: GitCommit, line?: number): string;
    static getMarkdownCommandArgs(argsOrCommit: DiffWithCommandArgs | GitCommit, line?: number): string {
        let args: DiffWithCommandArgs | GitCommit;
        if (GitCommit.is(argsOrCommit)) {
            const commit = argsOrCommit;

            if (commit.isUncommitted) {
                args = {
                    repoPath: commit.repoPath,
                    lhs: {
                        sha: 'HEAD',
                        uri: commit.uri
                    },
                    rhs: {
                        sha: '',
                        uri: commit.uri
                    },
                    line: line
                };
            }
            else {
                args = {
                    repoPath: commit.repoPath,
                    lhs: {
                        sha: commit.previousSha !== undefined ? commit.previousSha : GitService.deletedOrMissingSha,
                        uri: commit.previousUri!
                    },
                    rhs: {
                        sha: commit.sha,
                        uri: commit.uri
                    },
                    line: line
                };
            }
        }
        else {
            args = argsOrCommit;
        }

        return super.getMarkdownCommandArgsCore<DiffWithCommandArgs>(Commands.DiffWith, args);
    }

    constructor() {
        super(Commands.DiffWith);
    }

    async execute(editor?: TextEditor, uri?: Uri, args?: DiffWithCommandArgs): Promise<any> {
        if (args === undefined || args.lhs === undefined || args.rhs === undefined) return undefined;

        args = {
            ...args,
            lhs: { ...(args.lhs as DiffWithCommandArgsRevision) },
            rhs: { ...(args.rhs as DiffWithCommandArgsRevision) },
            showOptions: args.showOptions === undefined ? undefined : { ...args.showOptions }
        };

        if (args.repoPath === undefined) return undefined;

        try {
            let lhsSha = args.lhs.sha;
            let rhsSha = args.rhs.sha;

            [args.lhs.sha, args.rhs.sha] = await Promise.all([
                await Container.git.resolveReference(args.repoPath, args.lhs.sha, args.lhs.uri),
                await Container.git.resolveReference(args.repoPath, args.rhs.sha, args.rhs.uri)
            ]);

            if (args.lhs.sha !== GitService.deletedOrMissingSha) {
                lhsSha = args.lhs.sha;
            }

            if (args.rhs.sha && args.rhs.sha !== GitService.deletedOrMissingSha) {
                // Ensure that the file still exists in this commit
                const status = await Container.git.getFileStatusForCommit(
                    args.repoPath,
                    args.rhs.uri.fsPath,
                    args.rhs.sha
                );
                if (status !== undefined && status.status === 'D') {
                    args.rhs.sha = GitService.deletedOrMissingSha;
                }
                else {
                    rhsSha = args.rhs.sha;
                }
            }

            const [lhs, rhs] = await Promise.all([
                Container.git.getVersionedUri(args.repoPath, args.lhs.uri.fsPath, args.lhs.sha),
                Container.git.getVersionedUri(args.repoPath, args.rhs.uri.fsPath, args.rhs.sha)
            ]);

            let rhsSuffix = GitService.shortenSha(rhsSha, { uncommitted: 'Working Tree' }) || '';
            if (rhs === undefined) {
                if (GitService.isUncommitted(args.rhs.sha)) {
                    rhsSuffix = 'deleted';
                }
                else if (rhsSuffix.length === 0 && args.rhs.sha === GitService.deletedOrMissingSha) {
                    rhsSuffix = 'not in Working Tree';
                }
                else {
                    rhsSuffix = `deleted${rhsSuffix.length === 0 ? '' : ` in ${rhsSuffix}`}`;
                }
            }
            else if (lhs === undefined) {
                rhsSuffix = `added${rhsSuffix.length === 0 ? '' : ` in ${rhsSuffix}`}`;
            }

            let lhsSuffix = args.lhs.sha !== GitService.deletedOrMissingSha ? GitService.shortenSha(lhsSha) || '' : '';
            if (lhs === undefined && args.rhs.sha.length === 0) {
                if (rhs !== undefined) {
                    lhsSuffix = lhsSuffix.length === 0 ? '' : `not in ${lhsSuffix}`;
                    rhsSuffix = '';
                }
                else {
                    lhsSuffix = `deleted${lhsSuffix.length === 0 ? '' : ` in ${lhsSuffix}`}`;
                }
            }

            if (args.lhs.title === undefined && (lhs !== undefined || lhsSuffix.length !== 0)) {
                args.lhs.title = `${paths.basename(args.lhs.uri.fsPath)}${lhsSuffix ? ` (${lhsSuffix})` : ''}`;
            }
            if (args.rhs.title === undefined) {
                args.rhs.title = `${paths.basename(args.rhs.uri.fsPath)}${rhsSuffix ? ` (${rhsSuffix})` : ''}`;
            }

            const title =
                args.lhs.title !== undefined && args.rhs.title !== undefined
                    ? `${args.lhs.title} ${GlyphChars.ArrowLeftRightLong} ${args.rhs.title}`
                    : args.lhs.title || args.rhs.title;

            if (args.showOptions === undefined) {
                args.showOptions = {};
            }

            if (args.showOptions.viewColumn === undefined) {
                args.showOptions.viewColumn = ViewColumn.Active;
            }

            if (args.line !== undefined && args.line !== 0) {
                args.showOptions.selection = new Range(args.line, 0, args.line, 0);
            }

            return await commands.executeCommand(
                BuiltInCommands.Diff,
                lhs === undefined
                    ? GitUri.toRevisionUri(GitService.deletedOrMissingSha, args.lhs.uri.fsPath, args.repoPath)
                    : lhs,
                rhs === undefined
                    ? GitUri.toRevisionUri(GitService.deletedOrMissingSha, args.rhs.uri.fsPath, args.repoPath)
                    : rhs,
                title,
                args.showOptions
            );
        }
        catch (ex) {
            Logger.error(ex, 'DiffWithCommand', 'getVersionedFile');
            return Messages.showGenericErrorMessage('Unable to open compare');
        }
    }
}
