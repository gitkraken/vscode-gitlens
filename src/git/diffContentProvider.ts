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
			workspace.registerTextDocumentContentProvider(DocumentSchemes.GitLensDiff, this),
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
		} catch (ex) {
			Logger.error(ex, 'GitDiffContentProvider');
			window.showErrorMessage(
				`Unable to show Git diff for revision ${GitService.shortenSha(data.ref1)} to ${GitService.shortenSha(
					data.ref2,
				)} of '${data.repoPath}'`,
			);
			return undefined;
		}
	}
}

// export class GitDiffEditorProvider implements CustomEditorProvider, CustomEditorEditingDelegate, Disposable {
// 	private readonly _disposable: Disposable;

// 	constructor() {
// 		this._disposable = Disposable.from(
// 			window.registerCustomEditorProvider('gitlens.diff', this, {
// 				webviewOptions: {
// 					enableFindWidget: false,
// 				},
// 			}),
// 		);
// 	}

// 	dispose() {
// 		this._disposable && this._disposable.dispose();
// 	}

// 	async openCustomDocument(uri: Uri, token: CancellationToken): Promise<MyCustomDocument> {
// 		const myCustomDocument = new MyCustomDocument('binary.editor', uri);
// 		myCustomDocument.hex = await myCustomDocument.resolve();

// 		return myCustomDocument;
// 	}

// 	async resolveCustomEditor(
// 		document: MyCustomDocument,
// 		webviewPanel: WebviewPanel,
// 		token: CancellationToken,
// 	): Promise<void> {
// 		const disposables: Disposable[] = [];

// 		disposables.push(
// 			webviewPanel.onDidDispose(() => {
// 				disposables.forEach(d => d.dispose());
// 			}),
// 		);

// 		webviewPanel.webview.options = { enableScripts: true };

// 		disposables.push(
// 			webviewPanel.webview.onDidReceiveMessage(e => {
// 				const oldHex: [number, number, number] = [document.hex[0], document.hex[1], document.hex[2]];

// 				switch (e.type) {
// 					case 'webview->exthost:ready':
// 						webviewPanel.webview.postMessage({
// 							type: 'exhost->webview:setHex',
// 							payload: [document.hex[0], document.hex[1], document.hex[2]],
// 						});
// 						break;
// 					case 'webview->exthost:byte-one':
// 						document.hex = [Number(e.payload), document.hex[1], document.hex[2]];
// 						this._onDidEdit.fire({
// 							document: document,
// 							edit: { oldHex: oldHex, newHex: document.hex.slice(0) as [number, number, number] },
// 							label: `Byte One Changed To ${e.payload}`,
// 						});
// 						break;
// 					case 'webview->exthost:byte-two':
// 						document.hex = [document.hex[0], Number(e.payload), document.hex[2]];
// 						this._onDidEdit.fire({
// 							document: document,
// 							edit: { oldHex: oldHex, newHex: document.hex.slice(0) as [number, number, number] },
// 							label: `Byte Two Changed To ${e.payload}`,
// 						});
// 						break;
// 					case 'webview->exthost:byte-three':
// 						document.hex = [document.hex[0], document.hex[1], Number(e.payload)];
// 						this._onDidEdit.fire({
// 							document: document,
// 							edit: { oldHex: oldHex, newHex: document.hex.slice(0) as [number, number, number] },
// 							label: `Byte Three Changed To ${e.payload}`,
// 						});
// 						break;
// 				}
// 			}),
// 		);

// 		disposables.push(
// 			document.onDidChange(() => {
// 				webviewPanel.webview.postMessage({
// 					type: 'exhost->webview:setHex',
// 					payload: [document.hex[0], document.hex[1], document.hex[2]],
// 				});
// 			}),
// 		);

// 		webviewPanel.webview.html = this.getEditorHtml(document, webviewPanel);
// 	}

// 	private getEditorHtml(document: MyCustomDocument, panel: WebviewPanel): string {
// 		return `
// 		<html>
// 			<head>
// 			</head>
// 			<body>
// 				<input id="byte-one"></input>
// 				<input id="byte-two"></input>
// 				<input id="byte-three"></input>
// 				<script src="${panel.webview.asWebviewUri(Uri.file(paths.resolve(__dirname, '..', 'static', 'editor.js')))}"></script>
// 			</body>
// 		</html>`;
// 	}

// 	get editingDelegate() {
// 		return this;
// 	}

// 	private _onDidEdit = new EventEmitter<CustomDocumentEditEvent<MyCustomEdit>>();
// 	onDidEdit: Event<CustomDocumentEditEvent<MyCustomEdit>> = this._onDidEdit.event;

// 	async save(document: MyCustomDocument, cancellation: CancellationToken): Promise<void> {
// 		return document.save();
// 	}

// 	async saveAs(document: MyCustomDocument, targetResource: Uri): Promise<void> {
// 		return document.save(targetResource);
// 	}

// 	async applyEdits(document: MyCustomDocument, edits: readonly MyCustomEdit[]): Promise<void> {
// 		document.applyEdits(edits);
// 	}

// 	async undoEdits(document: MyCustomDocument, edits: readonly MyCustomEdit[]): Promise<void> {
// 		document.undoEdits(edits);
// 	}

// 	async revert(document: MyCustomDocument, edits: CustomDocumentRevert<MyCustomEdit>): Promise<void> {
// 		return document.revert();
// 	}

// 	async backup(document: MyCustomDocument, cancellation: CancellationToken): Promise<void> {
// 		return document.backup();
// 	}

//     interface MyCustomEdit {
//         oldHex: [number, number, number];
//         newHex: [number, number, number];
//     }

//     class MyCustomDocument extends CustomDocument<MyCustomEdit> {

//         public hex: [number, number, number] = [0, 0, 0];

//         private get backupUri() { return this.uri.with({ path: `${this.uri.path}.bak` }); }

//         private _onDidChange = new EventEmitter<void>();
//         onDidChange: Event<void> = this._onDidChange.event;

//         setHex(newHex: [number, number, number]): void {
//             const currentHex = this.hex;
//             if (!currentHex) {
//                 return;
//             }

//             if (newHex[0] !== currentHex[0] || newHex[1] !== currentHex[1] || newHex[2] !== currentHex[2]) {
//                 this.hex = newHex;
//                 this._onDidChange.fire();
//             }
//         }

//         async resolve(): Promise<[number, number, number]> {
//             let hex;
//             try {
//                 hex = (await workspace.fs.readFile(this.backupUri)).slice(0, 3);
//             } catch (error) {
//                 hex = (await workspace.fs.readFile(this.uri)).slice(0, 3);
//             }

//             return [hex[0], hex[1], hex[2]];
//         }

//         async revert(): Promise<void> {
//             this.setHex(await this.resolve());

//             return this.delBackup();
//         }

//         async save(target = this.uri, delBackup = true): Promise<void> {
//             const buffer = await workspace.fs.readFile(this.uri);

//             await workspace.fs.writeFile(target, Buffer.from([...this.hex, ...buffer.slice(3)]));

//             if (delBackup) {
//                 return this.delBackup();
//             }
//         }

//         applyEdits(edits: readonly MyCustomEdit[]): void {
//             for (const edit of edits) {
//                 this.setHex(edit.newHex);
//             }
//         }

//         undoEdits(edits: readonly MyCustomEdit[]): void {
//             for (const edit of edits) {
//                 this.setHex(edit.oldHex);
//             }
//         }

//         backup(): Promise<void> {
//             return this.save(this.backupUri, false);
//         }

//         async delBackup(): Promise<void> {
//             try {
//                 await workspace.fs.delete(this.backupUri);
//             } catch (error) {
//                 // ignore if not exists
//             }
//         }
// }
