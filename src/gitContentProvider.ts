'use strict';
import * as path from 'path';
import { CancellationToken, TextDocumentContentProvider, Uri, window, workspace } from 'vscode';
import { DocumentSchemes } from './constants';
import { GitService, GitUri } from './gitService';
import { Logger } from './logger';

export class GitContentProvider implements TextDocumentContentProvider {
    static scheme = DocumentSchemes.GitLensGit;

    async provideTextDocumentContent(uri: Uri, token: CancellationToken): Promise<string | undefined> {
        const gitUri = GitUri.fromRevisionUri(uri);
        if (!gitUri.repoPath || gitUri.sha === GitService.deletedSha) return '';

        try {
            const document = await workspace.openTextDocument(
                Uri.parse(`git:/${gitUri.fsPath}?${JSON.stringify({ path: gitUri.fsPath, ref: gitUri.sha || 'HEAD' })}`)
            );
            return document.getText();
        }
        catch (ex) {
            Logger.error(ex, 'GitContentProvider', 'getVersionedFileText');
            window.showErrorMessage(
                `Unable to show Git revision ${GitService.shortenSha(gitUri.sha)} of '${path.relative(
                    gitUri.repoPath,
                    gitUri.fsPath
                )}'`
            );
            return undefined;
        }
    }
}
