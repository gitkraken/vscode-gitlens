'use strict';
import {CancellationToken, CodeLens, CodeLensProvider, commands, DocumentSelector, ExtensionContext, Location, Position, Range, SymbolInformation, SymbolKind, TextDocument, Uri} from 'vscode';
import {Commands, DocumentSchemes, VsCodeCommands, WorkspaceState} from './constants';
import GitProvider, {IGitBlame, IGitCommit} from './gitProvider';
import {join} from 'path';
import * as moment from 'moment';

export class GitDiffWithWorkingTreeCodeLens extends CodeLens {
    constructor(private git: GitProvider, public fileName: string, public sha: string, range: Range) {
        super(range);
    }
}

export class GitDiffWithPreviousCodeLens extends CodeLens {
    constructor(private git: GitProvider, public fileName: string, public sha: string, public compareWithSha: string, range: Range) {
        super(range);
    }
}

export default class GitBlameCodeLensProvider implements CodeLensProvider {
    static selector: DocumentSelector = { scheme: DocumentSchemes.GitBlame };

    constructor(context: ExtensionContext, private git: GitProvider) { }

    provideCodeLenses(document: TextDocument, token: CancellationToken): CodeLens[] | Thenable<CodeLens[]> {
        const data = this.git.fromBlameUri(document.uri);
        const fileName = data.fileName;
        const sha = data.sha;

        return this.git.getBlameForFile(fileName).then(blame => {
            const commits = Array.from(blame.commits.values());
            let index = commits.findIndex(c => c.sha === sha) + 1;

            let previousCommit: IGitCommit;
            if (index < commits.length) {
                previousCommit = commits[index];
            }

            const lenses: CodeLens[] = [];

            // Add codelens to each "group" of blame lines
            const lines = blame.lines.filter(l => l.sha === sha && l.originalLine >= data.range.start.line && l.originalLine <= data.range.end.line);
            let lastLine = lines[0].originalLine;
            lines.forEach(l => {
                if (l.originalLine !== lastLine + 1) {
                    lenses.push(new GitDiffWithWorkingTreeCodeLens(this.git, fileName, sha, new Range(l.originalLine, 0, l.originalLine, 1)));
                    if (previousCommit) {
                        lenses.push(new GitDiffWithPreviousCodeLens(this.git, fileName, sha, previousCommit.sha, new Range(l.originalLine, 1, l.originalLine, 2)));
                    }
                }
                lastLine = l.originalLine;
            });

            // Check if we have a lens for the whole document -- if not add one
            if (!lenses.find(l => l.range.start.line === 0 && l.range.end.line === 0)) {
                lenses.push(new GitDiffWithWorkingTreeCodeLens(this.git, fileName, sha, new Range(0, 0, 0, 1)));
                if (previousCommit) {
                    lenses.push(new GitDiffWithPreviousCodeLens(this.git, fileName, sha, previousCommit.sha, new Range(0, 1, 0, 2)));
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
            arguments: [Uri.file(join(this.git.repoPath, lens.fileName)), lens.sha]
        };
        return Promise.resolve(lens);
    }

    _resolveGitDiffWithPreviousCodeLens(lens: GitDiffWithPreviousCodeLens, token: CancellationToken): Thenable<CodeLens> {
        lens.command = {
            title: `Compare with Previous (${lens.compareWithSha})`,
            command: Commands.DiffWithPrevious,
            arguments: [Uri.file(join(this.git.repoPath, lens.fileName)), lens.sha, lens.compareWithSha]
        };
        return Promise.resolve(lens);
    }
}
