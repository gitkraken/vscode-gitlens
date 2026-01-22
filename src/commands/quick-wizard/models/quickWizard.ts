import type { GlCommands } from '../../../constants.commands.js';
import type { Deferred } from '../../../system/promise.js';
import type { GitWizardCommandArgs } from '../../gitWizard.js';
import type { QuickWizardCommandArgs } from '../../quickWizard.js';

export type AnyQuickWizardCommandArgs = QuickWizardCommandArgs | GitWizardCommandArgs;

export type QuickWizardCommandArgsWithCompletion<T extends AnyQuickWizardCommandArgs = AnyQuickWizardCommandArgs> =
	T & { completion?: Deferred<void> };

export interface CrossCommandReference<T = unknown> {
	command: GlCommands;
	args?: T;
}
