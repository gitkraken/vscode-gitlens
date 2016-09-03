'use strict'
import {commands, DecorationOptions, Disposable, OverviewRulerLane, Position, Range, TextEditorDecorationType, Uri, window} from 'vscode';
import {Commands, VsCodeCommands} from './constants';
import GitProvider from './gitProvider';
import GitBlameController from './gitBlameController';
import {basename} from 'path';
import * as moment from 'moment';

abstract class Command extends Disposable {
    private _subscriptions: Disposable;

    constructor(command: Commands) {
        super(() => this.dispose());
        this._subscriptions = commands.registerCommand(command, this.execute.bind(this));
    }

    dispose() {
        this._subscriptions && this._subscriptions.dispose();
    }

    abstract execute(...args): any;
}

export class BlameCommand extends Command {
    constructor(private git: GitProvider, private blameController: GitBlameController) {
        super(Commands.ShowBlameHistory);
    }

    execute(uri?: Uri, range?: Range, sha?: string) {
        const editor = window.activeTextEditor;
        if (!editor) return;

        if (!range) {
            range = editor.document.validateRange(new Range(0, 0, 1000000, 1000000));
        }

        if (sha) {
            return this.blameController.toggleBlame(editor, sha);
        }

        const activeLine = editor.selection.active.line;
        return this.git.getBlameForLine(editor.document.fileName, activeLine)
            .then(blame => this.blameController.toggleBlame(editor, blame.commit.sha));
    }
}

// export class BlameCommand extends Command {
//     // static Colors: Array<Array<number>> = [ [255, 152, 0], [255, 87, 34], [121, 85, 72], [158, 158, 158], [96, 125, 139], [244, 67, 54], [233, 30, 99], [156, 39, 176], [103, 58, 183] ];
//     // private _decorations: TextEditorDecorationType[] = [];

//     constructor(private git: GitProvider, private blameDecoration: TextEditorDecorationType, private highlightDecoration: TextEditorDecorationType) {
//         super(Commands.ShowBlameHistory);

//         // BlameCommand.Colors.forEach(c => {
//         //     this._decorations.push(window.createTextEditorDecorationType({
//         //         dark: {
//         //             backgroundColor: `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.15)`,
//         //             //gutterIconPath: context.asAbsolutePath('images/blame-dark.png'),
//         //             overviewRulerColor: `rgba(${c[0]}, ${c[1]}, ${c[2]}, 0.75)`,
//         //         },
//         //         //light: {
//         //             //backgroundColor: 'rgba(0, 0, 0, 0.15)',
//         //             //gutterIconPath: context.asAbsolutePath('images/blame-light.png'),
//         //             //overviewRulerColor: c //'rgba(0, 0, 0, 0.75)',
//         //         //},
//         //         // before: {
//         //         //     margin: '0 1em 0 0'
//         //         // },
//         //         // after: {
//         //         //     margin: '0 0 0 2em'
//         //         // },
//         //         //gutterIconSize: 'contain',
//         //         overviewRulerLane: OverviewRulerLane.Right,
//         //         //isWholeLine: true
//         //     }));
//         // });
//     }

//     execute(uri?: Uri, range?: Range, position?: Position) {
//         const editor = window.activeTextEditor;
//         if (!editor) {
//             return;
//         }

//         editor.setDecorations(this.blameDecoration, []);
//         editor.setDecorations(this.highlightDecoration, []);

//         const highlightDecorationRanges: Array<Range> = [];
//         const blameDecorationOptions: Array<DecorationOptions> = [];

//         this.git.getBlameForRange(uri.path, range).then(blame => {
//             if (!blame.lines.length) return;

//             const commits = Array.from(blame.commits.values());
//             const recentCommit = commits.sort((a, b) => b.date.getTime() - a.date.getTime())[0];

//             return this.git.getCommitMessages(uri.path)
//                 .then(msgs => {
//                     commits.forEach(c => {
//                         c.message = msgs.get(c.sha.substring(0, c.sha.length - 1));
//                     });

//                     blame.lines.forEach(l => {
//                         if (l.sha === recentCommit.sha) {
//                             highlightDecorationRanges.push(editor.document.validateRange(new Range(l.line, 0, l.line, 1000000)));
//                         }

//                         const c = blame.commits.get(l.sha);
//                         blameDecorationOptions.push({
//                             range: editor.document.validateRange(new Range(l.line, 0, l.line, 0)),
//                             hoverMessage: `${c.sha}: ${c.message}\n${c.author}, ${moment(c.date).format('MMMM Do, YYYY hh:MM a')}`,
//                             renderOptions: {
//                                 // dark: {
//                                 //     backgroundColor: `rgba(255, 255, 255, ${alphas.get(l.sha)})`
//                                 // },
//                                 before: {
//                                     //border: '1px solid gray',
//                                     //color: 'rgb(128, 128, 128)',
//                                     contentText: `${l.sha}`,
//                                     // margin: '0 1em 0 0',
//                                     // width: '5em'
//                                 }
//                                 // after: {
//                                 //     contentText: `${c.author}, ${moment(c.date).format('MMMM Do, YYYY hh:MM a')}`,
//                                 //     //color: 'rbg(128, 128, 128)',
//                                 //     margin: '0 0 0 2em'
//                                 // }
//                             }
//                         });
//                     });
//                 });

//             // Array.from(blame.commits.values()).forEach((c, i) => {
//             //     if (i == 0) {
//             //         highlightDecorationRanges = blame.lines
//             //             .filter(l => l.sha === c.sha)
//             //             .map(l => editor.document.validateRange(new Range(l.line, 0, l.line, 1000000)));
//             //     }

//             //     blameDecorationOptions.push(blame.lines
//             //         .filter(l => l.sha === c.sha)
//             //         .map(l => {
//             //             return {
//             //                 range: editor.document.validateRange(new Range(l.line, 0, l.line, 6)),
//             //                 hoverMessage: `${c.author}\n${moment(c.date).format('MMMM Do, YYYY hh:MM a')}\n${l.sha}`,
//             //                 renderOptions: {
//             //                     // dark: {
//             //                     //     backgroundColor: `rgba(255, 255, 255, ${alphas.get(l.sha)})`
//             //                     // },
//             //                     before: {
//             //                         //border: '1px solid gray',
//             //                         //color: 'rgb(128, 128, 128)',
//             //                         contentText: `${l.sha}`,
//             //                         // margin: '0 1em 0 0',
//             //                         // width: '5em'
//             //                     }
//             //                     // after: {
//             //                     //     contentText: `${c.author}, ${moment(c.date).format('MMMM Do, YYYY hh:MM a')}`,
//             //                     //     //color: 'rbg(128, 128, 128)',
//             //                     //     margin: '0 0 0 2em'
//             //                     // }
//             //                 }
//             //             };
//             //         }));
//             // });
//         })
//         .then(() => {
//             editor.setDecorations(this.blameDecoration, blameDecorationOptions);
//             editor.setDecorations(this.highlightDecoration, highlightDecorationRanges);
//         });

//         // this._decorations.forEach(d => editor.setDecorations(d, []));
//         // this.git.getBlameForRange(uri.path, range).then(blame => {
//         //     if (!blame.lines.length) return;

//         //     Array.from(blame.commits.values()).forEach((c, i) => {
//         //         editor.setDecorations(this._decorations[i], blame.lines.filter(l => l.sha === c.sha).map(l => {
//         //             const commit = c; //blame.commits.get(l.sha);
//         //             return {
//         //                 range: editor.document.validateRange(new Range(l.line, 0, l.line, 1000000)),
//         //                 hoverMessage: `${commit.author}\n${moment(commit.date).format('MMMM Do, YYYY hh:MM a')}\n${l.sha}`,
//         //                 renderOptions: {
//         //                     // dark: {
//         //                     //     backgroundColor: `rgba(255, 255, 255, ${alphas.get(l.sha)})`
//         //                     // },
//         //                     before: {
//         //                         color: 'rgb(128, 128, 128)',
//         //                         contentText: `${l.sha}`,
//         //                         //border: '1px solid gray',
//         //                         width: '5em',
//         //                         margin: '0 1em 0 0'
//         //                     },
//         //                     after: {
//         //                         contentText: `${commit.author}, ${moment(commit.date).format('MMMM Do, YYYY hh:MM a')}`,
//         //                         //color: 'rbg(128, 128, 128)',
//         //                         margin: '0 0 0 2em'
//         //                     }
//         //                 }
//         //             };
//         //         }));
//         //     });

//         //     //this.git.getCommitMessage(data.sha).then(msg => {
//         //         // editor.setDecorations(this._blameDecoration, blame.lines.map(l => {
//         //         //     const commit = blame.commits.get(l.sha);
//         //         //     return {
//         //         //         range: editor.document.validateRange(new Range(l.line, 0, l.line, 1000000)),
//         //         //         hoverMessage: `${commit.author}\n${moment(commit.date).format('MMMM Do, YYYY hh:MM a')}\n${l.sha}`,
//         //         //         renderOptions: {
//         //         //             // dark: {
//         //         //             //     backgroundColor: `rgba(255, 255, 255, ${alphas.get(l.sha)})`
//         //         //             // },
//         //         //             before: {
//         //         //                 contentText: `${l.sha}`,
//         //         //                 margin: '0 0 0 -10px'
//         //         //             },
//         //         //             after: {
//         //         //                 contentText: `${l.sha}`,
//         //         //                 color: 'rbg(128, 128, 128)',
//         //         //                 margin: '0 20px 0 0'
//         //         //             }
//         //         //         }
//         //         //     };
//         //         // }));
//         //     //})
//         // });

//         // // If the command is executed manually -- treat it as a click on the root lens (i.e. show blame for the whole file)
//         // if (!uri) {
//         //     const doc = window.activeTextEditor && window.activeTextEditor.document;
//         //     if (doc) {
//         //         uri = doc.uri;
//         //         range = doc.validateRange(new Range(0, 0, 1000000, 1000000));
//         //         position = doc.validateRange(new Range(0, 0, 0, 1000000)).start;
//         //     }

//         //     if (!uri) return;
//         // }

//         // return this.git.getBlameLocations(uri.path, range).then(locations => {
//         //     return commands.executeCommand(VsCodeCommands.ShowReferences, uri, position, locations);
//         // });
//     }
// }

export class DiffWithPreviousCommand extends Command {
    constructor(private git: GitProvider) {
        super(Commands.DiffWithPrevious);
    }

    execute(uri?: Uri, sha?: string, compareWithSha?: string) {
        // TODO: Execute these in parallel rather than series
        return this.git.getVersionedFile(uri.path, sha).then(source => {
            this.git.getVersionedFile(uri.path, compareWithSha).then(compare => {
                const fileName = basename(uri.path);
                return commands.executeCommand(VsCodeCommands.Diff, Uri.file(compare), Uri.file(source), `${fileName} (${compareWithSha}) ↔ ${fileName} (${sha})`);
            })
        });
    }
}

export class DiffWithWorkingCommand extends Command {
    constructor(private git: GitProvider) {
        super(Commands.DiffWithWorking);
    }

    execute(uri?: Uri, sha?: string) {
        return this.git.getVersionedFile(uri.path, sha).then(compare => {
            const fileName = basename(uri.path);
            return commands.executeCommand(VsCodeCommands.Diff, Uri.file(compare), uri, `${fileName} (${sha}) ↔ ${fileName} (index)`);
        });
    }
}