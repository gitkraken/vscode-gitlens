import { QuickInputButtons } from 'vscode';
import type { Container } from '../../container.js';
import type { QuickPickItemOfT } from '../../quickpicks/items/common.js';
import type {
	PartialStepState,
	StepGenerator,
	StepResultGenerator,
	StepsContext,
	StepSelection,
} from './models/steps.js';
import { StepResultBreak } from './models/steps.js';
import { QuickCommand } from './quickCommand.js';
import { StepsController } from './stepsController.js';
import { canPickStepContinue, createPickStep } from './utils/steps.utils.js';

export type SubcommandState<TState, TSubcommand extends string> = TState & { subcommand: TSubcommand };

/** Base class for QuickCommands that have subcommands (e.g., branch, tag, stash, worktree) */
export abstract class QuickCommandWithSubcommands<
	TSubcommand extends string,
	TState extends { subcommand: TSubcommand },
	TContext extends StepsContext<string> & { title: string },
> extends QuickCommand<TState> {
	/** Cached context instance */
	private _context: TContext | undefined;
	private subcommand: TSubcommand | undefined;
	private readonly subcommands = new Map<TSubcommand, QuickCommand>();

	constructor(
		container: Container,
		key: string,
		label: string,
		title: string,
		options?: { description?: string; detail?: string },
	) {
		super(container, key, label, title, options);
		this.registerSubcommands();
	}

	/** Can only confirm once a subcommand is selected */
	override get canConfirm(): boolean {
		return this.subcommand != null;
	}

	override get canSkipConfirm(): boolean {
		if (this.subcommand != null) {
			const command = this.subcommands.get(this.subcommand);
			if (command != null && !command.canSkipConfirm) return false;
		}
		return super.canSkipConfirm;
	}

	/**
	 * Subcommand-aware skip confirmation key
	 * Format: `{key}[-{subcommand}]:{startedFrom}`
	 */
	override get skipConfirmKey(): string {
		return `${this.key}${this.subcommand == null ? '' : `-${this.subcommand}`}:${this.startedFrom}`;
	}

	/**
	 * Creates the shared context for this command and its subcommands
	 * Called lazily and cached. Override to provide command-specific context
	 */
	protected abstract override createContext(context?: StepsContext<any>): TContext;

	/**
	 * Called from constructor to register all subcommands
	 * Subclasses must implement this to register their subcommands via `registerSubcommand()`
	 */
	protected abstract registerSubcommands(): void;

	/**
	 * Register a subcommand's QuickCommand
	 * @param name The subcommand name
	 * @param command The QuickCommand that handles this subcommand
	 */
	protected registerSubcommand<T>(name: TSubcommand, command: QuickCommand<T>): void {
		this.subcommands.set(name, command);
	}

	/**
	 * Execute a registered subcommand by delegating to its steps generator
	 * @param name The subcommand name
	 * @param state The current state
	 * @returns The result from the subcommand (undefined for success, StepResultBreak if user backed out)
	 */
	protected executeSubcommand(
		name: TSubcommand,
		state: PartialStepState<TState>,
		context: StepsContext<any>,
	): StepGenerator {
		const command = this.subcommands.get(name);
		if (command == null) throw new Error(`Subcommand '${name}' not registered`);

		return command.getSteps(state, this.createContext(context));
	}

	protected async *steps(state: PartialStepState<TState>, context?: TContext): StepGenerator {
		context ??= this.createContext();
		using steps = new StepsController<string>(context, this);

		const pickSubcommandStepName = `${this.key}-pick-subcommand`;

		while (!steps.isComplete) {
			context.title = this.title;

			// Track if subcommand was pre-selected (user never saw picker)
			const subcommandWasPreSelected = state.subcommand != null;

			if (steps.isAtStep(pickSubcommandStepName) || state.subcommand == null) {
				using step = steps.enterStep(pickSubcommandStepName);
				this.subcommand = state.subcommand = undefined;

				const result = yield* this.pickSubcommandStep(state);
				if (result === StepResultBreak) {
					this.subcommand = state.subcommand = undefined!;
					if (step.goBack() == null) break;
					continue;
				}

				this.subcommand = state.subcommand = result;
			}

			const result = yield* this.executeSubcommand(state.subcommand, state, context);
			if (result === StepResultBreak) {
				this.subcommand = state.subcommand = undefined!;
				// If subcommand was pre-selected (user never saw picker), exit entirely
				if (subcommandWasPreSelected) break;
				continue;
			}

			steps.markStepsComplete();
		}

		return steps.isComplete ? undefined : StepResultBreak;
	}

	protected *pickSubcommandStep(state: PartialStepState<TState>): StepResultGenerator<TSubcommand> {
		const items: QuickPickItemOfT<TSubcommand>[] = Array.from(this.subcommands, ([name, command]) => ({
			label: name,
			description: command.description,
			picked: state.subcommand === name,
			item: name,
		}));

		const step = createPickStep<QuickPickItemOfT<TSubcommand>>({
			title: this.title,
			placeholder: `Choose a ${this.label} command`,
			items: items,
			buttons: [QuickInputButtons.Back],
		});

		const selection: StepSelection<typeof step> = yield step;
		return canPickStepContinue(step, state, selection) ? selection[0].item : StepResultBreak;
	}
}
