import type { TextEditor, Uri } from 'vscode';
import { Logger } from '@gitlens/utils/logger.js';
import type { AIFeedbackEvent, Source } from '../constants.telemetry.js';
import type { Container } from '../container.js';
import type { UnhelpfulResult } from '../plus/ai/aiFeedbackUtils.js';
import { sendFeedbackEvent, showUnhelpfulFeedbackPicker } from '../plus/ai/aiFeedbackUtils.js';
import type { AIModelScope } from '../plus/ai/aiProviderService.js';
import { extractAIResultContext } from '../plus/ai/utils/-webview/ai.utils.js';
import { command } from '../system/-webview/command.js';
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

/**
 * Args accepted by `gitlens.ai.switchProvider`. `scope` lets surfaces that maintain their
 * own remembered model (compose, review) opt into scoped persistence — the picker writes
 * the selection to scoped storage and leaves the global default `ai.model` untouched.
 */
export type SwitchAIModelCommandArgs = Source & { scope?: AIModelScope };

@command()
export class SwitchAIModelCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super(['gitlens.ai.switchProvider', 'gitlens.ai.switchProvider:scm'], ['gitlens.switchAIModel']);
	}

	protected override preExecute(context: CommandContext, args?: SwitchAIModelCommandArgs): Promise<void> {
		if (context.command === 'gitlens.ai.switchProvider:scm') {
			args ??= { source: 'scm' };
		}

		return this.execute(args);
	}

	async execute(args?: SwitchAIModelCommandArgs): Promise<void> {
		if (args == null) {
			await this.container.ai.switchModel();
			return;
		}

		// `scope` is intentionally not part of the telemetry Source — strip it before
		// forwarding so we don't pollute the source dimension for downstream events.
		const { scope, ...source } = args;
		await this.container.ai.switchModel(source, { scope: scope });
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
