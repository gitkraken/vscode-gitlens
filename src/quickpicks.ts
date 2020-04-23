'use strict';

import { configuration } from './configuration';

export function getQuickPickIgnoreFocusOut() {
	return !configuration.get('advanced', 'quickPick', 'closeOnFocusOut');
}

export * from './quickpicks/quickPicksItems';
export * from './quickpicks/gitQuickPickItems';
export * from './quickpicks/commitQuickPickItems';

export * from './quickpicks/commitPicker';
export * from './quickpicks/modePicker';
export * from './quickpicks/referencePicker';
export * from './quickpicks/remoteProviderPicker';
export * from './quickpicks/repositoryPicker';
