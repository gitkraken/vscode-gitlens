import type { CoreCommands } from '../../../constants.commands.js';
import type { ViewIds } from '../../../constants.views.js';

export function getViewFocusCommand(viewId: ViewIds): CoreCommands {
	return `${viewId}.focus`;
}

export function getViewToggleCommand(viewId: ViewIds): CoreCommands {
	return `${viewId}.open`;
}
