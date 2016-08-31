'use strict';
import {CodeLens, commands, DocumentSelector, ExtensionContext, languages, Range, Uri, window, workspace} from 'vscode';
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

        const blameProvider = new GitBlameProvider(context);
        context.subscriptions.push(blameProvider);

        context.subscriptions.push(workspace.registerTextDocumentContentProvider(GitContentProvider.scheme, new GitContentProvider(context, blameProvider)));

        context.subscriptions.push(commands.registerCommand(Commands.ShowBlameHistory, (uri: Uri, blameRange?: Range, range?: Range) => {
            if (!uri) {
                const doc = window.activeTextEditor && window.activeTextEditor.document;
                if (doc) {
                    uri = doc.uri;
                    blameRange = doc.validateRange(new Range(0, 0, 1000000, 1000000));
                    range = doc.validateRange(new Range(0, 0, 0, 1000000));
                }

                if (!uri) return;
            }

            return blameProvider.getBlameLocations(uri.path, blameProvider.repoPath, blameRange).then(locations => {
                return commands.executeCommand(VsCodeCommands.ShowReferences, uri, range, locations);
            });
        }));

        const selector: DocumentSelector = { scheme: 'file' };
        context.subscriptions.push(languages.registerCodeLensProvider(selector, new GitCodeLensProvider(context, blameProvider)));
    }).catch(reason => console.warn(reason));
}

// this method is called when your extension is deactivated
export function deactivate() {
}