import type { Disposable, Uri } from 'vscode';
import { workspace } from 'vscode';
import type { AIFeedbackEvent } from '../constants.telemetry';
import type { AIResultContext } from '../plus/ai/aiProviderService';
import { setContext } from '../system/-webview/context';
import { UriMap } from '../system/-webview/uriMap';
import type { Deferrable } from '../system/function/debounce';
import { debounce } from '../system/function/debounce';
import { filterMap } from '../system/iterable';

export class AIFeedbackProvider implements Disposable {
	constructor() {
		// Listen for document close events to clean up contexts
		this._disposables.push(
			workspace.onDidCloseTextDocument(document => {
				this.removeDocument(document.uri);
			}),
		);
	}

	public addChangelogDocument(uri: Uri, context: AIResultContext): void {
		this.setChangelogDocument(uri.toString(), context);
		this.addChangelogUri(uri);
	}

	private removeDocument(uri: Uri): void {
		const uriString = uri.toString();
		this.deleteChangelogDocument(uriString);
		this.removeChangelogUri(uri);
		this.deleteMarkdownDocument(uriString);
	}

	private readonly _disposables: Disposable[] = [];
	dispose(): void {
		this._disposables.forEach(d => void d.dispose());
		this._uriResponses.clear();
		this._changelogDocuments.clear();
		this._markdownDocuments.clear();
		this._changelogUris.clear();
		this._updateFeedbackContextDebounced = undefined;
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
	private readonly _changelogDocuments = new Map<string, AIResultContext>();
	getChangelogDocument(documentUri: string): AIResultContext | undefined {
		return this._changelogDocuments.get(documentUri);
	}
	private setChangelogDocument(documentUri: string, context: AIResultContext): void {
		this._changelogDocuments.set(documentUri, context);
	}
	private deleteChangelogDocument(documentUri: string): void {
		this._changelogDocuments.delete(documentUri);
	}

	// Storage for AI feedback context associated with any document
	private readonly _markdownDocuments = new Map<string, AIResultContext>();
	getMarkdownDocument(documentUri: string): AIResultContext | undefined {
		return this._markdownDocuments.get(documentUri);
	}
	setMarkdownDocument(documentUri: string, context: AIResultContext): void {
		this._markdownDocuments.set(documentUri, context);
	}
	private deleteMarkdownDocument(documentUri: string): void {
		this._markdownDocuments.delete(documentUri);
	}

	// Storage for AI feedback responses by URI
	private readonly _uriResponses = new UriMap<AIFeedbackEvent['sentiment']>();
	private _updateFeedbackContextDebounced: Deferrable<() => void> | undefined;
	private updateFeedbackContext(): void {
		this._updateFeedbackContextDebounced ??= debounce(() => {
			void setContext('gitlens:tabs:ai:helpful', [
				...filterMap(this._uriResponses, ([uri, sentiment]) => (sentiment === 'helpful' ? uri : undefined)),
			]);
			void setContext('gitlens:tabs:ai:unhelpful', [
				...filterMap(this._uriResponses, ([uri, sentiment]) => (sentiment === 'unhelpful' ? uri : undefined)),
			]);
		}, 100);
		this._updateFeedbackContextDebounced();
	}
	setFeedbackResponse(uri: Uri, sentiment: AIFeedbackEvent['sentiment']): void {
		const previous = this._uriResponses.get(uri);
		if (sentiment === previous) return;

		this._uriResponses.set(uri, sentiment);
		this.updateFeedbackContext();
	}
	getFeedbackResponse(uri: Uri): AIFeedbackEvent['sentiment'] | undefined {
		return this._uriResponses.get(uri);
	}
}
