import type { QuickPickItem } from 'vscode';
import { l10n, window } from 'vscode';
import { GlyphChars } from '../constants.js';
import { configuration } from '../system/-webview/configuration.js';

export interface ModesQuickPickItem extends QuickPickItem {
	key: string | undefined;
}

export async function showModePicker(): Promise<ModesQuickPickItem | undefined> {
	const modes = configuration.get('modes');
	if (modes == null) return undefined;

	const modeKeys = Object.keys(modes);
	if (modeKeys.length === 0) return undefined;

	const mode = configuration.get('mode.active');

	const items = modeKeys.map(key => {
		const modeCfg = modes[key];
		const item: ModesQuickPickItem = {
			label: `${mode === key ? '$(check)\u00a0\u00a0' : '\u00a0\u00a0\u00a0\u00a0\u00a0'}${l10n.t('{0} mode', modeCfg.name)}`,
			description: modeCfg.description ? `\u00a0${GlyphChars.Dash}\u00a0 ${modeCfg.description}` : '',
			key: key,
		};
		return item;
	});

	if (mode && modes[mode] != null) {
		items.unshift({
			label: l10n.t('Exit {0} mode', modes[mode].name),
			key: undefined,
		});
	}

	const pick = await window.showQuickPick(items, {
		placeHolder: l10n.t('Select a GitLens mode to enter'),
	});

	return pick;
}
