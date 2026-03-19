import type { Deferred } from '@gitlens/utils/promise.js';
import type { GlCommands } from '../../../constants.commands.js';
import type { GitWizardCommandArgs } from '../../gitWizard.js';
import type { QuickWizardCommandArgs } from '../../quickWizard.js';

export type AnyQuickWizardCommandArgs = QuickWizardCommandArgs | GitWizardCommandArgs;

export type QuickWizardCommandArgsWithCompletion<T extends AnyQuickWizardCommandArgs = AnyQuickWizardCommandArgs> =
	T & { completion?: Deferred<void> };

export interface CrossCommandReference<T = unknown> {
	command: GlCommands;
	args?: T;
}
