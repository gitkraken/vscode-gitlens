import type { UnifiedDisposable } from '../../system/unifiedDisposable.js';
import type { StepsContext, StepsNavigation } from './models/steps.js';
import { StepsComplete } from './models/steps.js';
import type { QuickCommand } from './quickCommand.js';

export class StepController<StepNames extends string> implements UnifiedDisposable {
	private readonly _step: StepNames;
	private _wentBack = false;

	constructor(
		private readonly _navContext: StepsNavigation<StepNames>,
		step: StepNames,
	) {
		this._step = step;
		this._navContext.canGoBack = this.canGoBack;
	}

	dispose(): void {
		// Only reset currentStep if we didn't go back AND currentStep wasn't changed by something else
		// (e.g., goBackToStep). If currentStep was changed to a different step, leave it alone.
		if (!this._wentBack && this._navContext.currentStep === this._step) {
			this._navContext.currentStep = undefined;
		}
	}

	[Symbol.dispose](): void {
		this.dispose();
	}

	/**
	 * Checks if we can go backwards from the current position
	 * @returns true if there's a previous step to go backwards to
	 */
	get canGoBack(): boolean {
		// If this step is the starting step, only allow going back if launched from menu
		if (this._navContext.startingStep === this._step) {
			return this._navContext.startedFrom === 'menu';
		}

		const currentHistory = this._navContext.history.at(-1)!;

		// We can go back if, we have 2+ steps in current generator, or we have 1 step in current generator but came from an outer generator
		if (currentHistory.length > 1 || (currentHistory.length === 1 && this._navContext.history.length > 1)) {
			return true;
		}
		return false;
	}

	goBack(): StepNames | undefined {
		this._wentBack = true;

		const currentHistory = this._navContext.history.at(-1)!;
		if (!currentHistory.length) return undefined;

		// Pop current step
		currentHistory.pop();

		// If we have a previous step in this generator, go to it
		if (currentHistory.length > 0) {
			const previousStep = currentHistory.at(-1);
			this._navContext.currentStep = previousStep;
			return previousStep;
		}

		// If we're at the first step of a nested generator, exit to outer generator
		if (this._navContext.history.length > 1) {
			// Note: We don't remove the current generator's history array since it will be removed by the dispose() call
			const outerHistory = this._navContext.history[this._navContext.history.length - 2];
			if (outerHistory.length > 0) {
				const outerStep = outerHistory.at(-1);
				this._navContext.currentStep = outerStep;
				return undefined;
			}
		}

		// We're at the first step of the outermost generator - exit wizard
		this._navContext.currentStep = undefined;
		return undefined;
	}

	/**
	 * Removes this step from the navigation history
	 * Use this when a step is automatically skipped (e.g., access check when user already has access)
	 * so that "back" navigation doesn't return to a step the user never actually saw
	 */
	skip(): void {
		const currentHistory = this._navContext.history.at(-1)!;
		// Only remove if this step is still the last in history
		if (currentHistory.length > 0 && currentHistory.at(-1) === this._step) {
			currentHistory.pop();
		}
	}
}

/**
 * Controller class for managing step navigation in nested generators
 * Automatically cleans up step history when the generator exits
 */

export class StepsController<StepNames extends string> implements UnifiedDisposable {
	private readonly _navContext: StepsNavigation<StepNames>;

	/**
	 * @param context The context containing step navigation state
	 * @param command The command to link stepsNavigation to. Required for the main steps() entry point
	 *                so the wizard can check canGoBack. Omit for nested sub-command step generators
	 *                that share the same context.
	 */
	constructor(context: StepsContext<StepNames>, command?: QuickCommand) {
		// Determine if this is a fresh wizard start vs nested sub-command:
		// - Fresh start: context.steps is undefined OR history is empty (no active parent)
		// - Nested: context.steps exists with history entries from active parent
		if (command != null && !context.steps?.history.length) {
			// Fresh wizard invocation - reset navigation state to avoid stale state
			// from previous wizard invocations (e.g., startingStep affecting canGoBack)
			context.steps = { canGoBack: false, currentStep: undefined, startingStep: undefined, history: [] };
		} else {
			// Nested sub-command or no command - initialize only if not already set
			context.steps ??= { canGoBack: false, currentStep: undefined, startingStep: undefined, history: [] };
		}
		context.steps.history.push([]);
		this._navContext = context.steps;

		// Link the navigation context to the command so the wizard can check canGoBack
		if (command != null) {
			command.stepsNavigation = this._navContext;
			// Store how the steps were started so we know if we can go back to the menu
			// Only update if the command has startedFrom set (subcommands don't have it)
			if (command.startedFrom != null) {
				this._navContext.startedFrom = command.startedFrom;
			}
		}
	}

	dispose(): void {
		this._navContext.history.pop();

		// If the wizard is complete, don't reset currentStep - let it propagate
		if (this._navContext.currentStep === StepsComplete) return;

		// Reset currentStep to the outer generator's current step (if any)
		// This prevents the outer generator from re-triggering steps based on
		// a currentStep value that was set by this nested generator
		const outerHistory = this._navContext.history.at(-1);
		if (outerHistory?.length) {
			this._navContext.currentStep = outerHistory.at(-1);
		} else {
			this._navContext.currentStep = undefined;
		}
	}

	[Symbol.dispose](): void {
		this.dispose();
	}

	/**
	 * Checks if the wizard is complete
	 * @returns true if the wizard is complete
	 */
	get isComplete(): boolean {
		return this._navContext.currentStep === StepsComplete;
	}

	isAtStep(step: StepNames): boolean {
		return this._navContext.currentStep === step;
	}

	isAtStepOrUnset(step: StepNames): boolean {
		return this._navContext.currentStep === step || this._navContext.currentStep == null;
	}

	/**
	 * Enters a step in the wizard, managing step history and navigation context
	 * @returns {StepController} a contoller to manage the step
	 */
	enterStep(step: StepNames): StepController<StepNames> {
		// Add step to the current generator's history (last array)
		const currentHistory = this._navContext.history.at(-1)!;

		// If the step already exists in history, remove it from its current position
		// This prevents duplicate entries when toggling between steps
		const existingIndex = currentHistory.indexOf(step);
		if (existingIndex !== -1 && existingIndex !== currentHistory.length - 1) {
			currentHistory.splice(existingIndex, 1);
		}

		// Add to history if not already the last item
		if (currentHistory.at(-1) !== step) {
			currentHistory.push(step);
		}

		// Update context with current step
		this._navContext.currentStep = step;

		// Set startingStep if not already set
		this._navContext.startingStep ??= step;

		return new StepController(this._navContext, step);
	}

	/**
	 * Marks the steps as complete to exit the loop on the next iteration
	 * Use this when you need to execute additional logic after the wizard completes but before the loop exits
	 */
	markStepsComplete(): void {
		this._navContext.currentStep = StepsComplete;
	}

	/**
	 * Goes back to a specific step in the history, or adds it if not present
	 * This is useful for "toggle" buttons that need to go back to a specific step
	 * @param step The step to go back to
	 */
	goBackToStep(step: StepNames): void {
		const currentHistory = this._navContext.history.at(-1)!;

		// Find the step in history
		const index = currentHistory.lastIndexOf(step);
		if (index !== -1) {
			// Found it - truncate everything after it
			currentHistory.length = index + 1;
		} else {
			// Step not in history - clear history and add the step
			// This handles the case where we're toggling to a step that was skipped initially
			currentHistory.length = 0;
			currentHistory.push(step);
		}

		this._navContext.currentStep = step;
	}
}
