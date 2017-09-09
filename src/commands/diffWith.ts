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
        let args = argsOrCommit1;
        if (argsOrCommit1 instanceof GitCommit) {
            const commit1 = argsOrCommit1;

            if (commit2 === undefined) {
                if (commit1.isUncommitted) {
                    args = {
                        repoPath: commit1.repoPath,
                        lhs: {
                            sha: commit1.sha,
                            uri: commit1.uri
                        },
                        rhs: {
                            sha: 'HEAD',
                            uri: commit1.uri
                        }
                    };
                }
                else {
                    args = {
                        repoPath: commit1.repoPath,
                        lhs: {
                            sha: commit1.previousSha!,
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

        return super.getMarkdownCommandArgsCore<DiffWithCommandArgs>(Commands.DiffWith, args);
    }

    constructor(private git: GitService) {
        super(Commands.DiffWith);
    }

    async execute(editor?: TextEditor, uri?: Uri, args: DiffWithCommandArgs = {}): Promise<any> {
        if (args.repoPath === undefined || args.lhs === undefined || args.rhs === undefined) return undefined;

        if (args.lhs.title === undefined) {
            args.lhs.title = (args.lhs.sha === 'HEAD')
                ? `${path.basename(args.lhs.uri.fsPath)}`
                : `${path.basename(args.lhs.uri.fsPath)} (${GitService.shortenSha(args.lhs.sha)})`;
        }
        if (args.rhs.title === undefined) {
            args.rhs.title = (args.rhs.sha === 'HEAD')
            ? `${path.basename(args.rhs.uri.fsPath)}`
            : `${path.basename(args.rhs.uri.fsPath)} (${GitService.shortenSha(args.rhs.sha)})`;
        }

        try {
            const [lhs, rhs] = await Promise.all([
                args.lhs.sha !== 'HEAD'
                    ? this.git.getVersionedFile(args.repoPath, args.lhs.uri.fsPath, args.lhs.sha)
                    : args.lhs.uri.fsPath,
                args.rhs.sha !== 'HEAD'
                    ? this.git.getVersionedFile(args.repoPath, args.rhs.uri.fsPath, args.rhs.sha)
                    : args.rhs.uri.fsPath
            ]);

            if (args.line !== undefined && args.line !== 0) {
                if (args.showOptions === undefined) {
                    args.showOptions = {};
                }
                args.showOptions.selection = new Range(args.line, 0, args.line, 0);
            }

            await commands.executeCommand(BuiltInCommands.Diff,
                Uri.file(lhs),
                Uri.file(rhs),
                `${args.lhs.title} ${GlyphChars.ArrowLeftRight} ${args.rhs.title}`,
                args.showOptions);
        }
        catch (ex) {
            Logger.error(ex, 'DiffWithCommand', 'getVersionedFile');
            return window.showErrorMessage(`Unable to open compare. See output channel for more details`);
        }
    }
}