import { MessageItem, window } from 'vscode';
import { configuration } from '../../configuration';

export async function ensurePremiumFeaturesEnabled(): Promise<boolean> {
	if (configuration.get('premiumFeatures.enabled', undefined, true)) return true;

	const confirm: MessageItem = { title: 'Enable' };
	const cancel: MessageItem = { title: 'Cancel', isCloseAffordance: true };
	const result = await window.showInformationMessage(
		'Premium features are currently disabled. Would you like to enable them?',
		{ modal: true },
		confirm,
		cancel,
	);

	if (result !== confirm) return false;

	void (await configuration.updateEffective('premiumFeatures.enabled', true));
	return true;
}
