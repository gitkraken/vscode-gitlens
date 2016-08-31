'use strict';
import {CodeLens, commands, DocumentSelector, ExtensionContext, languages, Position, Range, Uri, window, workspace} from 'vscode';
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

        context.subscriptions.push(commands.registerCommand(Commands.ShowBlameHistory, (uri?: Uri, range?: Range, position?: Position) => {
            // If the command is executed manually -- treat it as a click on the root lens (i.e. show blame for the whole file)
            if (!uri) {
                const doc = window.activeTextEditor && window.activeTextEditor.document;
                if (doc) {
                    uri = doc.uri;
                    range = doc.validateRange(new Range(0, 0, 1000000, 1000000));
                    position = doc.validateRange(new Range(0, 0, 0, 1000000)).start;
                }

                if (!uri) return;
            }

            console.log(uri.path, blameProvider.repoPath, range, position);
            return blameProvider.getBlameLocations(uri.path, blameProvider.repoPath, range).then(locations => {
                return commands.executeCommand(VsCodeCommands.ShowReferences, uri, position, locations);
            });
        }));

        const selector: DocumentSelector = { scheme: 'file' };
        context.subscriptions.push(languages.registerCodeLensProvider(selector, new GitCodeLensProvider(context, blameProvider)));
    }).catch(reason => console.warn(reason));
}

// this method is called when your extension is deactivated
export function deactivate() {
}