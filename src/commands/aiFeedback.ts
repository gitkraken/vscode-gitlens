import type { Disposable, TextEditor, Uri } from 'vscode';
import { window, workspace } from 'vscode';
import type { AIFeedbackEvent, AIFeedbackUnhelpfulReasons, Source } from '../constants.telemetry';
import type { Container } from '../container';
import type { AIResultContext } from '../plus/ai/aiProviderService';
import { extractAIResultContext } from '../plus/ai/utils/-webview/ai.utils';
import type { QuickPickItemOfT } from '../quickpicks/items/common';
import { command } from '../system/-webview/command';
import { map } from '../system/iterable';
import { Logger } from '../system/logger';
import { createDisposable } from '../system/unifiedDisposable';
import { ActiveEditorCommand } from './commandBase';
import { getCommandUri } from './commandBase.utils';

@command()
export class AIFeedbackHelpfulCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(['gitlens.ai.feedback.helpful', 'gitlens.ai.feedback.helpful.chosen']);
	}

	async execute(editor?: TextEditor, uri?: Uri): Promise<void> {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		await sendFeedback(this.container, uri, 'helpful');
	}
}

@command()
export class AIFeedbackUnhelpfulCommand extends ActiveEditorCommand {
	constructor(private readonly container: Container) {
		super(['gitlens.ai.feedback.unhelpful', 'gitlens.ai.feedback.unhelpful.chosen']);
	}

	async execute(editor?: TextEditor, uri?: Uri): Promise<void> {
		uri = getCommandUri(uri, editor);
		if (uri == null) return;

		await sendFeedback(this.container, uri, 'unhelpful');
	}
}

type UnhelpfulResult = { reasons?: AIFeedbackUnhelpfulReasons[]; custom?: string };

let _documentCloseTracker: Disposable | undefined;
const _markdownDocuments = new Map<string, AIResultContext>();
export function getMarkdownDocument(documentUri: string): AIResultContext | undefined {
	return _markdownDocuments.get(documentUri);
}
export function setMarkdownDocument(documentUri: string, context: AIResultContext, container: Container): void {
	_markdownDocuments.set(documentUri, context);

	if (!_documentCloseTracker) {
		_documentCloseTracker = workspace.onDidCloseTextDocument(document => {
			deleteMarkdownDocument(document.uri.toString());
		});
		container.context.subscriptions.push(
			createDisposable(() => {
				_documentCloseTracker?.dispose();
				_documentCloseTracker = undefined;
				_markdownDocuments.clear();
			}),
		);
	}
}
function deleteMarkdownDocument(documentUri: string): void {
	_markdownDocuments.delete(documentUri);
}

async function sendFeedback(container: Container, uri: Uri, sentiment: AIFeedbackEvent['sentiment']): Promise<void> {
	const context = extractAIResultContext(container, uri);
	if (!context) return;

	try {
		const previous = container.aiFeedback.getFeedbackResponse(uri);
		if (sentiment === previous) return;

		let unhelpful: UnhelpfulResult | undefined;
		if (sentiment === 'unhelpful') {
			unhelpful = await showUnhelpfulFeedbackPicker();
		}

		container.aiFeedback.setFeedbackResponse(uri, sentiment);

		sendFeedbackEvent(container, { source: 'ai:markdown-preview' }, context, sentiment, unhelpful);
	} catch (ex) {
		Logger.error(ex, 'AIFeedback.sendFeedback');
	}
}

const negativeReasonsMap: Map<AIFeedbackUnhelpfulReasons, string> = new Map([
	['suggestionInaccurate', 'Inaccurate or incorrect'],
	['notRelevant', 'Not relevant'],
	['missedImportantContext', 'Missing important context'],
	['unclearOrPoorlyFormatted', 'Unclear or poorly formatted'],
	['genericOrRepetitive', 'Too generic or not detailed enough'],
	['other', 'Other'],
]);

async function showUnhelpfulFeedbackPicker(): Promise<UnhelpfulResult | undefined> {
	const items: QuickPickItemOfT<AIFeedbackUnhelpfulReasons>[] = [
		...map(negativeReasonsMap, ([type, reason]) => ({ label: reason, picked: false, item: type })),
	];

	// Show quick pick for preset reasons
	const selectedReasons = await window.showQuickPick<QuickPickItemOfT<AIFeedbackUnhelpfulReasons>>(items, {
		title: 'What could be improved?',
		canPickMany: true,
		placeHolder: 'Select all that apply (optional)',
	});

	let otherCustom;
	// Show input box for additional feedback
	if (selectedReasons?.find(r => r.item === 'other')) {
		otherCustom = await window.showInputBox({
			title: 'Other feedback',
			placeHolder: 'Describe your experience...',
			prompt: 'Enter your feedback to help us improve our AI features (optional).',
		});
	}

	return { reasons: selectedReasons?.map(r => r.item), custom: otherCustom };
}

function sendFeedbackEvent(
	container: Container,
	source: Source,
	context: AIResultContext,
	sentiment: AIFeedbackEvent['sentiment'],
	unhelpful?: { reasons?: AIFeedbackUnhelpfulReasons[]; custom?: string },
): void {
	const eventData: AIFeedbackEvent = {
		type: context.type,
		feature: context.feature,
		sentiment: sentiment,
		'unhelpful.reasons': unhelpful?.reasons?.length ? unhelpful.reasons.join(',') : undefined,
		'unhelpful.custom': unhelpful?.custom?.trim() ?? undefined,

		id: context.id,
		'model.id': context.model.id,
		'model.provider.id': context.model.provider.id,
		'model.provider.name': context.model.provider.name,
		'usage.promptTokens': context.usage?.promptTokens,
		'usage.completionTokens': context.usage?.completionTokens,
		'usage.totalTokens': context.usage?.totalTokens,
		'usage.limits.used': context.usage?.limits?.used,
		'usage.limits.limit': context.usage?.limits?.limit,
		'usage.limits.resetsOn': context.usage?.limits?.resetsOn,
	};
	container.telemetry.sendEvent('ai/feedback', eventData, source);
}
