import type { QuickInputButton, QuickPick, QuickPickItem } from 'vscode';
import type { Repository } from '../../../git/models/repository.js';
import { getRevisionRangeParts, isRevisionRange, isSha } from '../../../git/utils/revision.utils.js';
import { createQuickPickSeparator } from '../../../quickpicks/items/common.js';
import type { DirectiveQuickPickItem } from '../../../quickpicks/items/directive.js';
import { createDirectiveQuickPickItem, Directive, isDirective } from '../../../quickpicks/items/directive.js';
import { createCommitQuickPickItem, createRefQuickPickItem } from '../../../quickpicks/items/gitWizard.js';
import { getSettledValue } from '../../../system/promise.js';
import { createDisposable } from '../../../system/unifiedDisposable.js';
import type { CustomStep } from '../models/steps.custom.js';
import type { PartialStepState, StepItemType, StepResultBreak, StepState } from '../models/steps.js';
import type { QuickInputStep } from '../models/steps.quickinput.js';
import type { QuickPickStep } from '../models/steps.quickpick.js';

export async function canInputStepContinue<T extends QuickInputStep>(
	step: T,
	state: PartialStepState,
	value: Directive | StepItemType<T>,
): Promise<boolean> {
	if (!canStepContinue(step, state, value)) return false;

	const [valid] = (await step.validate?.(value)) ?? [true];
	return valid;
}

export function canPickStepContinue<T extends QuickPickStep>(
	step: T,
	state: PartialStepState,
	selection: Directive | StepItemType<T>,
): selection is StepItemType<T> {
	if (!canStepContinue(step, state, selection)) return false;

	return step.validate?.(selection) ?? true;
}

export function canStepContinue<T extends QuickInputStep | QuickPickStep | CustomStep>(
	_step: T,
	_state: PartialStepState,
	result: Directive | StepItemType<T>,
): result is StepItemType<T> {
	return result != null && !isDirective(result);
}

export function createConfirmStep<T extends QuickPickItem, Context extends { title: string }>(
	title: string,
	confirmations: T[],
	context: Context,
	cancel?: DirectiveQuickPickItem,
	options?: Partial<QuickPickStep<T>>,
): QuickPickStep<T> {
	return createPickStep<T>({
		isConfirmationStep: true,
		placeholder: `Confirm ${context.title}`,
		title: title,
		ignoreFocusOut: true,
		items: [
			...confirmations,
			createQuickPickSeparator<T>(),
			cancel ?? createDirectiveQuickPickItem(Directive.Cancel),
		],
		selectedItems: [confirmations.find(c => c.picked) ?? confirmations[0]],
		...options,
	});
}

export function createCustomStep<T>(step: Optional<CustomStep<T>, 'type'>): CustomStep<T> {
	return { type: 'custom', ...step };
}

export function createInputStep<T extends string>(step: Optional<QuickInputStep<T>, 'type'>): QuickInputStep<T> {
	const original = step.onDidActivate;
	// Make sure any input steps won't close on focus loss
	step = { type: 'input' as const, ...step, ignoreFocusOut: true };
	step.onDidActivate = input => {
		step.input = input;
		step.freeze = () => {
			input.enabled = false;
			step.frozen = true;
			return createDisposable(
				() => {
					step.frozen = false;
					input.enabled = true;
					input.show();
				},
				{ once: true },
			);
		};
		original?.(input);
	};

	return step as QuickInputStep<T>;
}

export function createPickStep<T extends QuickPickItem>(step: Optional<QuickPickStep<T>, 'type'>): QuickPickStep<T> {
	const original = step.onDidActivate;
	step = { type: 'pick' as const, ...step };
	step.onDidActivate = qp => {
		step.quickpick = qp;
		step.freeze = () => {
			qp.enabled = false;
			const originalFocusOut = qp.ignoreFocusOut;
			qp.ignoreFocusOut = true;
			step.frozen = true;
			return createDisposable(
				() => {
					step.frozen = false;
					qp.enabled = true;
					qp.ignoreFocusOut = originalFocusOut;
					qp.show();
				},
				{ once: true },
			);
		};
		original?.(qp);
	};

	return step as QuickPickStep<T>;
}

export function isCustomStep(
	step: QuickPickStep | QuickInputStep | CustomStep | typeof StepResultBreak,
): step is CustomStep {
	return typeof step === 'object' && 'type' in step && step.type === 'custom';
}

export function isQuickInputStep(
	step: QuickPickStep | QuickInputStep | CustomStep | typeof StepResultBreak,
): step is QuickInputStep {
	return typeof step === 'object' && 'type' in step && step.type === 'input';
}

export function isQuickPickStep(
	step: QuickPickStep | QuickInputStep | CustomStep | typeof StepResultBreak,
): step is QuickPickStep {
	return typeof step === 'object' && 'type' in step && step.type === 'pick';
}

/**
 * A generic assertion function for step state properties
 * No-op at runtime - exists purely for TypeScript type narrowing
 *
 * @example
 * assertStepState<State<Repository>>(state);
 * assertStepState<State<Repository, GitReference[]>>(state);
 */
export function assertStepState<T>(_state: PartialStepState): asserts _state is StepState<T> {}

export function appendReposToTitle<
	State extends { repo: Repository } | { repos: Repository[] },
	Context extends { repos: Repository[] },
>(title: string, state: State, context: Context, additionalContext?: string): string {
	if (context.repos.length === 1) {
		return additionalContext ? `${title}${additionalContext}` : title;
	}

	let repoContext;
	if ((state as { repo: Repository }).repo != null) {
		repoContext = `${additionalContext ?? ''} · ${(state as { repo: Repository }).repo.name}`;
	} else if ((state as { repos: Repository[] }).repos.length === 1) {
		repoContext = `${additionalContext ?? ''} · ${(state as { repos: Repository[] }).repos[0].name}`;
	} else {
		repoContext = ` · ${(state as { repos: Repository[] }).repos.length} repositories`;
	}

	return `${title}${repoContext}`;
}

export function getValidateGitReferenceFn(
	repos: Repository | Repository[] | undefined,
	options?: {
		revs?: { allow: boolean; buttons?: QuickInputButton[] };
		ranges?: { allow: boolean; buttons?: QuickInputButton[]; validate?: boolean };
	},
) {
	return async (quickpick: QuickPick<any>, value: string): Promise<boolean> => {
		if (repos == null) return false;
		if (Array.isArray(repos)) {
			if (repos.length !== 1) return false;

			repos = repos[0];
		}

		let allowRevs = false;
		if (value.startsWith('#')) {
			allowRevs = options?.revs?.allow ?? true;
			value = value.substring(1);
		} else if (isSha(value)) {
			allowRevs = options?.revs?.allow ?? true;
		}

		if (options?.ranges?.allow && isRevisionRange(value)) {
			if (options?.ranges?.validate) {
				// Validate the parts of the range
				const parts = getRevisionRangeParts(value);
				const [leftResult, rightResult] = await Promise.allSettled([
					parts?.left != null ? repos.git.refs.isValidReference(parts.left) : Promise.resolve(true),
					parts?.right != null ? repos.git.refs.isValidReference(parts.right) : Promise.resolve(true),
				]);

				if (!getSettledValue(leftResult, false) || !getSettledValue(rightResult, false)) {
					quickpick.items = [
						createDirectiveQuickPickItem(Directive.Noop, true, { label: `Invalid Range: ${value}` }),
					];
					return true;
				}
			}

			quickpick.items = [
				createRefQuickPickItem(value, repos.path, true, {
					alwaysShow: true,
					buttons: options?.ranges?.buttons,
					ref: false,
					icon: false,
				}),
			];
			return true;
		}

		if (!(await repos.git.refs.isValidReference(value))) {
			if (allowRevs) {
				quickpick.items = [
					createDirectiveQuickPickItem(Directive.Noop, true, {
						label: 'Enter a reference or commit SHA',
					}),
				];
				return true;
			}

			return false;
		}

		if (!allowRevs) {
			if (
				await repos.git.refs.hasBranchOrTag({
					filter: { branches: b => b.name.includes(value), tags: t => t.name.includes(value) },
				})
			) {
				return false;
			}
		}

		const commit = await repos.git.commits.getCommit(value);
		quickpick.items = [
			await createCommitQuickPickItem(commit!, true, {
				alwaysShow: true,
				buttons: options?.revs?.buttons,
				compact: true,
				icon: 'avatar',
			}),
		];
		return true;
	};
}
