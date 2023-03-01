import type { Disposable, Terminal } from 'vscode';
import { window } from 'vscode';
import { Container } from './container';
import { configuration } from './system/configuration';
import { getEditorCommand } from './system/utils';

let _terminal: Terminal | undefined;
let _disposable: Disposable | undefined;

const extensionTerminalName = 'GitLens';

function ensureTerminal(): Terminal {
	if (_terminal == null) {
		_terminal = window.createTerminal(extensionTerminalName);
		_disposable = window.onDidCloseTerminal((e: Terminal) => {
			if (e.name === extensionTerminalName) {
				_terminal = undefined;
				_disposable?.dispose();
				_disposable = undefined;
			}
		});

		Container.instance.context.subscriptions.push(_disposable);
	}

	return _terminal;
}

export function runGitCommandInTerminal(command: string, args: string, cwd: string, execute: boolean = false) {
	const terminal = ensureTerminal();
	terminal.show(false);
	const coreEditorConfig = configuration.get('terminal.overrideGitEditor')
		? `-c "core.editor=${getEditorCommand()}" `
		: '';
	terminal.sendText(`git -C "${cwd}" ${coreEditorConfig}${command} ${args}`, execute);
}
