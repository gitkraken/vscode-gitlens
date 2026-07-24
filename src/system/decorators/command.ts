import type { GlCommands, GlWebviewCommands } from '../../constants.commands.js';
import type { WebviewTypes } from '../../constants.views.js';

interface Command<
	TCommand extends string | GlCommands = GlCommands,
	THandler extends (...args: any[]) => any = (...args: any[]) => any,
	TOptions extends object | void = void,
> {
	command: TCommand;
	handler: THandler;
	options?: TOptions;
}

export function createCommandDecorator<
	TCommand extends string | GlCommands = GlCommands,
	THandler extends (...args: any[]) => any = (...args: any[]) => any,
	TOptions extends object | void = void,
>(): {
	command: (
		command: TCommand,
		options?: TOptions,
	) => (
		target: unknown,
		contextOrKey?: string | ClassMethodDecoratorContext,
		descriptor?: PropertyDescriptor,
	) => PropertyDescriptor | undefined;
	getCommands: () => Iterable<Command<TCommand, THandler, TOptions>>;
} {
	const commands = new Map<string, Command<TCommand, THandler, TOptions>>();

	function command(command: TCommand, options?: TOptions) {
		return function (
			target: unknown,
			contextOrKey?: string | ClassMethodDecoratorContext,
			descriptor?: PropertyDescriptor,
		) {
			if (commands.has(command)) {
				debugger;
				throw new Error(`@command decorator has already been applied to the command: ${command}`);
			}

			// ES Decorator
			if (contextOrKey && typeof contextOrKey === 'object' && 'kind' in contextOrKey) {
				if (contextOrKey.kind !== 'method') {
					// oxlint-disable-next-line typescript/restrict-template-expressions
					throw new Error(`@command can only be used on methods, not on ${contextOrKey.kind}`);
				}

				commands.set(command, { command: command, handler: target as THandler, options: options });
				return;
			}

			// TypeScript experimental decorator
			if (descriptor) {
				if (typeof descriptor.value !== 'function') {
					throw new Error(`@command can only be used on methods, not on ${typeof descriptor.value}`);
				}

				commands.set(command, { command: command, handler: descriptor.value as THandler, options: options });
				return descriptor;
			}

			throw new Error('Invalid decorator usage');
		};
	}

	return {
		command: command,
		getCommands: () => commands.values(),
	};
}

/**
 * Suffix used to disambiguate webview-scoped command IDs.
 *
 * Normally one of {@link WebviewTypes}, but we also allow `'graphDetails'` as a legacy label for
 * the integrated graph details panel's file context-menu commands. The `gitlens.views.graphDetails`
 * webview was removed when the integrated panel took over, but the `:graphDetails` command suffix
 * is still used by package.json menus filtered on `webview == gitlens.graph || webview == gitlens.views.graph`.
 */
export type WebviewCommandSuffix = WebviewTypes | 'graphDetails';

export function getWebviewCommand(command: string, type: WebviewCommandSuffix): GlWebviewCommands {
	return (command.endsWith(':') ? `${command}${type}` : command) as GlWebviewCommands;
}
