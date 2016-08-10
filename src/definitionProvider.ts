// 'use strict';
// import {CancellationToken, CodeLens, commands, DefinitionProvider, Position, Location, TextDocument, Uri} from 'vscode';
// import {GitCodeLens} from './codeLensProvider';

// export default class GitDefinitionProvider implements DefinitionProvider {
//     public provideDefinition(document: TextDocument, position: Position, token: CancellationToken): Promise<Location> {
//         return (commands.executeCommand('vscode.executeCodeLensProvider', document.uri) as Promise<CodeLens[]>).then(lenses => {
//             let matches: CodeLens[] = [];
//             lenses.forEach(lens => {
//                 if (lens instanceof GitCodeLens && lens.blameRange.contains(position)) {
//                     matches.push(lens);
//                 }
//             });

//             if (matches.length) {
//                 return new Location(Uri.parse(), position);
//             }
//             return null;
//         });
//     }
// }
