import { createContext } from '@lit/context';
import type { SubscriptionState } from '../../../constants.subscription.js';
import type { WalkthroughProgressPayload } from '../../rpc/walkthroughService.js';
import type { WalkthroughMode } from '../../welcome/protocol.js';
import { createSignalGroup } from '../shared/state/signals.js';

/**
 * Creates a new Welcome state instance with all signals initialized to defaults.
 * Called by the root component; the provided context feeds `gl-welcome-page`.
 *
 * Entirely ephemeral — walkthrough completion state lives in VS Code's walkthrough
 * API, so there is nothing to persist across reloads.
 */
export function createWelcomeState() {
	const { signal, resetAll } = createSignalGroup();

	// Host-pushed domain data
	/** `undefined` until the subscription service's first fetch lands */
	const plusState = signal<SubscriptionState | undefined>(undefined);
	/** Combined progress of both Get Started walkthroughs */
	const walkthroughProgress = signal<WalkthroughProgressPayload | undefined>(undefined);

	/** Seeded from bootstrap metadata (per-show), then updated by `onDidSwitchWalkthroughMode` */
	const mode = signal<WalkthroughMode>('main');

	// Static bootstrap metadata — fixed for this iframe load, but signals so the page reads one source
	const hostAppName = signal('');
	const welcomeTitle = signal('');
	const mcpNeedsInstall = signal(false);
	const mcpShowCleanupNotice = signal(false);

	return {
		plusState: plusState,
		walkthroughProgress: walkthroughProgress,
		mode: mode,

		hostAppName: hostAppName,
		welcomeTitle: welcomeTitle,
		mcpNeedsInstall: mcpNeedsInstall,
		mcpShowCleanupNotice: mcpShowCleanupNotice,

		resetAll: resetAll,
	};
}

/** Welcome state type — the return value of `createWelcomeState()`. */
export type WelcomeState = ReturnType<typeof createWelcomeState>;

export const welcomeStateContext = createContext<WelcomeState>('welcome-state');
