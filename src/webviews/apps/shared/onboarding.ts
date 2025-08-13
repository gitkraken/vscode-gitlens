import type { Config, Driver, DriveStep, State } from 'driver.js';
import { driver } from 'driver.js';

export type KeyedDriverHook = (
	key: string,
	step: DriveStep,
	opts: {
		config: Config;
		state: State;
		element: Element | undefined;
	},
) => void;

export interface KeyedDriveStep extends DriveStep {
	key: string;
}

export function createOnboarding(
	steps: KeyedDriveStep[],
	config: Exclude<Config, 'steps'> = {},
	onHighlightedByKey?: KeyedDriverHook,
): Driver {
	const driverConfig: Config = {
		showProgress: true,
		...config,
		steps: steps.map(keyedStep => ({
			...keyedStep,
			onHighlighted:
				keyedStep.onHighlighted != null || onHighlightedByKey != null
					? (element, step, opts) => {
							keyedStep.onHighlighted?.(element, step, opts);
							onHighlightedByKey?.(keyedStep.key, step, { ...opts, element: element });
						}
					: undefined,
		})),
		onHighlighted:
			onHighlightedByKey != null
				? (element, step, opts) => {
						config.onHighlighted?.(element, step, opts);

						const keyedStep = steps.find(s => s.popover === step.popover);
						if (keyedStep == null) return;

						onHighlightedByKey(keyedStep.key, step, { ...opts, element: element });
					}
				: undefined,
	};

	return driver(driverConfig);
}
