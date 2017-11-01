'use strict';
import { CancellationToken, ExtensionContext, TextDocumentContentProvider, Uri, window } from 'vscode';
import { DocumentSchemes } from './constants';
import { GitService } from './gitService';
import { Logger } from './logger';
import * as path from 'path';

export class GitContentProvider implements TextDocumentContentProvider {

    static scheme = DocumentSchemes.GitLensGit;

    constructor(
        context: ExtensionContext,
        private readonly git: GitService
    ) { }

    async provideTextDocumentContent(uri: Uri, token: CancellationToken): Promise<string | undefined> {
        const data = GitService.fromGitContentUri(uri);
        if (data.sha === GitService.fakeSha) return '';

        const fileName = data.originalFileName || data.fileName;

        try {
            return await this.git.getVersionedFileText(data.repoPath, fileName, data.sha);
        }
        catch (ex) {
            Logger.error(ex, 'GitContentProvider', 'getVersionedFileText');
            window.showErrorMessage(`Unable to show Git revision ${GitService.shortenSha(data.sha)} of '${path.relative(data.repoPath, fileName)}'`);
            return undefined;
        }
    }
}