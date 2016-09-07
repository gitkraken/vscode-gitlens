'use strict';
import {CancellationToken, CodeActionContext, CodeActionProvider, Command, DocumentSelector, ExtensionContext, Range, TextDocument, Uri, window} from 'vscode';
import {Commands, DocumentSchemes} from './constants';
import GitProvider from './gitProvider';
import {DiagnosticSource} from './constants';

export default class GitCodeActionProvider implements CodeActionProvider {
    static selector: DocumentSelector = { scheme: DocumentSchemes.File };

    constructor(context: ExtensionContext, private git: GitProvider) { }

    provideCodeActions(document: TextDocument, range: Range, context: CodeActionContext, token: CancellationToken): Command[] | Thenable<Command[]> {
        if (!context.diagnostics.some(d => d.source === DiagnosticSource)) {
            return [];
        }

        return this.git.getBlameForLine(document.fileName, range.start.line)
            .then(blame => {
                const actions: Command[] = [];
                if (blame.commit.sha) {
                    actions.push({
                        title: `GitLens: Diff ${blame.commit.sha} with working tree`,
                        command: Commands.DiffWithWorking,
                        arguments: [
                            Uri.file(document.fileName),
                            blame.commit.sha, blame.commit.toUri(),
                            blame.line.line
                        ]
                    });
                }

                if (blame.commit.sha && blame.commit.previousSha) {
                    actions.push({
                        title: `GitLens: Diff ${blame.commit.sha} with previous ${blame.commit.previousSha}`,
                        command: Commands.DiffWithPrevious,
                        arguments: [
                            Uri.file(document.fileName),
                            blame.commit.sha, blame.commit.toUri(),
                            blame.commit.previousSha, blame.commit.toPreviousUri(),
                            blame.line.line
                        ]
                    });
                }

                return actions;
            });
    }
}