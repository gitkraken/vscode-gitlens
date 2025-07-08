import type { Disposable, Uri } from 'vscode';
import { workspace } from 'vscode';
import type { AIResultContext } from '../plus/ai/aiProviderService';
import { setContext } from '../system/-webview/context';
import type { Deferrable } from '../system/function/debounce';
import { debounce } from '../system/function/debounce';

export class AIFeedbackProvider implements Disposable {
	constructor() {
		// Listen for document close events to clean up contexts
		this._disposables.push(
			workspace.onDidCloseTextDocument(document => this.removeChangelogDocument(document.uri)),
		);
	}

	public addChangelogDocument(uri: Uri, context: AIResultContext): void {
		this.setChangelogFeedback(uri.toString(), context);
		this.addChangelogUri(uri);
	}

	private removeChangelogDocument(uri: Uri): void {
		this.deleteChangelogFeedback(uri.toString());
		this.removeChangelogUri(uri);
	}

	private readonly _disposables: Disposable[] = [];
	dispose(): void {
		this._disposables.forEach(d => void d.dispose());
		this._changelogFeedbacks.clear();
		this._changelogUris.clear();
		this._updateChangelogContextDebounced = undefined;
	}

	// Storage for changelog document URIs
	private readonly _changelogUris = new Set<Uri>();
	private _updateChangelogContextDebounced: Deferrable<() => void> | undefined;
	private updateChangelogContext(): void {
		this._updateChangelogContextDebounced ??= debounce(() => {
			void setContext('gitlens:tabs:ai:changelog', [...this._changelogUris]);
		}, 100);
		this._updateChangelogContextDebounced();
	}
	private addChangelogUri(uri: Uri): void {
		if (!this._changelogUris.has(uri)) {
			this._changelogUris.add(uri);
			this.updateChangelogContext();
		}
	}
	private removeChangelogUri(uri: Uri): void {
		if (this._changelogUris.has(uri)) {
			this._changelogUris.delete(uri);
			this.updateChangelogContext();
		}
	}

	// Storage for AI feedback context associated with changelog documents
	private readonly _changelogFeedbacks = new Map<string, AIResultContext>();
	getChangelogFeedback(documentUri: string): AIResultContext | undefined {
		return this._changelogFeedbacks.get(documentUri);
	}
	private setChangelogFeedback(documentUri: string, context: AIResultContext): void {
		this._changelogFeedbacks.set(documentUri, context);
	}
	private deleteChangelogFeedback(documentUri: string): void {
		this._changelogFeedbacks.delete(documentUri);
	}
}
