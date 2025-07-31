import type { TextEditor, Uri } from 'vscode';
import { md5 } from '@env/crypto';
import type { GlCommands } from '../constants.commands';
import type { Container } from '../container';
import type { MarkdownContentMetadata } from '../documents/markdown';
import { getMarkdownHeaderContent } from '../documents/markdown';
import type { GitRepositoryService } from '../git/gitRepositoryService';
import { GitUri } from '../git/gitUri';
import type { AIExplainSource, AIResultContext, AISummarizeResult } from '../plus/ai/aiProviderService';
import type { AIModel } from '../plus/ai/models/model';
import { getAIResultContext } from '../plus/ai/utils/-webview/ai.utils';
import { getBestRepositoryOrShowPicker } from '../quickpicks/repositoryPicker';
import { showMarkdownPreview } from '../system/-webview/markdown';
import { GlCommandBase } from './commandBase';
import { getCommandUri } from './commandBase.utils';

export interface ExplainBaseArgs {
	worktreePath?: string | Uri;
	repoPath?: string | Uri;
	source?: AIExplainSource;
}

export abstract class ExplainCommandBase extends GlCommandBase {
	abstract pickerTitle: string;
	abstract repoPickerPlaceholder: string;

	constructor(
		protected readonly container: Container,
		command: GlCommands | GlCommands[],
	) {
		super(command);
	}

	protected async getRepositoryService(
		editor?: TextEditor,
		uri?: Uri,
		args?: ExplainBaseArgs,
	): Promise<GitRepositoryService | undefined> {
		let svc;
		if (args?.worktreePath) {
			svc = this.container.git.getRepositoryService(args.worktreePath);
		} else if (args?.repoPath) {
			svc = this.container.git.getRepositoryService(args.repoPath);
		} else {
			uri = getCommandUri(uri, editor);
			const gitUri = uri != null ? await GitUri.fromUri(uri) : undefined;
			const repository = await getBestRepositoryOrShowPicker(
				gitUri,
				editor,
				this.pickerTitle,
				this.repoPickerPlaceholder,
			);

			svc = repository?.git;
		}

		return svc;
	}

	/**
	 * Opens a document immediately with loading state, then updates it when AI content is ready
	 */
	protected openDocument(
		aiPromise: Promise<AISummarizeResult | 'cancelled' | undefined>,
		path: string,
		model: AIModel,
		feature: string,
		metadata: Omit<MarkdownContentMetadata, 'context'>,
	): void {
		// Create a placeholder AI context for the loading state
		const loadingContext: AIResultContext = {
			id: `loading-${md5(path)}`,
			type: 'explain-changes',
			feature: feature,
			model: model,
		};

		const metadataWithContext: MarkdownContentMetadata = { ...metadata, context: loadingContext };
		const headerContent = getMarkdownHeaderContent(metadataWithContext, this.container.telemetry.enabled);
		const loadingContent = `${headerContent}\n\n> 🤖 **Generating explanation...**\n> Please wait while the AI analyzes the changes and generates an explanation. This document will update automatically when the content is ready.\n>\n> *This may take a few moments depending on the complexity of the changes.*`;

		// Open the document immediately with loading content
		const documentUri = this.container.markdown.openDocument(
			loadingContent,
			path,
			metadata.header.title,
			metadataWithContext,
		);

		showMarkdownPreview(documentUri);

		// Update the document when AI content is ready
		void this.updateDocumentWhenReady(documentUri, aiPromise, metadataWithContext);
	}

	/**
	 * Updates the document content when AI generation completes
	 */
	private async updateDocumentWhenReady(
		documentUri: Uri,
		aiPromise: Promise<AISummarizeResult | 'cancelled' | undefined>,
		metadata: MarkdownContentMetadata,
	): Promise<void> {
		try {
			const result = await aiPromise;

			if (result === 'cancelled') {
				// Update with cancellation message
				const cancelledContent = this.createCancelledContent(metadata);
				this.container.markdown.updateDocument(documentUri, cancelledContent);
				return;
			}

			if (result == null) {
				// Update with error message
				const errorContent = this.createErrorContent(metadata);
				this.container.markdown.updateDocument(documentUri, errorContent);
				return;
			}

			// Update with successful AI content
			this.updateDocumentWithResult(documentUri, result, metadata);
		} catch (_error) {
			// Update with error message
			const errorContent = this.createErrorContent(metadata);
			this.container.markdown.updateDocument(documentUri, errorContent);
		}
	}

	/**
	 * Updates the document with successful AI result
	 */
	private updateDocumentWithResult(
		documentUri: Uri,
		result: AISummarizeResult,
		metadata: MarkdownContentMetadata,
	): void {
		const context = getAIResultContext(result);
		const metadataWithContext: MarkdownContentMetadata = { ...metadata, context: context };
		const headerContent = getMarkdownHeaderContent(metadataWithContext, this.container.telemetry.enabled);
		const content = `${headerContent}\n\n${result.parsed.summary}\n\n${result.parsed.body}`;

		// Store the AI result context in the feedback provider for documents that cannot store it in their URI
		this.container.aiFeedback.setMarkdownDocument(documentUri.toString(), context);

		this.container.markdown.updateDocument(documentUri, content);
	}

	/**
	 * Creates content for cancelled AI generation
	 */
	private createCancelledContent(metadata: MarkdownContentMetadata): string {
		const headerContent = getMarkdownHeaderContent(metadata, this.container.telemetry.enabled);
		return `${headerContent}\n\n---\n\n⚠️ **Generation Cancelled**\n\nThe AI explanation was cancelled before completion.`;
	}

	/**
	 * Creates content for failed AI generation
	 */
	private createErrorContent(metadata: MarkdownContentMetadata): string {
		const headerContent = getMarkdownHeaderContent(metadata, this.container.telemetry.enabled);
		return `${headerContent}\n\n---\n\n❌ **Generation Failed**\n\nUnable to generate an explanation for the changes. Please try again.`;
	}
}
