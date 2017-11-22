'use strict';
import { commands, Range, TextDocumentShowOptions, TextEditor, Uri, window } from 'vscode';
import { ActiveEditorCommand, Commands } from './common';
import { BuiltInCommands, GlyphChars } from '../constants';
import { GitCommit, GitService } from '../gitService';
import { Logger } from '../logger';
import * as path from 'path';

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

    constructor(
        private readonly git: GitService
    ) {
        super(Commands.DiffWith);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: DiffWithCommandArgs = {}): Promise<any> {
        args = { ...args };
        if (args.repoPath === undefined || args.lhs === undefined || args.rhs === undefined) return undefined;

        try {
            const [lhs, rhs] = await Promise.all([
                this.git.getVersionedFile(args.repoPath, args.lhs.uri.fsPath, args.lhs.sha),
                this.git.getVersionedFile(args.repoPath, args.rhs.uri.fsPath, args.rhs.sha)
            ]);

            if (args.line !== undefined && args.line !== 0) {
                if (args.showOptions === undefined) {
                    args.showOptions = {};
                }
                args.showOptions.selection = new Range(args.line, 0, args.line, 0);
            }

            let rhsPrefix = '';
            if (rhs === undefined) {
                rhsPrefix = 'deleted in ';
            }
            else if (lhs === undefined || args.lhs.sha === GitService.deletedSha) {
                rhsPrefix = 'added in ';
            }

            if (args.lhs.title === undefined && lhs !== undefined && args.lhs.sha !== GitService.deletedSha) {
                const suffix = GitService.shortenSha(args.lhs.sha) || '';
                args.lhs.title = `${path.basename(args.lhs.uri.fsPath)}${suffix !== '' ? ` (${suffix})` : ''}`;
            }
            if (args.rhs.title === undefined && args.rhs.sha !== GitService.deletedSha) {
                const suffix = GitService.shortenSha(args.rhs.sha) || '';
                args.rhs.title = `${path.basename(args.rhs.uri.fsPath)}${suffix !== '' ? ` (${rhsPrefix}${suffix})` : ''}`;
            }

            const title = (args.lhs.title !== undefined && args.rhs.title !== undefined)
                ? `${args.lhs.title} ${GlyphChars.ArrowLeftRight} ${args.rhs.title}`
                : args.lhs.title || args.rhs.title;

            return await commands.executeCommand(BuiltInCommands.Diff,
                lhs === undefined
                    ? GitService.toGitContentUri(GitService.deletedSha, args.lhs.uri.fsPath, args.repoPath)
                    : Uri.file(lhs),
                rhs === undefined
                    ? GitService.toGitContentUri(GitService.deletedSha, args.rhs.uri.fsPath, args.repoPath)
                    : Uri.file(rhs),
                title,
                args.showOptions);
        }
        catch (ex) {
            Logger.error(ex, 'DiffWithCommand', 'getVersionedFile');
            return window.showErrorMessage(`Unable to open compare. See output channel for more details`);
        }
    }
}