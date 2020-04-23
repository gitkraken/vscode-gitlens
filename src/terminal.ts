'use strict';
import { Disposable, Terminal, window } from 'vscode';
import { extensionTerminalName } from './constants';
import { Container } from './container';

let _terminal: Terminal | undefined;
let _terminalCwd: string | undefined;
let _disposable: Disposable | undefined;

function ensureTerminal(cwd: string): Terminal {
	if (_terminal === undefined) {
		_terminal = window.createTerminal(extensionTerminalName);
		_disposable = window.onDidCloseTerminal((e: Terminal) => {
			if (e.name === extensionTerminalName) {
				_terminal = undefined;
				_disposable!.dispose();
				_disposable = undefined;
			}
		});

		Container.context.subscriptions.push(_disposable);
		_terminalCwd = undefined;
	}

	if (_terminalCwd !== cwd) {
		_terminal.sendText(`cd "${cwd}"`, true);
		_terminalCwd = cwd;
	}

	return _terminal;
}

export function runGitCommandInTerminal(command: string, args: string, cwd: string, execute: boolean = false) {
	// let git = Git.getGitPath();
	// if (git.includes(' ')) {
	//     git = `"${git}"`;
	// }

	const terminal = ensureTerminal(cwd);
	terminal.show(false);
	terminal.sendText(`git ${command} ${args}`, execute);
}
