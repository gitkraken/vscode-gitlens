'use strict';
import * as path from 'path';
import { commands, Range, TextDocumentShowOptions, TextEditor, Uri, ViewColumn } from 'vscode';
import { BuiltInCommands, GlyphChars } from '../constants';
import { Container } from '../container';
import { GitCommit, GitService, GitUri } from '../git/gitService';
import { Logger } from '../logger';
import { Messages } from '../messages';
import { ActiveEditorCommand, Commands } from './common';

export interface DiffWithCommandArgsRevision {
    sha: string;
    uri: Uri;
    title?: string;
}

export interface DiffWithCommandArgs {
    lhs?: DiffWithCommandArgsRevision;
    rhs?: DiffWithCommandArgsRevision;
    repoPath?: string;

    line?: number;
    showOptions?: TextDocumentShowOptions;
}

export class DiffWithCommand extends ActiveEditorCommand {
    static getMarkdownCommandArgs(args: DiffWithCommandArgs): string;
    static getMarkdownCommandArgs(commit1: GitCommit, commit2: GitCommit): string;
    static getMarkdownCommandArgs(argsOrCommit1: DiffWithCommandArgs | GitCommit, commit2?: GitCommit): string {
        let args: DiffWithCommandArgs | GitCommit;
        if (argsOrCommit1 instanceof GitCommit) {
            const commit1 = argsOrCommit1;

            if (commit2 === undefined) {
                if (commit1.isUncommitted) {
                    args = {
                        repoPath: commit1.repoPath,
                        lhs: {
                            sha: 'HEAD',
                            uri: commit1.uri
                        },
                        rhs: {
                            sha: '',
                            uri: commit1.uri
                        }
                    };
                }
                else {
                    args = {
                        repoPath: commit1.repoPath,
                        lhs: {
                            sha: commit1.previousSha !== undefined ? commit1.previousSha : GitService.deletedSha,
                            uri: commit1.previousUri!
                        },
                        rhs: {
                            sha: commit1.sha,
                            uri: commit1.uri
                        }
                    };
                }
            }
            else {
                args = {
                    repoPath: commit1.repoPath,
                    lhs: {
                        sha: commit1.sha,
                        uri: commit1.uri
                    },
                    rhs: {
                        sha: commit2.sha,
                        uri: commit2.uri
                    }
                };
            }
        }
        else {
            args = argsOrCommit1;
        }

        return super.getMarkdownCommandArgsCore<DiffWithCommandArgs>(Commands.DiffWith, args);
    }

    constructor() {
        super(Commands.DiffWith);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: DiffWithCommandArgs = {}): Promise<any> {
        args = {
            ...args,
            lhs: { ...args.lhs },
            rhs: { ...args.rhs },
            showOptions: { ...args.showOptions }
        } as DiffWithCommandArgs;
        if (args.repoPath === undefined || args.lhs === undefined || args.rhs === undefined) return undefined;

        try {
            // If the shas aren't resolved (e.g. a2d24f^), resolve them
            if (GitService.isResolveRequired(args.lhs.sha)) {
                args.lhs.sha = await Container.git.resolveReference(args.repoPath, args.lhs.sha, args.lhs.uri);
            }

            if (GitService.isResolveRequired(args.rhs.sha)) {
                args.rhs.sha = await Container.git.resolveReference(args.repoPath, args.rhs.sha, args.rhs.uri);
            }

            const [lhs, rhs] = await Promise.all([
                Container.git.getVersionedFile(args.repoPath, args.lhs.uri.fsPath, args.lhs.sha),
                Container.git.getVersionedFile(args.repoPath, args.rhs.uri.fsPath, args.rhs.sha)
            ]);

            let rhsPrefix = '';
            if (rhs === undefined) {
                rhsPrefix = GitService.isUncommitted(args.rhs.sha) ? ' (deleted)' : 'deleted in ';
            }
            else if (lhs === undefined || args.lhs.sha === GitService.deletedSha) {
                rhsPrefix = 'added in ';
            }

            let lhsPrefix = '';
            if (lhs === undefined && args.rhs.sha === '') {
                if (rhs !== undefined) {
                    lhsPrefix = 'not in ';
                    rhsPrefix = '';
                }
                else {
                    lhsPrefix = 'deleted in ';
                }
            }

            if (
                args.lhs.title === undefined &&
                args.lhs.sha !== GitService.deletedSha &&
                (lhs !== undefined || lhsPrefix !== '')
            ) {
                const suffix = GitService.shortenSha(args.lhs.sha) || '';
                args.lhs.title = `${path.basename(args.lhs.uri.fsPath)}${
                    suffix !== '' ? ` (${lhsPrefix}${suffix})` : ''
                }`;
            }
            if (args.rhs.title === undefined && args.rhs.sha !== GitService.deletedSha) {
                const suffix = GitService.shortenSha(args.rhs.sha, { uncommitted: 'working tree' }) || '';
                args.rhs.title = `${path.basename(args.rhs.uri.fsPath)}${
                    suffix !== '' ? ` (${rhsPrefix}${suffix})` : rhsPrefix
                }`;
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
                    ? GitUri.toRevisionUri(GitService.deletedSha, args.lhs.uri.fsPath, args.repoPath)
                    : lhs,
                rhs === undefined
                    ? GitUri.toRevisionUri(GitService.deletedSha, args.rhs.uri.fsPath, args.repoPath)
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
