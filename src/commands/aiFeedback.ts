import type { TextEditor, Uri } from 'vscode';
import type { AIFeedbackEvent } from '../constants.telemetry';
import type { Container } from '../container';
import type { UnhelpfulResult } from '../plus/ai/aiFeedbackUtils';
import { sendFeedbackEvent, showUnhelpfulFeedbackPicker } from '../plus/ai/aiFeedbackUtils';
import { extractAIResultContext } from '../plus/ai/utils/-webview/ai.utils';
import { command } from '../system/-webview/command';
import { Logger } from '../system/logger';
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
