import type { QuickPickItem } from 'vscode';
import { l10n, window } from 'vscode';
import { map } from '@gitlens/utils/iterable.js';
import type { AIFeedbackEvent, AIFeedbackUnhelpfulReasons, Source } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import type { AIResultContext } from './aiProviderService.js';

export interface UnhelpfulResult {
	reasons?: AIFeedbackUnhelpfulReasons[];
	custom?: string;
}

interface QuickPickItemOfT<T> extends QuickPickItem {
	item: T;
}

const negativeReasonsMap = new Map<AIFeedbackUnhelpfulReasons, string>([
	['suggestionInaccurate', l10n.t('Inaccurate or incorrect')],
	['notRelevant', l10n.t('Not relevant')],
	['missedImportantContext', l10n.t('Missed important context')],
	['unclearOrPoorlyFormatted', l10n.t('Unclear or poorly formatted')],
	['genericOrRepetitive', l10n.t('Too generic or not detailed enough')],
	['other', l10n.t('Other')],
]);

export async function showUnhelpfulFeedbackPicker(): Promise<UnhelpfulResult | undefined> {
	const items: QuickPickItemOfT<AIFeedbackUnhelpfulReasons>[] = [
		...map(negativeReasonsMap, ([type, reason]) => ({ label: reason, picked: false, item: type })),
	];

	// Show quick pick for preset reasons
	const selectedReasons = await window.showQuickPick(items, {
		title: l10n.t('What could be improved?'),
		canPickMany: true,
		placeHolder: l10n.t('Select all that apply (optional)'),
	});

	if (selectedReasons == null) return undefined;

	let otherCustom: string | undefined;
	if (selectedReasons?.find(r => r.item === 'other')) {
		otherCustom = await window.showInputBox({
			title: l10n.t('Other feedback'),
			placeHolder: l10n.t('Describe your experience...'),
			prompt: l10n.t('Enter your feedback to help us improve our AI features (optional).'),
		});
	}

	return { reasons: selectedReasons?.map(r => r.item), custom: otherCustom };
}

export function sendFeedbackEvent(
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
