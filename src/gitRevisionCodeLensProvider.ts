'use strict';
import { Iterables } from './system';
import { CancellationToken, CodeLens, CodeLensProvider, DocumentSelector, ExtensionContext, Range, TextDocument, Uri } from 'vscode';
import { Commands } from './commands';
import { DocumentSchemes } from './constants';
import { GitCommit, GitService, GitUri } from './gitService';

export class GitDiffWithWorkingCodeLens extends CodeLens {

    constructor(git: GitService, public fileName: string, public commit: GitCommit, range: Range) {
        super(range);
    }
}

export class GitDiffWithPreviousCodeLens extends CodeLens {

    constructor(git: GitService, public fileName: string, public commit: GitCommit, range: Range) {
        super(range);
    }
}

export class GitRevisionCodeLensProvider implements CodeLensProvider {

    static selector: DocumentSelector = { scheme: DocumentSchemes.GitLensGit };

    constructor(context: ExtensionContext, private git: GitService) { }

    async provideCodeLenses(document: TextDocument, token: CancellationToken): Promise<CodeLens[]> {
        const data = GitService.fromGitContentUri(document.uri);
        const gitUri = new GitUri(Uri.file(data.fileName), data);

        const lenses: CodeLens[] = [];

        const log = await this.git.getLogForFile(gitUri.fsPath, gitUri.sha, gitUri.repoPath, undefined, 2);
        if (!log) return lenses;

        const commit = (gitUri.sha && log.commits.get(gitUri.sha)) || Iterables.first(log.commits.values());
        if (!commit) return lenses;

        lenses.push(new GitDiffWithWorkingCodeLens(this.git, commit.uri.fsPath, commit, new Range(0, 0, 0, 1)));

        if (commit.previousSha) {
            lenses.push(new GitDiffWithPreviousCodeLens(this.git, commit.previousUri.fsPath, commit, new Range(0, 1, 0, 2)));
        }

        return lenses;
    }

    resolveCodeLens(lens: CodeLens, token: CancellationToken): Thenable<CodeLens> {
        if (lens instanceof GitDiffWithWorkingCodeLens) return this._resolveDiffWithWorkingTreeCodeLens(lens, token);
        if (lens instanceof GitDiffWithPreviousCodeLens) return this._resolveGitDiffWithPreviousCodeLens(lens, token);
        return Promise.reject<CodeLens>(undefined);
    }

    _resolveDiffWithWorkingTreeCodeLens(lens: GitDiffWithWorkingCodeLens, token: CancellationToken): Thenable<CodeLens> {
        lens.command = {
            title: `Compare ${lens.commit.shortSha} with Working Tree`,
            command: Commands.DiffWithWorking,
            arguments: [
                Uri.file(lens.fileName),
                lens.commit,
                lens.range.start.line
            ]
        };
        return Promise.resolve(lens);
    }

    _resolveGitDiffWithPreviousCodeLens(lens: GitDiffWithPreviousCodeLens, token: CancellationToken): Thenable<CodeLens> {
        lens.command = {
            title: `Compare ${lens.commit.shortSha} with Previous ${lens.commit.previousShortSha}`,
            command: Commands.DiffWithPrevious,
            arguments: [
                Uri.file(lens.fileName),
                lens.commit,
                lens.range.start.line
            ]
        };
        return Promise.resolve(lens);
    }
}
