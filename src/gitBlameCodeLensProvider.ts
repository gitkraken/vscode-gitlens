'use strict';
import {CancellationToken, CodeLens, CodeLensProvider, commands, DocumentSelector, ExtensionContext, Location, Position, Range, SymbolInformation, SymbolKind, TextDocument, Uri} from 'vscode';
import {BuiltInCommands, Commands, DocumentSchemes, WorkspaceState} from './constants';
import GitProvider, {IGitBlame, IGitCommit} from './gitProvider';
import * as moment from 'moment';
import * as path from 'path';

export class GitDiffWithWorkingTreeCodeLens extends CodeLens {
    constructor(private git: GitProvider, public fileName: string, public commit: IGitCommit, range: Range) {
        super(range);
    }
}

export class GitDiffWithPreviousCodeLens extends CodeLens {
    constructor(private git: GitProvider, public fileName: string, public commit: IGitCommit, range: Range) {
        super(range);
    }
}

export default class GitBlameCodeLensProvider implements CodeLensProvider {
    static selector: DocumentSelector = { scheme: DocumentSchemes.GitBlame };

    constructor(context: ExtensionContext, private git: GitProvider) { }

    provideCodeLenses(document: TextDocument, token: CancellationToken): CodeLens[] | Thenable<CodeLens[]> {
        const data = GitProvider.fromBlameUri(document.uri);
        const fileName = data.fileName;
        const sha = data.sha;

        return this.git.getBlameForFile(fileName).then(blame => {
            const lenses: CodeLens[] = [];
            if (!blame) return lenses;

            const commit = blame.commits.get(sha);
            const absoluteFileName = path.join(commit.repoPath, fileName);

            // Add codelens to each "group" of blame lines
            const lines = blame.lines.filter(l => l.sha === sha && l.originalLine >= data.range.start.line && l.originalLine <= data.range.end.line);
            let lastLine = lines[0].originalLine;
            lines.forEach(l => {
                if (l.originalLine !== lastLine + 1) {
                    lenses.push(new GitDiffWithWorkingTreeCodeLens(this.git, absoluteFileName, commit, new Range(l.originalLine, 0, l.originalLine, 1)));
                    if (commit.previousSha) {
                        lenses.push(new GitDiffWithPreviousCodeLens(this.git, absoluteFileName, commit, new Range(l.originalLine, 1, l.originalLine, 2)));
                    }
                }
                lastLine = l.originalLine;
            });

            // Check if we have a lens for the whole document -- if not add one
            if (!lenses.find(l => l.range.start.line === 0 && l.range.end.line === 0)) {
                lenses.push(new GitDiffWithWorkingTreeCodeLens(this.git, absoluteFileName, commit, new Range(0, 0, 0, 1)));
                if (commit.previousSha) {
                    lenses.push(new GitDiffWithPreviousCodeLens(this.git, absoluteFileName, commit, new Range(0, 1, 0, 2)));
                }
            }

            return lenses;
        });
    }

    resolveCodeLens(lens: CodeLens, token: CancellationToken): Thenable<CodeLens> {
        if (lens instanceof GitDiffWithWorkingTreeCodeLens) return this._resolveDiffWithWorkingTreeCodeLens(lens, token);
        if (lens instanceof GitDiffWithPreviousCodeLens) return this._resolveGitDiffWithPreviousCodeLens(lens, token);
    }

    _resolveDiffWithWorkingTreeCodeLens(lens: GitDiffWithWorkingTreeCodeLens, token: CancellationToken): Thenable<CodeLens> {
        lens.command = {
            title: `Compare with Working Tree`,
            command: Commands.DiffWithWorking,
            arguments: [
                Uri.file(lens.fileName),
                lens.commit.sha,
                lens.commit.uri,
                lens.range.start.line]
        };
        return Promise.resolve(lens);
    }

    _resolveGitDiffWithPreviousCodeLens(lens: GitDiffWithPreviousCodeLens, token: CancellationToken): Thenable<CodeLens> {
        lens.command = {
            title: `Compare with Previous (${lens.commit.previousSha})`,
            command: Commands.DiffWithPrevious,
            arguments: [
                Uri.file(lens.fileName),
                lens.commit.repoPath,
                lens.commit.sha,
                lens.commit.uri,
                lens.commit.previousSha,
                lens.commit.previousUri,
                lens.range.start.line]
        };
        return Promise.resolve(lens);
    }
}
