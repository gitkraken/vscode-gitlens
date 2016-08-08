'use strict';
import {DocumentSelector, ExtensionContext, languages, workspace} from 'vscode';
import GitCodeLensProvider from './codeLensProvider';
import {gitRepoPath} from './git'

// this method is called when your extension is activated
export function activate(context: ExtensionContext) {
    // Workspace not using a folder. No access to git repo.
    if (!workspace.rootPath) {
        return;
    }

    gitRepoPath(workspace.rootPath).then(repoPath => {
        let selector: DocumentSelector = { scheme: 'file' };
        context.subscriptions.push(languages.registerCodeLensProvider(selector, new GitCodeLensProvider(repoPath)));
    }).catch(reason => console.warn(reason));
}

// this method is called when your extension is deactivated
export function deactivate() {
}