'use strict';
import {commands, DocumentSelector, ExtensionContext, languages, workspace} from 'vscode';
import GitCodeLensProvider from './codeLensProvider';
import GitContentProvider from './contentProvider';
import {gitRepoPath} from './git';
import {Commands, VsCodeCommands} from './constants';

// this method is called when your extension is activated
export function activate(context: ExtensionContext) {
    // Workspace not using a folder. No access to git repo.
    if (!workspace.rootPath) {
        console.warn('Git CodeLens inactive: no rootPath');

        return;
    }

    console.log(`Git CodeLens active: ${workspace.rootPath}`);

    gitRepoPath(workspace.rootPath).then(repoPath => {
        context.subscriptions.push(workspace.registerTextDocumentContentProvider(GitContentProvider.scheme, new GitContentProvider(context)));

        context.subscriptions.push(commands.registerCommand(Commands.ShowBlameHistory, (...args) => {
            return commands.executeCommand(VsCodeCommands.ShowReferences, ...args);
        }));

        const selector: DocumentSelector = { scheme: 'file' };
        context.subscriptions.push(languages.registerCodeLensProvider(selector, new GitCodeLensProvider(repoPath)));
    }).catch(reason => console.warn(reason));
}

// this method is called when your extension is deactivated
export function deactivate() {
}