import { version as codeVersion } from 'vscode';
import type { CoreCommands } from '../../../constants.commands';
import type { ViewIds } from '../../../constants.views';
import { compare } from '../../version';

export function getViewFocusCommand(viewId: ViewIds): CoreCommands {
	if (compare(codeVersion, '1.100') >= 0) {
		return `${viewId}.open`;
	}
	return `${viewId}.focus`;
}
