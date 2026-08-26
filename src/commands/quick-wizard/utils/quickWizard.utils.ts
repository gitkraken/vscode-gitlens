import type { GlCommands } from '../../../constants.commands.js';
import type { Container } from '../../../container.js';
import type { AnyQuickWizardCommandArgs, CrossCommandReference } from '../models/quickWizard.js';
import type { AsyncStepResultGenerator, StepsContext, StepStartedFrom } from '../models/steps.js';

export async function* getSteps(
	container: Container,
	args: AnyQuickWizardCommandArgs,
	context: StepsContext<any>,
	startedFrom: StepStartedFrom,
): AsyncStepResultGenerator<void | undefined> {
	const { QuickWizardRootStep } = await import(/* webpackChunkName: "quick-wizard" */ '../quickWizardRootStep.js');
	const rootStep = new QuickWizardRootStep(container, args);

	const command = rootStep.find(args.command);
	if (command == null) return;

	rootStep.setCommand(command, startedFrom);

	// Reset currentStep when starting a nested command chain — the nested command should start
	// fresh and not inherit the parent command's step name (which would cause all isAtStep/
	// isAtStepOrUnset checks in the nested command to fail, producing an infinite spin).
	// The outer generator's step is preserved in history and restored by StepsController.dispose().
	if (context.steps != null) {
		context.steps.currentStep = undefined;
	}

	// Only include the StepsContext properties
	return yield* command.executeSteps({
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
