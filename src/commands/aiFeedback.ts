import type { TextEditor, Uri } from 'vscode';
import { window } from 'vscode';
import { Schemes } from '../constants';
import type { AIFeedbackEvent, Source } from '../constants.telemetry';
import type { Container } from '../container';
import type { MarkdownContentMetadata } from '../documents/markdown';
import { decodeGitLensRevisionUriAuthority } from '../git/gitUri.authority';
import { command } from '../system/-webview/command';
import { Logger } from '../system/logger';
import { ActiveEditorCommand } from './commandBase';
import { getCommandUri } from './commandBase.utils';

export interface AIFeedbackContext {
	feature: AIFeedbackEvent['feature'];
	model: {
		id: string;
		providerId: string;
		providerName: string;
	};
	usage?: {
		promptTokens?: number;
		completionTokens?: number;
		totalTokens?: number;
		limits?: {
			used: number;
			limit: number;
			resetsOn: Date;
		};
	};
	aiRequestId: string | undefined;
	outputLength: number;
}

@command()
export class AIFeedbackPositiveCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super('gitlens.ai.feedback.positive');
	}

	execute(editor?: TextEditor, uri?: Uri): void {
		const context = this.extractFeedbackContext(editor, uri);
		if (!context) return;

		try {
			// For positive feedback, just send the event immediately without showing any form
			sendFeedbackEvent(
				this.container,
				context,
				'positive',
				{
					presetReasons: [],
					writeInFeedback: '',
				},
				{ source: 'markdown-preview' },
			);

			void window.showInformationMessage('Thank you for your feedback!');
		} catch (ex) {
			Logger.error(ex, 'AIFeedbackPositiveCommand', 'execute');
		}
	}

	private extractFeedbackContext(editor?: TextEditor, uri?: Uri): AIFeedbackContext | undefined {
		uri = getCommandUri(uri, editor);
		if (uri?.scheme !== Schemes.GitLensMarkdown) return undefined;

		const authority = uri.authority;
		if (!authority) return undefined;

		try {
			const metadata = decodeGitLensRevisionUriAuthority<MarkdownContentMetadata>(authority);

			// Extract feedback context from metadata
			if (metadata.feedbackContext) {
				return metadata.feedbackContext as unknown as AIFeedbackContext;
			}

			return undefined;
		} catch (ex) {
			Logger.error(ex, 'AIFeedbackPositiveCommand', 'extractFeedbackContext');
			return undefined;
		}
	}
}

@command()
export class AIFeedbackNegativeCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super('gitlens.ai.feedback.negative');
	}

	async execute(editor?: TextEditor, uri?: Uri): Promise<void> {
		const context = this.extractFeedbackContext(editor, uri);
		if (!context) return;

		try {
			// For negative feedback, always show the detailed form directly
			await showDetailedFeedbackForm(this.container, context);
		} catch (ex) {
			Logger.error(ex, 'AIFeedbackNegativeCommand', 'execute');
		}
	}

	private extractFeedbackContext(editor?: TextEditor, uri?: Uri): AIFeedbackContext | undefined {
		uri = getCommandUri(uri, editor);
		if (uri?.scheme !== Schemes.GitLensMarkdown) return undefined;

		const authority = uri.authority;
		if (!authority) return undefined;

		try {
			const metadata = decodeGitLensRevisionUriAuthority<MarkdownContentMetadata>(authority);

			// Extract feedback context from metadata
			if (metadata.feedbackContext) {
				return metadata.feedbackContext as unknown as AIFeedbackContext;
			}

			return undefined;
		} catch (ex) {
			Logger.error(ex, 'AIFeedbackNegativeCommand', 'extractFeedbackContext');
			return undefined;
		}
	}
}

async function showDetailedFeedbackForm(container: Container, context: AIFeedbackContext): Promise<void> {
	const negativeReasons = [
		'Inaccurate or incorrect response',
		'Too generic or not specific enough',
		'Poor code quality',
		'Missing important details',
		'Difficult to understand',
		'Not relevant to my needs',
	];

	// Show quick pick for preset reasons
	const selectedReasons = await window.showQuickPick(
		negativeReasons.map(reason => ({ label: reason, picked: false })),
		{
			title: 'What specifically could be improved?',
			canPickMany: true,
			placeHolder: 'Select all that apply (optional)',
		},
	);

	// Show input box for additional feedback
	const writeInFeedback = await window.showInputBox({
		title: 'Additional feedback (optional)',
		placeHolder: 'Tell us more about your experience...',
		prompt: 'Your feedback helps us improve our AI features',
	});

	// Always send feedback submission telemetry for negative feedback
	sendFeedbackEvent(
		container,
		context,
		'negative',
		{
			presetReasons: selectedReasons?.map(r => r.label),
			writeInFeedback: writeInFeedback,
		},
		{ source: 'markdown-preview' },
	);

	void window.showInformationMessage('Thank you for your feedback!');
}

function sendFeedbackEvent(
	container: Container,
	context: AIFeedbackContext,
	rating: 'positive' | 'negative',
	feedback: {
		presetReasons?: string[];
		writeInFeedback?: string;
	},
	source: Source,
): void {
	const hasPresetReasons = feedback.presetReasons && feedback.presetReasons.length > 0;
	const writeInFeedback = feedback.writeInFeedback?.trim() ?? undefined;

	let feedbackType: 'preset' | 'writeIn' | 'both';
	if (hasPresetReasons && writeInFeedback?.length) {
		feedbackType = 'both';
	} else if (hasPresetReasons) {
		feedbackType = 'preset';
	} else {
		feedbackType = 'writeIn';
	}

	const eventData: AIFeedbackEvent = {
		feature: context.feature,
		rating: rating,
		feedbackType: feedbackType,
		presetReason: hasPresetReasons ? feedback.presetReasons!.join(', ') : undefined,
		'writeInFeedback.length': writeInFeedback?.length ?? undefined,
		'writeInFeedback.text': writeInFeedback?.length ? writeInFeedback : undefined,
		'model.id': context.model.id,
		'model.provider.id': context.model.providerId as any,
		'model.provider.name': context.model.providerName,
		'usage.promptTokens': context.usage?.promptTokens,
		'usage.completionTokens': context.usage?.completionTokens,
		'usage.totalTokens': context.usage?.totalTokens,
		'usage.limits.used': context.usage?.limits?.used,
		'usage.limits.limit': context.usage?.limits?.limit,
		'usage.limits.resetsOn': context.usage?.limits?.resetsOn?.toISOString(),
		'ai.request.id': context.aiRequestId,
		'output.length': context.outputLength,
	};

	container.telemetry.sendEvent('ai/feedback', eventData, source);
}
