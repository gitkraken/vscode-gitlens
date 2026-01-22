import type { QuickPickItem } from 'vscode';
import type { GlCommands } from '../../../constants.commands.js';
import type { Container } from '../../../container.js';
import type { AnyQuickWizardCommandArgs, CrossCommandReference } from '../models/quickWizard.js';
import type { StepGenerator, StepsContext, StepStartedFrom } from '../models/steps.js';
import { QuickCommand } from '../quickCommand.js';
import { QuickWizardRootStep } from '../quickWizardRootStep.js';

function* nullSteps(): StepGenerator {
	/* noop */
}

export function getSteps(
	container: Container,
	args: AnyQuickWizardCommandArgs,
	context: StepsContext<any>,
	startedFrom: StepStartedFrom,
): StepGenerator {
	const rootStep = new QuickWizardRootStep(container, args);

	const command = rootStep.find(args.command);
	if (command == null) return nullSteps();

	rootStep.setCommand(command, startedFrom);

	// Only include the StepsContext properties
	return command.executeSteps({
		container: container,
		steps: context.steps,
		title: context.title,
	} satisfies StepsContext<any>);
}

export function createCrossCommandReference<T>(command: GlCommands, args: T): CrossCommandReference<T> {
	return { command: command, args: args };
}

export function isCrossCommandReference<T = unknown>(value: any): value is CrossCommandReference<T> {
	return value.command != null;
}

export function isQuickCommand(item: QuickPickItem): item is QuickCommand {
	return item instanceof QuickCommand;
}
