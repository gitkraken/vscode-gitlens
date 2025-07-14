import type { Event, TabChangeEvent, TextDocumentContentProvider } from 'vscode';
import { Disposable, EventEmitter, TabInputCustom, Uri, window, workspace } from 'vscode';
import { Schemes } from '../constants';
import type { GlCommands } from '../constants.commands';
import type { Container } from '../container';
import { decodeGitLensRevisionUriAuthority, encodeGitLensRevisionUriAuthority } from '../git/gitUri.authority';
import type { AIResultContext } from '../plus/ai/aiProviderService';

// gitlens-ai-markdown:{explain}/{entity}/{entityID}/{model}[{/friendlyName}].md

export interface MarkdownContentMetadata {
	context: AIResultContext;
	header: { title: string; subtitle?: string };
	command?: { label: string; name: GlCommands; args?: Record<string, unknown> };
}

export class MarkdownContentProvider implements TextDocumentContentProvider {
	private contents = new Map<string, string>();
	private registration: Disposable;
	private visibilityTracker: Disposable;

	private _onDidChange = new EventEmitter<Uri>();
	get onDidChange(): Event<Uri> {
		return this._onDidChange.event;
	}

	constructor(private container: Container) {
		this.registration = workspace.registerTextDocumentContentProvider(Schemes.GitLensAIMarkdown, this);

		// Track tab changes to detect when content needs recovery
		this.visibilityTracker = Disposable.from(
			window.tabGroups.onDidChangeTabs((e: TabChangeEvent) => {
				this.onTabsChanged(e);
			}),
		);

		workspace.onDidCloseTextDocument(document => {
			if (document.uri.scheme === Schemes.GitLensAIMarkdown) {
				this.contents.delete(document.uri.toString());
			}
		});
	}

	provideTextDocumentContent(uri: Uri): string | undefined {
		let contents = this.contents.get(uri.toString());
		if (contents != null) return contents;

		contents = getContentFromMarkdownUri(uri, this.container.telemetry.enabled);
		if (contents != null) return contents;

		return `# ${uri.path}\n\nNo content available.`;
	}

	openDocument(content: string, path: string, label: string, metadata?: MarkdownContentMetadata): Uri {
		const uri = Uri.from({
			scheme: Schemes.GitLensAIMarkdown,
			authority: metadata ? encodeGitLensRevisionUriAuthority(metadata) : undefined,
			path: `${path}.md`,
			query: JSON.stringify({ label: label }),
		});

		const uriString = uri.toString();
		const existingContent = this.contents.get(uriString);
		const contentChanged = existingContent !== content;

		this.contents.set(uriString, content);

		// If this document already exists and the content changed, fire the change event
		// This will automatically refresh any open previews
		if (contentChanged) {
			this._onDidChange.fire(uri);
		}

		return uri;
	}

	updateDocument(uri: Uri, content: string): void {
		this.contents.set(uri.toString(), content);
		this._onDidChange.fire(uri);
	}

	/**
	 * Forces content recovery for a document - useful when content gets corrupted
	 */
	forceContentRecovery(uri: Uri): void {
		const uriString = uri.toString();
		if (!this.contents.has(uriString)) return;

		const storedContent = this.contents.get(uriString);
		if (!storedContent) return;

		// I'm deleting the content because if I just fire the change once to make VSCode
		// reach our `provideTextDocumentContent` method
		// and `provideTextDocumentContent` returns the unchanged conent,
		// VSCode will not refresh the content, instead it keeps displaying the original conetnt
		// that the view had when it was opened initially.
		// That's why I need to blink the content.
		if (storedContent.at(storedContent.length - 1) === '\n') {
			this.contents.set(uriString, storedContent.substring(0, storedContent.length - 1));
		} else {
			this.contents.set(uriString, `${storedContent}\n`);
		}
		this._onDidChange.fire(uri);
	}

	closeDocument(uri: Uri): void {
		this.contents.delete(uri.toString());
	}

	dispose(): void {
		this.contents.clear();
		this.registration.dispose();
		this.visibilityTracker.dispose();
	}

	private onTabsChanged(e: TabChangeEvent) {
		for (const tab of e.changed) {
			if (tab.input instanceof TabInputCustom && tab.input.uri.scheme === Schemes.GitLensAIMarkdown) {
				const uri = tab.input.uri;
				this.forceContentRecovery(uri);
			}
		}
	}
}

function getContentFromMarkdownUri(uri: Uri, telemetryEnabled: boolean): string | undefined {
	if (!uri.path.startsWith('/explain')) return undefined;

	const authority = uri.authority;
	if (authority == null || authority.length === 0) return undefined;

	const metadata = decodeGitLensRevisionUriAuthority<MarkdownContentMetadata>(authority);

	if (metadata.header == null) return undefined;

	const headerContent = getMarkdownHeaderContent(metadata, telemetryEnabled);

	if (metadata.command == null) return `${headerContent}\n\nNo content available.`;

	const commandContent = `\n\n\n\n${metadata.command.label} using the \`Regenerate\` editor action in the editor toolbar.`;

	return `${headerContent}\n\n${commandContent}`;
}

export function getMarkdownHeaderContent(metadata: MarkdownContentMetadata, telemetryEnabled: boolean): string {
	let headerContent = `# ${metadata.header.title}\n\n> Generated by ${metadata.context.model.name}`;

	// Add feedback note if context is provided and telemetry is enabled
	if (telemetryEnabled) {
		headerContent +=
			'\n> \\\n> Use the 👍 and 👎 buttons in the editor toolbar above to provide feedback to help us improve our AI features';
	}

	if (metadata.header.subtitle) {
		headerContent += `\n\n## ${metadata.header.subtitle}`;
	}

	return headerContent;
}
