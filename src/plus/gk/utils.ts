import type { MessageItem } from 'vscode';
import { window } from 'vscode';
import { configuration } from '../../system/vscode/configuration';
import { getContext } from '../../system/vscode/context';

export function arePlusFeaturesEnabled(): boolean {
	return getContext('gitlens:plus:enabled', configuration.get('plusFeatures.enabled', undefined, true));
}

export async function ensurePlusFeaturesEnabled(): Promise<boolean> {
	if (arePlusFeaturesEnabled()) return true;

	const confirm: MessageItem = { title: 'Enable' };
	const cancel: MessageItem = { title: 'Cancel', isCloseAffordance: true };
	const result = await window.showInformationMessage(
		'Pro features are currently disabled. Would you like to enable them?',
		{ modal: true },
		confirm,
		cancel,
	);

	if (result !== confirm) return false;

	await configuration.updateEffective('plusFeatures.enabled', true);
	return true;
}
