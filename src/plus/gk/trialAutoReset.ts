// One-time, out-of-window Pro trial reset. The server owns eligibility (`canResetTrial`) — the client
// never predicts it or schedules around a trial's end. Active trials are skipped without settling and
// re-checked whenever the Graph rebuilds; every other answer is final. Attempts are tracked per account.
//
// Launch promo — to remove: this file + test, `SubscriptionService.autoResetTrialIfEligible` and its
// `graphWebview.getState` call site, the `plus:trialReset:${string}:attempted` storage key (incl. its
// entry in `Storage.reset`'s exclude list and the debug reset in `resets.ts`), and the
// `auto-reset-trial` telemetry action (re-run `pnpm run generate:docs:telemetry` after).
// Keep the Graph's Pro-access-flip rebuild in `graphWebview.onSubscriptionChanged` — it is not
// promo-specific (it also covers upgrades and manual reactivation).

import type { AuthenticationSession, MessageItem } from 'vscode';
import { window } from 'vscode';
import { isCancellationError } from '@gitlens/utils/cancellation.js';
import { Logger } from '@gitlens/utils/logger.js';
import { pluralize } from '@gitlens/utils/string.js';
import { urls } from '../../constants.js';
import type { Source } from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import { AuthenticationRequiredError, RequestsAreBlockedTemporarilyError } from '../../errors.js';
import { openUrl } from '../../system/-webview/vscode/uris.js';
import type { Subscription } from './models/subscription.js';
import type { ServerConnection } from './serverConnection.js';
import { getSubscriptionTimeRemaining, isSubscriptionPaid, isSubscriptionTrial } from './utils/subscription.utils.js';

type TrialResetStep =
	/** Paid plan — the reset would change nothing for them; settled by design rather than re-checked. */
	| 'paid'
	/** The server answered, and this account may not reset early. */
	| 'not-eligible'
	/** The reset went through. */
	| 'reset'
	/** Eligibility approved the account but the reset 409'd — the backend excludes some accounts for
	 *  reasons the client cannot see (e.g. paid-org members). Kept as its own telemetry outcome so a
	 *  systematic disagreement between the two stays visible. */
	| 'refused'
	/** Offline or server error — nothing was decided; retry later. */
	| 'failed'
	/** The eligibility payload no longer matches what the client reads — the promo is off for everyone
	 *  until it's fixed, so it stays out of the generic `failed` bucket. */
	| 'failed-shape';

/** `GET user/trial-eligibility` — only `canResetTrial` gates the reset; the rest is for diagnostics. */
type TrialEligibility = {
	canResetTrial?: boolean;
	isExtendedReset?: boolean;
	resetCount?: number;
	resetLimit?: number;
	nextOptInDate?: string;
	trialEnd?: string;
};

export type TrialResetHost = {
	getSubscription(): Promise<Subscription>;
	ensureSession(): Promise<AuthenticationSession | undefined>;
	/** Forces a check-in so the reset trial's new dates land in the stored subscription. */
	refreshSubscription(session: AuthenticationSession): Promise<void>;
	/** Tells the user their trial is back — called only when the client actually sees the new trial.
	 *  Defaults to the reactivation toast; overridable for tests. */
	notifyReset?(subscription: Subscription): void;
};

type SessionAttempt = { at: number; count: number };

/** Attempts per account — a transient failure retries after a cooldown and gives up for the session
 *  after a few tries, staying clear of the global GK request blocker. */
const sessionAttempts = new Map<string, SessionAttempt>();
const attemptCooldownMs = 5 * 60 * 1000;
const maxAttemptsPerSession = 3;

/** Lets the debug `Reset > Subscription` command re-arm the flow without a window reload. */
export function clearTrialResetSessionAttempts(): void {
	sessionAttempts.clear();
}

/** Assumes a single-flight caller — invoke only via the `@gate`d `SubscriptionService.autoResetTrialIfEligible`. */
export async function autoResetTrialIfEligible(
	container: Container,
	connection: ServerConnection,
	host: TrialResetHost,
	source: Source,
): Promise<void> {
	const subscription = await host.getSubscription();

	if (subscription.account == null || subscription.account.verified === false) return;

	const accountId = subscription.account.id;
	if (container.storage.get(`plus:trialReset:${accountId}:attempted`, false)) return;

	if (isSubscriptionPaid(subscription)) {
		await settle(container, source, accountId, 'paid');
		return;
	}

	if (isSubscriptionTrial(subscription)) return;

	const attempt = sessionAttempts.get(accountId);
	if (attempt != null && (attempt.count >= maxAttemptsPerSession || Date.now() - attempt.at < attemptCooldownMs)) {
		return;
	}

	// Signed out or the session lapsed — skip quietly and re-check on a later state build. A switch
	// to another account while awaiting above would reset that account's trial under this one's flag
	const session = await host.ensureSession();
	if (session == null || session.account.id !== accountId) return;

	sessionAttempts.set(accountId, { at: Date.now(), count: (attempt?.count ?? 0) + 1 });

	let eligibility: TrialEligibility;
	try {
		// Pinned to the captured session so an account switch mid-flight can't reset the wrong account
		const rsp = await connection.fetchGkApi(
			'user/trial-eligibility',
			{ method: 'GET' },
			{ token: session.accessToken },
		);
		if (!rsp.ok) {
			Logger.warn(`Unable to check Pro trial reset eligibility: (${rsp.status}) ${rsp.statusText}`);
			await settle(container, source, accountId, 'failed');
			return;
		}

		eligibility = (await rsp.json()) as TrialEligibility;
	} catch (ex) {
		if (handledAsTransient(ex, accountId, attempt)) return;

		Logger.error(ex, 'Unable to check Pro trial reset eligibility');
		await settle(container, source, accountId, 'failed');
		return;
	}

	// Fail open on an unrecognized shape — settling on it would permanently kill the promo for
	// everyone if the endpoint's payload ever changes. Its own outcome so a contract break is
	// distinguishable from an outage in telemetry.
	const trialEnd = eligibility.trialEnd != null ? new Date(eligibility.trialEnd) : undefined;
	if (typeof eligibility.canResetTrial !== 'boolean' || (trialEnd != null && isNaN(trialEnd.getTime()))) {
		Logger.warn('Unable to check Pro trial reset eligibility: unrecognized response shape');
		await settle(container, source, accountId, 'failed-shape');
		return;
	}

	if (!eligibility.canResetTrial) {
		// The server sees an active trial the client doesn't (a reset POST that timed out after
		// succeeding, or a trial started from another GK app) — refresh instead of settling on
		// stale state; once that trial lapses a re-check settles honestly
		if (trialEnd != null && trialEnd > new Date()) {
			try {
				await host.refreshSubscription(session);
			} catch (ex) {
				Logger.error(ex, 'Unable to refresh the stale subscription');
			}
			return;
		}

		Logger.debug(
			`Pro trial reset unavailable: extended=${eligibility.isExtendedReset}, resets=${eligibility.resetCount}/${eligibility.resetLimit}, nextOptInDate=${eligibility.nextOptInDate}`,
		);
		await settle(container, source, accountId, 'not-eligible');
		return;
	}

	try {
		const rsp = await connection.fetchGkApi(
			'user/reactivate-trial',
			{ method: 'POST', body: JSON.stringify({ client: 'gitlens' }) },
			{ token: session.accessToken },
		);
		if (!rsp.ok) {
			if (rsp.status === 409) {
				Logger.warn(
					'Pro trial reset was refused (409) despite a positive eligibility check — expected for accounts the backend excludes for reasons the client cannot see (e.g. paid-org members)',
				);
				await settle(container, source, accountId, 'refused');
			} else {
				Logger.warn(`Unable to reset Pro trial: (${rsp.status}) ${rsp.statusText}`);
				await settle(container, source, accountId, 'failed');
			}
			return;
		}
	} catch (ex) {
		if (handledAsTransient(ex, accountId, attempt)) return;

		Logger.error(ex, 'Unable to reset Pro trial');
		await settle(container, source, accountId, 'failed');
		return;
	}

	Logger.debug(`Pro trial reset performed: extended=${eligibility.isExtendedReset}`);
	await settle(container, source, accountId, 'reset');

	try {
		await host.refreshSubscription(session);
	} catch (ex) {
		// The trial is already reset server-side; without this check-in the new dates just show up on the next one.
		Logger.error(ex, 'Unable to refresh the subscription after resetting the Pro trial');
	}

	// Only celebrate when the client actually sees the new trial — a failed check-in above would
	// pair a success toast with a still-gated UI; the next check-in surfaces the dates silently
	const refreshed = await host.getSubscription();
	if (isSubscriptionTrial(refreshed)) {
		(host.notifyReset ?? showTrialResetMessage)(refreshed);
	}
}

function showTrialResetMessage(subscription: Subscription): void {
	const remaining = getSubscriptionTimeRemaining(subscription, 'days') ?? 0;
	const message = `Your GitLens Pro trial has been reactivated! Experience all the new Pro features for another ${pluralize(
		'day',
		remaining,
	)}.`;

	const learn: MessageItem = { title: "See What's New" };
	void window.showInformationMessage(message, learn).then(result => {
		if (result === learn) {
			void openUrl(urls.releaseNotes);
		}
	});
}

/** Expected states rather than errors — no telemetry. Blocked and unauthenticated requests never leave
 *  the client, so they keep the cooldown without spending a try; a timed-out one did go out and counts. */
function handledAsTransient(ex: unknown, accountId: string, attempt: SessionAttempt | undefined): boolean {
	if (ex instanceof RequestsAreBlockedTemporarilyError || ex instanceof AuthenticationRequiredError) {
		sessionAttempts.set(accountId, { at: Date.now(), count: attempt?.count ?? 0 });
		return true;
	}

	return isCancellationError(ex);
}

async function settle(container: Container, source: Source, accountId: string, step: TrialResetStep): Promise<void> {
	// Every definitive step ends the account's one-time attempt; only failures retry later
	const settled = step !== 'failed' && step !== 'failed-shape';
	const outcome = step === 'paid' ? undefined : step;

	if (outcome != null && container.telemetry.enabled) {
		container.telemetry.sendEvent('subscription/action', { action: 'auto-reset-trial', outcome: outcome }, source);
	}

	if (settled) {
		// Swallow storage failures — on the reset path a throw here would skip the refresh + message
		await container.storage
			.store(`plus:trialReset:${accountId}:attempted`, true)
			.catch((ex: unknown) => Logger.error(ex, 'Unable to persist the Pro trial reset attempt'));
	}
}
