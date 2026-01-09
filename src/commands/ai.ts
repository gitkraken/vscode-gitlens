import type { TextEditor, Uri } from 'vscode';
import type { AIFeedbackEvent, Source } from '../constants.telemetry.js';
import type { Container } from '../container.js';
import type { UnhelpfulResult } from '../plus/ai/aiFeedbackUtils.js';
import { sendFeedbackEvent, showUnhelpfulFeedbackPicker } from '../plus/ai/aiFeedbackUtils.js';
import { extractAIResultContext } from '../plus/ai/utils/-webview/ai.utils.js';
import { command } from '../system/-webview/command.js';
import { Logger } from '../system/logger.js';
import { ActiveEditorCommand, GlCommandBase } from './commandBase.js';
import { getCommandUri } from './commandBase.utils.js';
import type { CommandContext } from './commandContext.js';

@command()
export class EnableAICommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(['gitlens.ai.enable']);
	}

	async execute(source?: Source): Promise<void> {
		await this.container.ai.enable(source);
	}
}

@command()
export class SwitchAIModelCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(['gitlens.ai.switchProvider', 'gitlens.ai.switchProvider:scm'], ['gitlens.switchAIModel']);
	}

	protected override preExecute(context: CommandContext, source?: Source): Promise<void> {
		if (context.command === 'gitlens.ai.switchProvider:scm') {
			source ??= { source: 'scm' };
		}

		return this.execute(source);
	}

	async execute(source?: Source): Promise<void> {
		await this.container.ai.switchModel(source);
	}
}

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
