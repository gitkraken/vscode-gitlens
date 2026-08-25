import type { CandidateSigner, LoadingProgress, SignerProvider } from '../../allowedSigners/protocol.js';
import { createSignalGroup } from '../shared/state/signals.js';

/**
 * Creates a new Allowed Signers state instance with all signals initialized to defaults.
 * Called by the root component.
 *
 * Entirely ephemeral — nothing survives a hide/show (the iframe is rebuilt and the
 * host's bootstrap re-seeds it with any cached discovery results), so there is
 * nothing to persist across reloads.
 */
export function createAllowedSignersState() {
	const { signal, resetAll } = createSignalGroup();

	// Host-pushed discovery state — updated by `onProgressChanged`/`onResultsChanged`, seeded from bootstrap
	const loading = signal(true);
	/** The current discovery step, shown on the loading page */
	const progress = signal<LoadingProgress | undefined>(undefined);
	const signers = signal<CandidateSigner[]>([]);
	const integrationConnected = signal(false);
	const provider = signal<SignerProvider | undefined>(undefined);
	/** Whether provider verification is still running after the commit-derived signers are shown */
	const verifying = signal(false);
	const error = signal<string | undefined>(undefined);

	// Static bootstrap metadata — fixed for this iframe load
	const repoName = signal<string | undefined>(undefined);
	/** Whether the host can write files (desktop); gates the save/browse UI */
	const hasNodeHost = signal(false);
	/** Fingerprint of the signer to pre-check (from the commit action that opened the editor) */
	const preselectFingerprint = signal<string | undefined>(undefined);

	// UI-owned fields — seeded from bootstrap, then owned by this surface
	const targetPath = signal('');
	const configScope = signal<'global' | 'local'>('global');
	const setConfig = signal(true);
	/** Explicit user toggles, keyed by signer id, overriding the default checked state (see `defaultIncluded`) */
	const overrides = signal<Map<string, boolean>>(new Map());
	/**
	 * Dedupe keys of entries already in the current target file, re-derived by the host whenever the path changes
	 * (and after a save). Undefined until the first check — `isInFile` then falls back to the host-computed
	 * `alreadyPresent`.
	 */
	const presentKeys = signal<Set<string> | undefined>(undefined);
	const saving = signal(false);
	const status = signal<{ type: 'success' | 'error'; message: string } | undefined>(undefined);

	return {
		loading: loading,
		progress: progress,
		signers: signers,
		integrationConnected: integrationConnected,
		provider: provider,
		verifying: verifying,
		error: error,

		repoName: repoName,
		hasNodeHost: hasNodeHost,
		preselectFingerprint: preselectFingerprint,

		targetPath: targetPath,
		configScope: configScope,
		setConfig: setConfig,
		overrides: overrides,
		presentKeys: presentKeys,
		saving: saving,
		status: status,

		resetAll: resetAll,
	};
}

/** Allowed Signers state type — the return value of `createAllowedSignersState()`. */
export type AllowedSignersState = ReturnType<typeof createAllowedSignersState>;
