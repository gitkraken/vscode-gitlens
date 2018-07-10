'use strict';
import { CancellationToken, CodeLens, CodeLensProvider, DocumentSelector, Range, TextDocument, Uri } from 'vscode';
import { Commands, DiffWithPreviousCommandArgs, DiffWithWorkingCommandArgs } from './commands';
import { DocumentSchemes } from './constants';
import { Container } from './container';
import { GitCommit, GitUri } from './gitService';

export class GitDiffWithWorkingCodeLens extends CodeLens {
    constructor(
        public readonly fileName: string,
        public readonly commit: GitCommit,
        range: Range
    ) {
        super(range);
    }
}

export class GitDiffWithPreviousCodeLens extends CodeLens {
    constructor(
        public readonly fileName: string,
        public readonly commit: GitCommit,
        range: Range
    ) {
        super(range);
    }
}

export class GitRevisionCodeLensProvider implements CodeLensProvider {
    static selector: DocumentSelector = { scheme: DocumentSchemes.GitLensGit };

    async provideCodeLenses(document: TextDocument, token: CancellationToken): Promise<CodeLens[]> {
        const gitUri = GitUri.fromRevisionUri(document.uri);

        const lenses: CodeLens[] = [];

        const commit = await Container.git.getLogCommitForFile(gitUri.repoPath, gitUri.fsPath, {
            ref: gitUri.sha,
            firstIfNotFound: true
        });
        if (commit === undefined) return lenses;

        if (commit.previousSha) {
            lenses.push(new GitDiffWithPreviousCodeLens(commit.previousUri.fsPath, commit, new Range(0, 0, 0, 1)));
        }
        lenses.push(new GitDiffWithWorkingCodeLens(commit.uri.fsPath, commit, new Range(0, 1, 0, 2)));

        return lenses;
    }

    resolveCodeLens(lens: CodeLens, token: CancellationToken): Thenable<CodeLens> {
        if (lens instanceof GitDiffWithWorkingCodeLens) return this._resolveDiffWithWorkingTreeCodeLens(lens, token);
        if (lens instanceof GitDiffWithPreviousCodeLens) return this._resolveGitDiffWithPreviousCodeLens(lens, token);
        return Promise.reject<CodeLens>(undefined);
    }

    _resolveDiffWithWorkingTreeCodeLens(
        lens: GitDiffWithWorkingCodeLens,
        token: CancellationToken
    ): Thenable<CodeLens> {
        lens.command = {
            title: `Compare Revision (${lens.commit.shortSha}) with Working`,
            command: Commands.DiffWithWorking,
            arguments: [
                Uri.file(lens.fileName),
                {
                    commit: lens.commit,
                    line: lens.range.start.line
                } as DiffWithWorkingCommandArgs
            ]
        };
        return Promise.resolve(lens);
    }

    _resolveGitDiffWithPreviousCodeLens(
        lens: GitDiffWithPreviousCodeLens,
        token: CancellationToken
    ): Thenable<CodeLens> {
        lens.command = {
            title: `Compare Revision (${lens.commit.shortSha}) with Previous (${lens.commit.previousShortSha})`,
            command: Commands.DiffWithPrevious,
            arguments: [
                Uri.file(lens.fileName),
                {
                    commit: lens.commit,
                    line: lens.range.start.line
                } as DiffWithPreviousCommandArgs
            ]
        };
        return Promise.resolve(lens);
    }
}
