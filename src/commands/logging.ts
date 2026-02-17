import { commands } from 'vscode';
import type { Container } from '../container.js';
import { command } from '../system/-webview/command.js';
import { Logger } from '../system/logger.js';
import { wait } from '../system/promise.js';
import { GlCommandBase } from './commandBase.js';

// VS Code LogLevel enum values
const enum VSCodeLogLevel {
	Off = 0,
	Trace = 1,
	Debug = 2,
	Info = 3,
	Warning = 4,
	Error = 5,
}

async function setOutputLogLevel(level: VSCodeLogLevel): Promise<void> {
	Logger.showOutputChannel(true);
	// Small delay to ensure the output channel is fully active before setting log level
	await wait(500);
	await commands.executeCommand(`workbench.action.output.activeOutputLogLevel.${level}`);
}

@command()
export class EnableDebugLoggingCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.enableDebugLogging');
	}

	execute(): Promise<void> {
		return setOutputLogLevel(VSCodeLogLevel.Debug);
	}
}

@command()
export class DisableDebugLoggingCommand extends GlCommandBase {
	constructor(private readonly container: Container) {
		super('gitlens.disableDebugLogging');
	}

	execute(): Promise<void> {
		return setOutputLogLevel(VSCodeLogLevel.Info);
	}
}
