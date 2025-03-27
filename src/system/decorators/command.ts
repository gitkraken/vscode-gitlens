interface Command<
	THandler extends (...args: any[]) => any,
	TCommand extends string = string,
	TOptions extends object | void = void,
> {
	command: TCommand;
	handler: THandler;
	options?: TOptions;
}

export function createCommandDecorator<
	THandler extends (...args: any[]) => any = (...args: any[]) => any,
	TCommand extends string = string,
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
	getCommands: () => Iterable<Command<THandler, TCommand, TOptions>>;
} {
	const commands = new Map<string, Command<THandler, TCommand, TOptions>>();

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
					// eslint-disable-next-line @typescript-eslint/restrict-template-expressions
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
