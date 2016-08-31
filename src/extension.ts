'use strict';
import {CodeLens, commands, DocumentSelector, ExtensionContext, languages, Uri, window, workspace} from 'vscode';
import GitCodeLensProvider, {GitBlameCodeLens} from './codeLensProvider';
import GitContentProvider from './contentProvider';
import {gitRepoPath} from './git';
import GitBlameProvider from './gitBlameProvider';
import {Commands, VsCodeCommands, WorkspaceState} from './constants';

// this method is called when your extension is activated
export function activate(context: ExtensionContext) {
    // Workspace not using a folder. No access to git repo.
    if (!workspace.rootPath) {
        console.warn('GitLens inactive: no rootPath');

        return;
    }

    console.log(`GitLens active: ${workspace.rootPath}`);
    gitRepoPath(workspace.rootPath).then(repoPath => {
        context.workspaceState.update(WorkspaceState.RepoPath, repoPath);

        const blameProvider = new GitBlameProvider();
        context.subscriptions.push(blameProvider);

        context.subscriptions.push(workspace.registerTextDocumentContentProvider(GitContentProvider.scheme, new GitContentProvider(context, blameProvider)));

        context.subscriptions.push(commands.registerCommand(Commands.ShowBlameHistory, (...args) => {
            if (args && args.length) {
                return commands.executeCommand(VsCodeCommands.ShowReferences, ...args);
            }

            // const uri = window.activeTextEditor && window.activeTextEditor.document && window.activeTextEditor.document.uri;
            // if (uri) {
            //     return (commands.executeCommand(VsCodeCommands.ExecuteCodeLensProvider, uri) as Promise<CodeLens[]>).then(lenses => {
            //         const lens = <GitBlameCodeLens>lenses.find(l => l instanceof GitBlameCodeLens);
            //         if (lens) {
            //             return commands.executeCommand(Commands.ShowBlameHistory, Uri.file(lens.fileName), lens.range.start, lens.locations);
            //         }
            //     });
            // }
        }));

        const selector: DocumentSelector = { scheme: 'file' };
        context.subscriptions.push(languages.registerCodeLensProvider(selector, new GitCodeLensProvider(context, blameProvider)));
    }).catch(reason => console.warn(reason));
}

// this method is called when your extension is deactivated
export function deactivate() {
}