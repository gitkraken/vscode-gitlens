'use strict';
import { CancellationToken, ExtensionContext, TextDocumentContentProvider, Uri, window } from 'vscode';
import { DocumentSchemes } from './constants';
import { GitService, GitUri } from './gitService';
import { Logger } from './logger';
import * as path from 'path';

export class GitContentProvider implements TextDocumentContentProvider {

    static scheme = DocumentSchemes.GitLensGit;

    constructor(
        context: ExtensionContext,
        private readonly git: GitService
    ) { }

    async provideTextDocumentContent(uri: Uri, token: CancellationToken): Promise<string | undefined> {
        const gitUri = GitUri.fromRevisionUri(uri);
        if (!gitUri.repoPath || gitUri.sha === GitService.deletedSha) return '';

        try {
            return await this.git.getVersionedFileText(gitUri.repoPath, gitUri.fsPath, gitUri.sha || 'HEAD');
        }
        catch (ex) {
            Logger.error(ex, 'GitContentProvider', 'getVersionedFileText');
            window.showErrorMessage(`Unable to show Git revision ${GitService.shortenSha(gitUri.sha)} of '${path.relative(gitUri.repoPath, gitUri.fsPath)}'`);
            return undefined;
        }
    }
}