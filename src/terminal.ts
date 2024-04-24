import type { Disposable, Terminal } from 'vscode';
import { window } from 'vscode';
import { Container } from './container';

let _terminal: Terminal | undefined;
let _disposable: Disposable | undefined;

const extensionTerminalName = 'GitLens';

export function ensureGitTerminal(): Terminal {
	if (_terminal == null) {
		_terminal = window.createTerminal(extensionTerminalName);
		_disposable = window.onDidCloseTerminal((e: Terminal) => {
			if (e === _terminal) {
				_terminal = undefined;
				_disposable?.dispose();
				_disposable = undefined;
			}
		});

		Container.instance.context.subscriptions.push(_disposable);
	}

	return _terminal;
}
