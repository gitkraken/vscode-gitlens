import type { TextEditor, TextEditorEdit } from 'vscode';
import { commands, Disposable } from 'vscode';
import type { GlCommands, GlCommandsDeprecated } from '../constants.commands';
import { registerCommand } from '../system/-webview/command';
import type { CommandContext } from './commandContext';
import type { CommandContextParsingOptions } from './commandContext.utils';
import { parseCommandContext } from './commandContext.utils';

export abstract class GlCommandBase implements Disposable {
	protected readonly contextParsingOptions: CommandContextParsingOptions = { expectsEditor: false };

	private readonly _disposable: Disposable;

	constructor(command: GlCommands | GlCommands[], deprecated?: GlCommandsDeprecated[]) {
		const commands = [...(typeof command === 'string' ? [command] : command), ...(deprecated ?? [])];

		const subscriptions = commands.map(cmd =>
			registerCommand(cmd, (...args: any[]) => this._execute(cmd, ...args), this),
		);
		this._disposable = Disposable.from(...subscriptions);
	}

	dispose(): void {
		this._disposable.dispose();
	}

	protected preExecute(_context: CommandContext, ...args: any[]): Promise<unknown> {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-return
		return this.execute(...args);
	}

	abstract execute(...args: any[]): any;

	protected _execute(command: GlCommands | GlCommandsDeprecated, ...args: any[]): Promise<unknown> {
		const [context, rest] = parseCommandContext(command, { ...this.contextParsingOptions }, ...args);
		return this.preExecute(context, ...rest);
	}
}

export abstract class ActiveEditorCommand extends GlCommandBase {
	protected override readonly contextParsingOptions: CommandContextParsingOptions = { expectsEditor: true };

	protected override preExecute(context: CommandContext, ...args: any[]): Promise<any> {
		// eslint-disable-next-line @typescript-eslint/no-unsafe-return
		return this.execute(context.editor, context.uri, ...args);
	}

	protected override _execute(command: GlCommands, ...args: any[]): any {
		return super._execute(command, undefined, ...args);
	}

	abstract override execute(editor?: TextEditor, ...args: any[]): any;
}

let lastCommand: { command: string; args: any[] } | undefined = undefined;
export function getLastCommand(): { command: string; args: any[] } | undefined {
	return lastCommand;
}

export abstract class ActiveEditorCachedCommand extends ActiveEditorCommand {
	protected override _execute(command: GlCommands, ...args: any[]): any {
		lastCommand = {
			command: command,
			args: args,
		};
		return super._execute(command, ...args);
	}

	abstract override execute(editor: TextEditor, ...args: any[]): any;
}

export abstract class EditorCommand implements Disposable {
	private readonly _disposable: Disposable;

	constructor(command: GlCommands | GlCommands[]) {
		if (!Array.isArray(command)) {
			command = [command];
		}

		const subscriptions = [];
		for (const cmd of command) {
			subscriptions.push(
				commands.registerTextEditorCommand(
					cmd,
					(editor: TextEditor, edit: TextEditorEdit, ...args: any[]) =>
						// eslint-disable-next-line @typescript-eslint/no-unsafe-return
						this.executeCore(cmd, editor, edit, ...args),
					this,
				),
			);
		}
		this._disposable = Disposable.from(...subscriptions);
	}

	dispose(): void {
		this._disposable.dispose();
	}

	private executeCore(_command: string, editor: TextEditor, edit: TextEditorEdit, ...args: any[]): any {
		return this.execute(editor, edit, ...args);
	}

	abstract execute(editor: TextEditor, edit: TextEditorEdit, ...args: any[]): any;
}
