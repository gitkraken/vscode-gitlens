'use strict';
import { ExtensionContext, TextDocumentContentProvider, Uri, window } from 'vscode';
import { DocumentSchemes } from './constants';
import { GitService } from './gitService';
import { Logger } from './logger';
import * as path from 'path';

export class GitContentProvider implements TextDocumentContentProvider {

    static scheme = DocumentSchemes.GitLensGit;

    constructor(context: ExtensionContext, private git: GitService) { }

    async provideTextDocumentContent(uri: Uri): Promise<string> {
        const data = GitService.fromGitContentUri(uri);
        const fileName = data.originalFileName || data.fileName;
        try {
            let text = await this.git.getVersionedFileText(fileName, data.repoPath, data.sha) as string;
            if (data.decoration) {
                text = `${data.decoration}\n${text}`;
            }
            return text;
        }
        catch (ex) {
            Logger.error('[GitLens.GitContentProvider]', 'getVersionedFileText', ex);
            await window.showErrorMessage(`Unable to show Git revision ${data.sha.substring(0, 8)} of '${path.relative(data.repoPath, fileName)}'`);
            return undefined;
        }
    }
}