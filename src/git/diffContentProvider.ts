'use strict';
import { CancellationToken, Disposable, TextDocumentContentProvider, Uri, window, workspace } from 'vscode';
import { DocumentSchemes } from '../constants';
import { Container } from '../container';
import { Logger } from '../logger';
import { GitService, GitUri } from './gitService';

export class GitDiffContentProvider implements TextDocumentContentProvider, Disposable {
    private readonly _disposable: Disposable;

    constructor() {
        this._disposable = Disposable.from(
            workspace.registerTextDocumentContentProvider(DocumentSchemes.GitLensDiff, this)
        );
    }

    dispose() {
        this._disposable && this._disposable.dispose();
    }

    async provideTextDocumentContent(uri: Uri, token: CancellationToken): Promise<string | undefined> {
        const data = GitUri.getDataFromDiffUri(uri);
        if (data === undefined) return '';

        try {
            const diff = await Container.git.getDiff(data.repoPath, data.ref1, data.ref2);
            return diff || '';
        }
        catch (ex) {
            Logger.error(ex, 'GitDiffContentProvider');
            window.showErrorMessage(
                `Unable to show Git diff for revision ${GitService.shortenSha(data.ref1)} to ${GitService.shortenSha(
                    data.ref2
                )} of '${data.repoPath}'`
            );
            return undefined;
        }
    }
}
