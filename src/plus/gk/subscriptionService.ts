import type {
	AuthenticationProviderAuthenticationSessionsChangeEvent,
	AuthenticationSession,
	CancellationToken,
	Event,
	MessageItem,
	StatusBarItem,
} from 'vscode';
import {
	CancellationTokenSource,
	version as codeVersion,
	Disposable,
	env,
	EventEmitter,
	MarkdownString,
	ProgressLocation,
	StatusBarAlignment,
	ThemeColor,
	Uri,
	window,
} from 'vscode';
import { getPlatform } from '@env/platform.js';
import type { OpenWalkthroughCommandArgs } from '../../commands/walkthroughs.js';
import type { CoreColors } from '../../constants.colors.js';
import type { GlCommands } from '../../constants.commands.js';
import { urls } from '../../constants.js';
import type { StoredFeaturePreviewUsagePeriod } from '../../constants.storage.js';
import {
	proFeaturePreviewUsageDurationInDays,
	proFeaturePreviewUsages,
	proTrialLengthInDays,
	SubscriptionState,
} from '../../constants.subscription.js';
import type {
	FeaturePreviewActionEventData,
	FeaturePreviewDayEventData,
	FeaturePreviewEventData,
	Source,
	SubscriptionEventDataWithPrevious,
	SubscriptionFeaturePreviewsEventData,
	TrackingContext,
} from '../../constants.telemetry.js';
import type { Container } from '../../container.js';
import { AccountValidationError, RequestsAreBlockedTemporarilyError } from '../../errors.js';
import type { FeaturePreview, FeaturePreviews } from '../../features.js';
import { featurePreviews, getFeaturePreviewLabel, getFeaturePreviewStatus } from '../../features.js';
import type { RepositoriesChangeEvent } from '../../git/gitProviderService.js';
import { executeCommand, registerCommand } from '../../system/-webview/command.js';
import { configuration } from '../../system/-webview/configuration.js';
import { setContext } from '../../system/-webview/context.js';
import { openUrl } from '../../system/-webview/vscode/uris.js';
import { createFromDateDelta, fromNow } from '../../system/date.js';
import { gate } from '../../system/decorators/gate.js';
import { debug, info, trace } from '../../system/decorators/log.js';
import { take } from '../../system/event.js';
import type { Deferrable } from '../../system/function/debounce.js';
import { debounce } from '../../system/function/debounce.js';
import { once } from '../../system/function.js';
import { Logger } from '../../system/logger.js';
import { getScopedLogger } from '../../system/logger.scope.js';
import { flatten } from '../../system/object.js';
import { pauseOnCancelOrTimeout } from '../../system/promise.js';
import { pluralize } from '../../system/string.js';
import { createDisposable } from '../../system/unifiedDisposable.js';
import { LoginUriPathPrefix } from './authenticationConnection.js';
import { authenticationProviderScopes } from './authenticationProvider.js';
import type { GKCheckInResponse } from './models/checkin.js';
import type { Organization } from './models/organization.js';
import type { Promo } from './models/promo.js';
import type { PaidSubscriptionPlanIds, Subscription, SubscriptionUpgradeCommandArgs } from './models/subscription.js';
import type { ServerConnection } from './serverConnection.js';
import { ensurePlusFeaturesEnabled } from './utils/-webview/plus.utils.js';
import { getConfiguredActiveOrganizationId, updateActiveOrganizationId } from './utils/-webview/subscription.utils.js';
import { getSubscriptionFromCheckIn } from './utils/checkin.utils.js';
import {
	AiAllAccessOptInPathPrefix,
	assertSubscriptionState,
	compareSubscriptionPlans,
	computeSubscriptionState,
	getCommunitySubscription,
	getSubscriptionNextPaidPlanId,
	getSubscriptionPlan,
	getSubscriptionPlanType,
	getSubscriptionProductPlanName,
	getSubscriptionStateString,
	getSubscriptionTimeRemaining,
	isSubscriptionExpired,
	isSubscriptionPaid,
	isSubscriptionTrial,
	SubscriptionUpdatedUriPathPrefix,
} from './utils/subscription.utils.js';

export type FeaturePreviewChangeEvent = FeaturePreview;

export interface SubscriptionChangeEvent {
	readonly current: Subscription;
	readonly previous: Subscription;
	readonly etag: number;
}

export class SubscriptionService implements Disposable {
	private _onDidChange = new EventEmitter<SubscriptionChangeEvent>();
	get onDidChange(): Event<SubscriptionChangeEvent> {
		return this._onDidChange.event;
	}

	private _onDidChangeFeaturePreview = new EventEmitter<FeaturePreviewChangeEvent>();
	get onDidChangeFeaturePreview(): Event<FeaturePreviewChangeEvent> {
		return this._onDidChangeFeaturePreview.event;
	}

	private _onDidCheckIn = new EventEmitter<{ force?: boolean } | void>();
	get onDidCheckIn(): Event<{ force?: boolean } | void> {
		return this._onDidCheckIn.event;
	}

	private _disposable: Disposable;
	private _subscription!: Subscription;
	private _getCheckInData: () => Promise<GKCheckInResponse | undefined>;
	private _statusBarSubscription: StatusBarItem | undefined;
	private _validationTimer: ReturnType<typeof setInterval> | undefined;

	constructor(
		private readonly container: Container,
		private readonly connection: ServerConnection,
		_previousVersion: string | undefined,
	) {
		this._disposable = Disposable.from(
			this._onDidChange,
			this._onDidChangeFeaturePreview,
			this._onDidCheckIn,
			once(container.onReady)(this.onReady, this),
			this.container.accountAuthentication.onDidChangeSessions(
				e => setTimeout(() => this.onAuthenticationChanged(e), 0),
				this,
			),
			configuration.onDidChange(e => {
				if (configuration.changed(e, 'plusFeatures')) {
					this.updateContext();
				}
			}),
			container.uri.onDidReceiveSubscriptionUpdatedUri(() => this.checkUpdatedSubscription(undefined), this),
			container.uri.onDidReceiveAiAllAccessOptInUri(this.onAiAllAccessOptInUri, this),
			container.uri.onDidReceiveLoginUri(this.onLoginUriReceived, this),
		);

		const subscription = this.getStoredSubscription();
		this._getCheckInData = () => Promise.resolve(undefined);
		if (subscription?.account?.id != null) {
			this._getCheckInData = () => this.loadStoredCheckInData(subscription.account!.id);
		}

		this.changeSubscription(subscription, undefined, { silent: true });
		setTimeout(() => void this.ensureSession(false, undefined), 10000);
	}

	dispose(): void {
		this._statusBarSubscription?.dispose();

		this._disposable.dispose();
	}

	private async onAuthenticationChanged(e: AuthenticationProviderAuthenticationSessionsChangeEvent) {
		let session = this._session;
		if (session == null && this._sessionPromise != null) {
			session = await this._sessionPromise;
		}

		if (session != null && e.removed?.some(s => s.id === session.id)) {
			this._session = undefined;
			this._sessionPromise = undefined;
			void this.logout(undefined);
			return;
		}

		const updated = e.added?.[0] ?? e.changed?.[0];
		if (updated == null) return;

		if (updated.id === session?.id && updated.accessToken === session?.accessToken) {
			return;
		}

		this._session = session;
		void this.validate({ force: true });
	}

	private _etag: number = 0;
	get etag(): number {
		return this._etag;
	}

	private onReady() {
		this._disposable = Disposable.from(
			this._disposable,
			this.container.git.onDidChangeRepositories(this.onRepositoriesChanged, this),
			...this.registerCommands(),
		);
		this.updateContext();

		if (DEBUG) {
			void import(/* webpackChunkName: "__debug__" */ './__debug__accountDebug.js').then(m => {
				let savedSession: { session: AuthenticationSession | null | undefined } | undefined;

				const setSession = (session: AuthenticationSession | null | undefined) => {
					this._sessionPromise = undefined;
					if (session === this._session) return;

					const previous = this._session;
					this._session = session;

					// Replace the next `onAuthenticationChanged` handler to avoid our own trigger below
					const fn = this.onAuthenticationChanged;
					// eslint-disable-next-line @typescript-eslint/require-await
					this.onAuthenticationChanged = async () => {
						this.onAuthenticationChanged = fn;
					};

					// @ts-expect-error - fragile, but don't want to expose this as it is only for debugging
					this.container.accountAuthentication._onDidChangeSessions.fire({
						added: previous == null && session != null ? [session] : [],
						removed: previous != null && session == null ? [previous] : [],
						changed: previous != null && session != null ? [session] : [],
					});
				};

				let savedFeaturePreviewOverrides:
					| {
							getFn: SubscriptionService['getStoredFeaturePreview'] | undefined;
							setFn: SubscriptionService['storeFeaturePreview'] | undefined;
					  }
					| undefined;

				m.registerAccountDebug(this.container, {
					getSubscription: () => this._subscription,
					overrideFeaturePreviews: ({ day, durationSeconds }) => {
						savedFeaturePreviewOverrides ??= {
							getFn: this.getStoredFeaturePreview,
							setFn: this.storeFeaturePreview,
						};

						const map = new Map<FeaturePreviews, FeaturePreview>();

						this.getStoredFeaturePreview = (feature: FeaturePreviews) => {
							let featurePreview = map.get(feature);
							if (featurePreview == null) {
								featurePreview = {
									feature: feature,
									usages: [],
								};
								map.set(feature, featurePreview);

								if (!day) return featurePreview;

								const expired = new Date(0).toISOString();
								for (let i = 1; i <= day; i++) {
									featurePreview.usages.push({ startedOn: expired, expiresOn: expired });
								}
							}

							return featurePreview;
						};

						this.storeFeaturePreview = (feature: FeaturePreviews) => {
							let featurePreview = map.get(feature);
							if (featurePreview == null) {
								featurePreview = {
									feature: feature,
									usages: [],
								};
								map.set(feature, featurePreview);
							}

							day++;

							const now = new Date();
							const expired = new Date(0).toISOString();

							for (let i = 1; i <= day; i++) {
								if (i !== day) {
									featurePreview.usages.push({ startedOn: expired, expiresOn: expired });
									continue;
								}

								featurePreview.usages.push({
									startedOn: now.toISOString(),
									expiresOn: createFromDateDelta(now, {
										seconds: durationSeconds,
									}).toISOString(),
								});
							}

							return Promise.resolve();
						};

						// Fire a change for all feature previews
						for (const feature of featurePreviews) {
							this._onDidChangeFeaturePreview.fire(this.getStoredFeaturePreview(feature));
						}
					},
					restoreFeaturePreviews: () => {
						if (savedFeaturePreviewOverrides) {
							this.getStoredFeaturePreview = savedFeaturePreviewOverrides.getFn!;
							this.storeFeaturePreview = savedFeaturePreviewOverrides.setFn!;
							savedFeaturePreviewOverrides = undefined;

							// Fire a change for all feature previews
							for (const feature of featurePreviews) {
								this._onDidChangeFeaturePreview.fire(this.getStoredFeaturePreview(feature));
							}
						}
					},
					overrideSession: (session: AuthenticationSession | null | undefined) => {
						savedSession ??= { session: this._session };

						setSession(session);
					},
					restoreSession: () => {
						if (savedSession == null) return;

						const { session } = savedSession;
						savedSession = undefined;

						setSession.call(this, session);
					},
					onDidCheckIn: this._onDidCheckIn,
					changeSubscription: this.changeSubscription.bind(this),
					getStoredSubscription: this.getStoredSubscription.bind(this),
				});
			});
		}
	}

	private onRepositoriesChanged(_e: RepositoriesChangeEvent): void {
		this.updateContext();
	}

	private registerCommands(): Disposable[] {
		return [
			registerCommand('gitlens.plus.login', (src?: Source) => this.loginOrSignUp(false, src)),
			registerCommand('gitlens.plus.signUp', (src?: Source) => this.loginOrSignUp(true, src)),
			registerCommand('gitlens.plus.logout', (src?: Source) => this.logout(src)),
			registerCommand('gitlens.plus.referFriend', (src?: Source) => this.referFriend(src)),
			registerCommand('gitlens.gk.switchOrganization', (src?: Source) => this.switchOrganization(src)),

			registerCommand('gitlens.plus.manage', (src?: Source) => this.manageAccount(src)),
			registerCommand('gitlens.plus.showPlans', (src?: Source) => this.showPlans(src)),
			registerCommand('gitlens.plus.reactivateProTrial', (src?: Source) => this.reactivateProTrial(src)),
			registerCommand('gitlens.plus.resendVerification', (src?: Source) => this.resendVerification(src)),
			registerCommand('gitlens.plus.upgrade', (args?: SubscriptionUpgradeCommandArgs) =>
				this.upgrade(args?.plan, args ? { source: args.source, detail: args.detail } : undefined),
			),
			registerCommand('gitlens.plus.aiAllAccess.optIn', (src?: Source) => this.aiAllAccessOptIn(src)),

			registerCommand('gitlens.plus.hide', (src?: Source) => this.setProFeaturesVisibility(false, src)),
			registerCommand('gitlens.plus.restore', (src?: Source) => this.setProFeaturesVisibility(true, src)),

			registerCommand('gitlens.plus.validate', (src?: Source) => this.validate({ force: true }, src)),

			registerCommand('gitlens.plus.continueFeaturePreview', ({ feature }: { feature: FeaturePreviews }) =>
				this.continueFeaturePreview(feature),
			),
		];
	}

	async getAuthenticationSession(createIfNeeded: boolean = false): Promise<AuthenticationSession | undefined> {
		return this.ensureSession(createIfNeeded, undefined);
	}

	async getSubscription(cached = false): Promise<Subscription> {
		const promise = this.ensureSession(false, undefined);
		if (!cached) {
			void (await promise);
		}
		return this._subscription;
	}

	@gate()
	@debug()
	async continueFeaturePreview(feature: FeaturePreviews): Promise<void> {
		const preview = this.getStoredFeaturePreview(feature);
		const status = getFeaturePreviewStatus(preview);

		// If the current iteration is still active, don't do anything
		if (status === 'active') return;

		if (status === 'expired') {
			void window.showInformationMessage(
				`Your ${proFeaturePreviewUsages}-day preview of the ${getFeaturePreviewLabel(feature)} has expired.`,
			);
			return;
		}

		const now = new Date();
		const usages = [
			...preview.usages,
			{
				startedOn: now.toISOString(),
				expiresOn: createFromDateDelta(now, {
					days: proFeaturePreviewUsageDurationInDays,
				}).toISOString(),
			},
		];

		await this.storeFeaturePreview(feature, usages);

		this._onDidChangeFeaturePreview.fire({ feature: feature, usages: usages });

		if (this.container.telemetry.enabled) {
			const data: FeaturePreviewActionEventData = {
				action: `start-preview-trial:${feature}`,
				...flattenFeaturePreview({ feature: feature, usages: usages }),
			};

			this.container.telemetry.sendEvent('subscription/action', data, { source: feature });
		}
	}

	getFeaturePreview(feature: FeaturePreviews): FeaturePreview {
		return this.getStoredFeaturePreview(feature);
	}

	getFeaturePreviews(): FeaturePreview[] {
		return featurePreviews.map(f => this.getStoredFeaturePreview(f));
	}

	@trace()
	async learnAboutPro(source: Source, originalSource: Source | undefined): Promise<void> {
		if (originalSource != null) {
			source.detail = {
				...(typeof source.detail === 'string' ? { action: source.detail } : source.detail),
				...flatten(originalSource, 'original'),
			};
		}

		const subscription = await this.getSubscription();
		switch (subscription.state) {
			case SubscriptionState.VerificationRequired:
			case SubscriptionState.Community:
				void executeCommand<OpenWalkthroughCommandArgs>('gitlens.openWalkthrough', {
					step: 'get-started-community',
					source: source,
				});
				break;
			case SubscriptionState.Trial:
				void executeCommand<OpenWalkthroughCommandArgs>('gitlens.openWalkthrough', {
					step: 'welcome-in-trial',
					source: source,
				});
				break;
			case SubscriptionState.TrialReactivationEligible:
			case SubscriptionState.TrialExpired:
				void executeCommand<OpenWalkthroughCommandArgs>('gitlens.openWalkthrough', {
					step: 'welcome-in-trial-expired',
					source: source,
				});
				break;
			case SubscriptionState.Paid:
				void executeCommand<OpenWalkthroughCommandArgs>('gitlens.openWalkthrough', {
					step: 'welcome-paid',
					source: source,
				});
				break;
		}
	}

	private async showPlanMessage(source: Source | undefined) {
		if (!(await this.ensureSession(false, source))) return;
		const {
			account,
			plan: { actual, effective },
		} = this._subscription;

		if (account?.verified === false) {
			const verify: MessageItem = { title: 'Resend Email' };
			const confirm: MessageItem = { title: 'Continue', isCloseAffordance: true };

			const result = await window.showInformationMessage(
				'Welcome to GitLens',
				{ modal: true, detail: 'Verify the email we just sent you to start your Pro trial.' },
				verify,
				confirm,
			);

			if (result === verify) {
				void this.resendVerification(source);
			}
		} else if (isSubscriptionPaid(this._subscription)) {
			const learn: MessageItem = { title: 'Learn More' };
			const confirm: MessageItem = { title: 'Continue', isCloseAffordance: true };
			const result = await window.showInformationMessage(
				`You are now on ${actual.name} and have full access to all GitLens Pro features.`,
				{ modal: true },
				confirm,
				learn,
			);

			if (result === learn) {
				void this.learnAboutPro({ source: 'prompt', detail: { action: 'upgraded' } }, source);
			}
		} else if (isSubscriptionTrial(this._subscription)) {
			const days = getSubscriptionTimeRemaining(this._subscription, 'days') ?? 0;

			const learn: MessageItem = { title: 'Learn More' };
			const confirm: MessageItem = { title: 'Continue', isCloseAffordance: true };
			const result = await window.showInformationMessage(
				`Welcome to your ${effective.name} Trial.\n\nYou now have full access to all GitLens Pro features for ${
					days < 1 ? '<1 more day' : pluralize('day', days, { infix: ' more ' })
				}.`,
				{
					modal: true,
					detail: 'Your trial also includes access to the GitKraken DevEx platform, unleashing powerful Git visualization & productivity capabilities everywhere you work: IDE, desktop, browser, and terminal.',
				},
				confirm,
				learn,
			);

			if (result === learn) {
				void this.learnAboutPro({ source: 'prompt', detail: { action: 'trial-started' } }, source);
			}
		} else {
			const upgrade: MessageItem = { title: 'Upgrade to Pro' };
			const learn: MessageItem = { title: 'Community vs. Pro' };
			const confirm: MessageItem = { title: 'Continue', isCloseAffordance: true };
			const result = await window.showInformationMessage(
				`You are now on ${actual.name}.`,
				{
					modal: true,
					detail: 'You only have access to Pro features on publicly-hosted repos. For full access to all Pro features, please upgrade to GitLens Pro.',
				},
				upgrade,
				learn,
				confirm,
			);

			if (result === upgrade) {
				void this.upgrade('pro', source);
			} else if (result === learn) {
				void this.learnAboutPro({ source: 'prompt', detail: { action: 'trial-ended' } }, source);
			}
		}
	}

	@debug()
	async loginOrSignUp(signUp: boolean, source: Source | undefined): Promise<boolean> {
		if (!(await ensurePlusFeaturesEnabled())) return false;

		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent(
				'subscription/action',
				{ action: signUp ? 'sign-up' : 'sign-in' },
				source,
			);
		}

		const context = getTrackingContextFromSource(source);
		return this.loginCore({ signUp: signUp, source: source, context: context });
	}

	async loginWithCode(authentication: { code: string; state?: string }, source?: Source): Promise<boolean> {
		if (!(await ensurePlusFeaturesEnabled())) return false;
		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent('subscription/action', { action: 'sign-in' }, source);
		}

		const session = await this.ensureSession(false, source);
		if (session != null) {
			await this.logout(source);
		}

		return this.loginCore({ signIn: authentication, source: source });
	}

	private async loginCore(options?: {
		signUp?: boolean;
		source?: Source;
		signIn?: { code: string; state?: string };
		context?: TrackingContext;
	}): Promise<boolean> {
		// Abort any waiting authentication to ensure we can start a new flow
		await this.container.accountAuthentication.abort();
		void this.showAccountView();

		const session = await this.ensureSession(true, options?.source, {
			signIn: options?.signIn,
			signUp: options?.signUp,
			context: options?.context,
		});
		const loggedIn = Boolean(session);
		if (loggedIn) {
			void executeCommand('gitlens.ai.mcp.authCLI');
			void this.showPlanMessage(options?.source);
		}
		return loggedIn;
	}

	@debug()
	async logout(source: Source | undefined): Promise<void> {
		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent('subscription/action', { action: 'sign-out' }, source);
		}

		return this.logoutCore(source);
	}

	private async logoutCore(source: Source | undefined): Promise<void> {
		this.connection.resetRequestExceptionCount();
		this._lastValidatedDate = undefined;
		if (this._validationTimer != null) {
			clearInterval(this._validationTimer);
			this._validationTimer = undefined;
		}

		await this.container.accountAuthentication.abort();

		this._sessionPromise = undefined;
		if (this._session != null) {
			void this.container.accountAuthentication.removeSession(this._session.id);
			this._session = undefined;
		} else {
			// Even if we don't have a session, make sure to remove any other matching sessions
			void this.container.accountAuthentication.removeSessionsByScopes(authenticationProviderScopes);
		}

		this.changeSubscription(getCommunitySubscription(this._subscription), source);
	}

	@debug()
	async manageAccount(source: Source | undefined): Promise<boolean> {
		const scope = getScopedLogger();
		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent('subscription/action', { action: 'manage' }, source);
		}

		try {
			const exchangeToken = await this.container.accountAuthentication.getExchangeToken();
			return await openUrl(await this.container.urls.getGkDevUrl('account', `token=${exchangeToken}`));
		} catch (ex) {
			scope?.error(ex);
			return openUrl(await this.container.urls.getGkDevUrl('account'));
		}
	}

	@debug()
	async manageSubscription(source: Source | undefined): Promise<boolean> {
		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent('subscription/action', { action: 'manage-subscription' }, source);
		}

		return openUrl(await this.container.urls.getGkDevUrl('subscription/edit'));
	}

	@gate(() => '')
	@debug()
	async reactivateProTrial(source: Source | undefined): Promise<void> {
		const scope = getScopedLogger();

		if (!(await ensurePlusFeaturesEnabled())) return;

		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent('subscription/action', { action: 'reactivate' }, source);
		}

		const session = await this.ensureSession(false, source);
		if (session == null) return;

		try {
			const rsp = await this.connection.fetchGkApi('user/reactivate-trial', {
				method: 'POST',
				body: JSON.stringify({ client: 'gitlens' }),
			});

			if (!rsp.ok) {
				if (rsp.status === 409) {
					void window.showErrorMessage(
						'You are not eligible to reactivate your Pro trial. If you feel that is an error, please contact support.',
						'OK',
					);
					return;
				}

				void window.showErrorMessage(
					`Unable to reactivate trial: (${rsp.status}) ${rsp.statusText}. Please try again. If this issue persists, please contact support.`,
					'OK',
				);
				return;
			}
		} catch (ex) {
			if (ex instanceof RequestsAreBlockedTemporarilyError) {
				void window.showErrorMessage(
					'Unable to reactivate trial: Too many failed requests. Please reload the window and try again.',
					'OK',
				);
				return;
			}

			void window.showErrorMessage(
				`Unable to reactivate trial. Please try again. If this issue persists, please contact support.`,
				'OK',
			);
			scope?.error(ex);
			return;
		}

		// Trial was reactivated. Do a check-in to update, and show a message if successful.
		try {
			await this.checkInAndValidate(session, source, { force: true });
			if (isSubscriptionTrial(this._subscription)) {
				const remaining = getSubscriptionTimeRemaining(this._subscription, 'days');

				const confirm: MessageItem = { title: 'OK', isCloseAffordance: true };
				const learn: MessageItem = { title: "See What's New" };
				const result = await window.showInformationMessage(
					`Your GitLens Pro trial has been reactivated! Experience all the new Pro features for another ${pluralize(
						'day',
						remaining ?? 0,
					)}.`,
					{ modal: true },
					confirm,
					learn,
				);

				if (result === learn) {
					void openUrl(urls.releaseNotes);
				}
			}
		} catch (ex) {
			scope?.error(ex);
			debugger;
		}
	}

	@debug()
	async referFriend(source: Source | undefined): Promise<void> {
		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent('subscription/action', { action: 'refer-friend' }, source);
		}

		await openUrl(await this.container.urls.getGkDevUrl(undefined, 'referral_portal=true'));
	}

	@gate(() => '')
	@debug()
	async resendVerification(source: Source | undefined): Promise<boolean> {
		if (this._subscription.account?.verified) return true;

		const scope = getScopedLogger();

		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent('subscription/action', { action: 'resend-verification' }, source);
		}
		void this.showAccountView(true);

		const session = await this.ensureSession(false, source);
		if (session == null) return false;

		try {
			const rsp = await this.connection.fetchGkApi(
				'resend-email',
				{
					method: 'POST',
					body: JSON.stringify({ id: session.account.id }),
				},
				{ token: session.accessToken },
			);

			if (!rsp.ok) {
				debugger;
				Logger.error(
					'',
					scope,
					`Unable to resend verification email; status=(${rsp.status}): ${rsp.statusText}`,
				);

				void window.showErrorMessage(`Unable to resend verification email; Status: ${rsp.statusText}`, 'OK');

				return false;
			}

			const confirm = { title: 'Recheck' };
			const cancel = { title: 'Cancel' };
			const result = await window.showInformationMessage(
				"Once you have verified your email address, click 'Recheck'.",
				confirm,
				cancel,
			);

			if (result === confirm) {
				await this.validate({ force: true }, source);
				return true;
			}
		} catch (ex) {
			scope?.error(ex);
			debugger;

			void window.showErrorMessage('Unable to resend verification email', 'OK');
		}

		return false;
	}

	private setProFeaturesVisibility(visible: boolean, source: Source | undefined) {
		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent(
				'subscription/action',
				{ action: 'visibility', visible: visible },
				source,
			);
		}

		void configuration.updateEffective('plusFeatures.enabled', visible);
	}

	@debug()
	async showAccountView(silent: boolean = false): Promise<void> {
		if (silent && !configuration.get('plusFeatures.enabled', undefined, true)) return;

		if (!this.container.views.home.visible) {
			await executeCommand('gitlens.showAccountView');
		}
	}

	@debug()
	private showPlans(source: Source | undefined): void {
		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent('subscription/action', { action: 'pricing' }, source);
		}

		void openUrl(urls.pricing);
	}

	@debug()
	async upgrade(plan: PaidSubscriptionPlanIds | undefined, source: Source | undefined): Promise<boolean> {
		const scope = getScopedLogger();

		if (!(await ensurePlusFeaturesEnabled())) return false;

		plan ??= 'pro';

		let aborted = false;
		const promo = await this.container.productConfig.getApplicablePromo(this._subscription.state, plan ?? 'pro');

		using telemetry = this.container.telemetry.enabled
			? createDisposable(
					() => {
						this.container.telemetry.sendEvent(
							'subscription/action',
							{
								action: 'upgrade',
								aborted: aborted,
								'promo.key': promo?.key,
								'promo.code': promo?.code,
							},
							source,
						);
					},
					{ once: true },
				)
			: undefined;

		const hasAccount = this._subscription.account != null;
		if (hasAccount) {
			// Do a pre-check-in to see if we've already upgraded to a paid plan
			try {
				const session = await this.ensureSession(false, source);
				if (session != null) {
					if (
						(await this.checkUpdatedSubscription(source)) === SubscriptionState.Paid &&
						compareSubscriptionPlans(this._subscription.plan.effective.id, plan) >= 0
					) {
						return true;
					}
				}
			} catch {}
		}

		const query = new URLSearchParams();
		query.set('product', 'gitlens');
		query.set('planType', getSubscriptionPlanType(plan));

		if (promo?.code != null) {
			query.set('promoCode', promo.code);
		}

		const activeOrgId = this._subscription.activeOrganization?.id;
		if (activeOrgId != null) {
			query.set('org', activeOrgId);
		}

		const context = getTrackingContextFromSource(source);
		if (context != null) {
			query.set('context', context);
		}

		try {
			if (hasAccount) {
				try {
					const token = await this.container.accountAuthentication.getExchangeToken(
						SubscriptionUpdatedUriPathPrefix,
					);
					query.set('token', token);
				} catch (ex) {
					scope?.error(ex);
				}
			}

			if (!query.has('token')) {
				const successUri = await env.asExternalUri(
					Uri.parse(`${env.uriScheme}://${this.container.context.extension.id}/${LoginUriPathPrefix}`),
				);
				query.set('success_uri', successUri.toString(true));
			}
		} catch (ex) {
			scope?.error(ex);
		}

		aborted = !(await openUrl(await this.container.urls.getGkDevUrl('purchase/checkout', query)));

		if (aborted) {
			return false;
		}

		telemetry?.dispose();

		const completionPromises = [new Promise<boolean>(resolve => setTimeout(resolve, 5 * 60 * 1000, false))];

		if (hasAccount) {
			completionPromises.push(
				new Promise<boolean>(resolve =>
					take(
						window.onDidChangeWindowState,
						2,
					)(e => {
						if (e.focused) {
							resolve(true);
						}
					}),
				),
				new Promise<boolean>(resolve =>
					once(this.container.uri.onDidReceiveSubscriptionUpdatedUri)(() => resolve(false)),
				),
			);
		} else {
			completionPromises.push(
				new Promise<boolean>(resolve => once(this.container.uri.onDidReceiveLoginUri)(() => resolve(false))),
			);
		}

		const refresh = await Promise.race(completionPromises);

		if (refresh) {
			void this.checkUpdatedSubscription(source);
		}

		return true;
	}

	@gate<SubscriptionService['validate']>(o => `${o?.force ?? false}`)
	@debug()
	async validate(options?: { force?: boolean }, source?: Source | undefined): Promise<void> {
		const scope = getScopedLogger();

		const session = await this.ensureSession(false, source);
		if (session == null) {
			this.changeSubscription(this._subscription, source);
			return;
		}

		try {
			await this.checkInAndValidate(session, source, options);
		} catch (ex) {
			scope?.error(ex);
			debugger;
		}
	}

	private _lastValidatedDate: Date | undefined;

	@trace({ args: session => ({ session: session?.account?.label }) })
	private async checkInAndValidate(
		session: AuthenticationSession,
		source: Source | undefined,
		options?: { force?: boolean; showSlowProgress?: boolean; organizationId?: string },
	): Promise<GKCheckInResponse | undefined> {
		const scope = getScopedLogger();

		// Only check in if we haven't in the last 12 hours
		if (
			!options?.force &&
			this._lastValidatedDate != null &&
			Date.now() - this._lastValidatedDate.getTime() < 12 * 60 * 60 * 1000 &&
			!isSubscriptionExpired(this._subscription)
		) {
			scope?.addExitInfo(fromNow(this._lastValidatedDate.getTime(), true), 'skipped');
			return;
		}

		const validating = this.checkInAndValidateCore(session, source, options?.organizationId, options?.force);
		if (!options?.showSlowProgress) return validating;

		// Show progress if we are waiting too long
		const result = await pauseOnCancelOrTimeout(validating, undefined, 3000);
		if (result.paused) {
			return window.withProgress(
				{ location: ProgressLocation.Notification, title: 'Validating your account...' },
				() => result.value,
			);
		}

		return result.value;
	}

	@gate<SubscriptionService['checkInAndValidateCore']>((s, _, orgId) => `${s.account.id}:${orgId}`)
	@trace({ args: session => ({ session: session?.account?.label }) })
	private async checkInAndValidateCore(
		session: AuthenticationSession,
		source: Source | undefined,
		organizationId?: string,
		force?: boolean,
	): Promise<GKCheckInResponse | undefined> {
		const scope = getScopedLogger();
		this._lastValidatedDate = undefined;

		try {
			const checkInData = {
				id: session.account.id,
				platform: getPlatform(),
				gitlensVersion: this.container.version,
				machineId: env.machineId,
				sessionId: env.sessionId,
				vscodeEdition: env.appName,
				vscodeHost: env.appHost,
				vscodeVersion: codeVersion,
			};

			const rsp = await this.connection.fetchGkApi(
				'gitlens/checkin',
				{
					method: 'POST',
					body: JSON.stringify(checkInData),
				},
				{ token: session.accessToken, organizationId: organizationId },
			);

			if (!rsp.ok) {
				this._getCheckInData = () => Promise.resolve(undefined);
				throw new AccountValidationError('Unable to validate account', undefined, rsp.status, rsp.statusText);
			}

			this._onDidCheckIn.fire({ force: force });

			const data: GKCheckInResponse = await rsp.json();
			this._getCheckInData = () => Promise.resolve(data);
			this.storeCheckInData(data);

			await this.validateAndUpdateSubscriptions(data, session, source);
			return data;
		} catch (ex) {
			this._getCheckInData = () => Promise.resolve(undefined);

			scope?.error(ex);
			debugger;

			// If we cannot check in, validate stored subscription
			this.changeSubscription(this._subscription, source);
			if (ex instanceof AccountValidationError) throw ex;

			throw new AccountValidationError('Unable to validate account', ex);
		} finally {
			this.startDailyValidationTimer();
		}
	}

	private startDailyValidationTimer(): void {
		if (this._validationTimer != null) {
			clearInterval(this._validationTimer);
		}

		// Check 4 times a day to ensure we validate at least once a day
		this._validationTimer = setInterval(
			() => {
				if (this._lastValidatedDate?.getDate() !== new Date().getDate()) {
					void this.ensureSession(false, undefined, { force: true });
				}
			},
			6 * 60 * 60 * 1000,
		);
	}

	private storeCheckInData(data: GKCheckInResponse): void {
		if (data.user?.id == null) return;

		void this.container.storage
			.store(`gk:${data.user.id}:checkin`, {
				v: 1,
				timestamp: Date.now(),
				data: data,
			})
			.catch();
	}

	@trace()
	private async loadStoredCheckInData(userId: string): Promise<GKCheckInResponse | undefined> {
		const scope = getScopedLogger();

		const storedCheckIn = this.container.storage.get(`gk:${userId}:checkin`);
		// If more than a day old, ignore
		if (storedCheckIn?.timestamp == null || Date.now() - storedCheckIn.timestamp > 24 * 60 * 60 * 1000) {
			// Attempt a check-in to see if we can get a new one
			const session = await this.getAuthenticationSession(false);
			if (session == null) return undefined;

			try {
				return await this.checkInAndValidate(session, undefined, { force: true });
			} catch (ex) {
				scope?.error(ex);
				return undefined;
			}
		}

		return storedCheckIn?.data;
	}

	@trace()
	private async validateAndUpdateSubscriptions(
		data: GKCheckInResponse,
		session: AuthenticationSession,
		source: Source | undefined,
	): Promise<void> {
		const scope = getScopedLogger();
		let organizations: Organization[];
		try {
			organizations =
				(await this.container.organizations.getOrganizations({
					force: true,
					accessToken: session.accessToken,
					userId: session.account.id,
				})) ?? [];
		} catch (ex) {
			scope?.error(ex);
			organizations = [];
		}
		let chosenOrganizationId = getConfiguredActiveOrganizationId();
		if (chosenOrganizationId === '') {
			chosenOrganizationId = undefined;
		} else if (chosenOrganizationId != null && !organizations.some(o => o.id === chosenOrganizationId)) {
			chosenOrganizationId = undefined;
			void updateActiveOrganizationId(undefined);
		}
		const subscription = getSubscriptionFromCheckIn(data, organizations, chosenOrganizationId);
		this._lastValidatedDate = new Date();
		this.changeSubscription(
			{
				...this._subscription,
				...subscription,
			},
			source,
			{ store: true },
		);
	}

	private _sessionPromise: Promise<AuthenticationSession | null> | undefined;
	private _session: AuthenticationSession | null | undefined;

	@gate()
	@trace()
	private async ensureSession(
		createIfNeeded: boolean,
		source: Source | undefined,
		options?: {
			force?: boolean;
			signUp?: boolean;
			signIn?: { code: string; state?: string };
			context?: TrackingContext;
		},
	): Promise<AuthenticationSession | undefined> {
		if (this._sessionPromise != null) {
			void (await this._sessionPromise);
		}

		if (!options?.force && this._session != null) return this._session;
		if (this._session === null && !createIfNeeded) return undefined;

		if (this._sessionPromise === undefined) {
			this._sessionPromise = this.getOrCreateSession(createIfNeeded, source, {
				signUp: options?.signUp,
				signIn: options?.signIn,
				context: options?.context,
			}).then(
				s => {
					this._session = s;
					this._sessionPromise = undefined;
					return this._session;
				},
				() => {
					this._session = null;
					this._sessionPromise = undefined;
					return this._session;
				},
			);
		}

		const session = await this._sessionPromise;
		return session ?? undefined;
	}

	@trace()
	private async getOrCreateSession(
		createIfNeeded: boolean,
		source: Source | undefined,
		options?: { signUp?: boolean; signIn?: { code: string; state?: string }; context?: TrackingContext },
	): Promise<AuthenticationSession | null> {
		const scope = getScopedLogger();

		let session: AuthenticationSession | null | undefined;
		try {
			if (options != null && createIfNeeded) {
				this.container.accountAuthentication.setOptionsForScopes(authenticationProviderScopes, options);
			}
			session = await this.container.accountAuthentication.getOrCreateSession(
				authenticationProviderScopes,
				createIfNeeded,
			);
		} catch (ex) {
			session = null;
			if (options != null && createIfNeeded) {
				this.container.accountAuthentication.clearOptionsForScopes(authenticationProviderScopes);
			}

			if (ex instanceof Error && ex.message.includes('User did not consent')) {
				scope?.addExitInfo('User declined authentication');
				await this.logoutCore(source);
				return null;
			}

			scope?.error(ex);
		}

		if (session == null) {
			scope?.addExitInfo('No valid session was found');
			await this.logoutCore(source);
			return session ?? null;
		}

		try {
			await this.checkInAndValidate(session, source, { showSlowProgress: createIfNeeded, force: createIfNeeded });
		} catch (ex) {
			scope?.error(ex);
			debugger;

			this.container.telemetry.sendEvent('account/validation/failed', {
				'account.id': session.account.id,
				exception: String(ex),
				code: ex.original?.code,
				statusCode: ex.statusCode,
			});

			scope?.addExitInfo(`Account validation failed (${ex.statusCode ?? ex.original?.code})`);
			scope?.setFailed('FAILED');

			if (ex instanceof AccountValidationError) {
				const name = session.account.label;

				// if (
				// 	(ex.statusCode != null && ex.statusCode < 500) ||
				// 	(ex.statusCode == null && (ex.original as any)?.code !== 'ENOTFOUND')
				// ) {
				if (
					(ex.original as any)?.code !== 'ENOTFOUND' &&
					ex.statusCode != null &&
					ex.statusCode < 500 &&
					ex.statusCode >= 400
				) {
					session = null;
					await this.logoutCore(source);

					if (createIfNeeded) {
						const unauthorized = ex.statusCode === 401;
						queueMicrotask(async () => {
							const confirm: MessageItem = { title: 'Retry Sign In' };
							const result = await window.showErrorMessage(
								`Unable to sign in to your (${name}) account. Please try again. If this issue persists, please contact support.${
									unauthorized ? '' : ` Error=${ex.message}`
								}`,
								confirm,
							);

							if (result === confirm) {
								void this.loginOrSignUp(false, {
									source: 'subscription',
									detail: {
										error: 'validation-failed',
										'error.message': ex.message,
									},
								});
							}
						});
					}
				} else {
					session = session ?? null;

					// if ((ex.original as any)?.code !== 'ENOTFOUND') {
					// 	void window.showErrorMessage(
					// 		`Unable to sign in to your (${name}) account right now. Please try again in a few minutes. If this issue persists, please contact support. Error=${ex.message}`,
					// 		'OK',
					// 	);
					// }
				}
			}
		}

		this.connection.resetRequestExceptionCount();
		return session;
	}

	@trace()
	private changeSubscription(
		subscription: Optional<Subscription, 'state'> | undefined,
		source: Source | undefined,
		options?: { silent?: boolean; store?: boolean },
	): void {
		subscription ??= {
			plan: {
				actual: getSubscriptionPlan('community', false, 0, undefined),
				effective: getSubscriptionPlan('community', false, 0, undefined),
			},
			account: undefined,
			state: SubscriptionState.Community,
		};

		// If the effective plan has expired, then replace it with the actual plan
		if (isSubscriptionExpired(subscription)) {
			subscription = {
				...subscription,
				plan: {
					...subscription.plan,
					effective: subscription.plan.actual,
				},
			};
		}

		subscription.state = computeSubscriptionState(subscription);
		assertSubscriptionState(subscription);

		void setContext('gitlens:promo', undefined);
		const promoPromise = this.container.productConfig
			.getApplicablePromo(subscription.state, getSubscriptionNextPaidPlanId(subscription))
			.catch(() => undefined);
		void promoPromise.then(promo => void setContext('gitlens:promo', promo?.key));

		const previous = this._subscription as typeof this._subscription | undefined; // Can be undefined here, since we call this in the constructor
		// Check the previous and new subscriptions are exactly the same
		const matches = previous != null && JSON.stringify(previous) === JSON.stringify(subscription);

		// If the previous and new subscriptions are exactly the same, kick out
		if (matches) {
			if (options?.store) {
				void this.storeSubscription(subscription).catch();
			}
			return;
		}

		queueMicrotask(async () => {
			let data = flattenSubscription(subscription, undefined, this.getFeaturePreviews(), await promoPromise);
			this.container.telemetry.setGlobalAttributes(data);

			data = {
				...data,
				...(!matches ? flattenSubscription(previous, 'previous') : {}),
			};

			this.container.telemetry.sendEvent(
				previous == null ? 'subscription' : 'subscription/changed',
				data,
				source,
			);
		});

		if (options?.store !== false) {
			void this.storeSubscription(subscription).catch();
		}

		this._subscription = subscription;
		this._etag = Date.now();

		if (!options?.silent) {
			this.updateContext();

			if (previous != null) {
				this._onDidChange.fire({ current: subscription, previous: previous, etag: this._etag });
			}
		}
	}

	private getStoredSubscription(): Subscription | undefined {
		const storedSubscription = this.container.storage.get('premium:subscription');

		let lastValidatedAt: number | undefined;
		let subscription: Subscription | undefined;
		if (storedSubscription?.data != null) {
			({ lastValidatedAt, ...subscription } = storedSubscription.data);
			this._lastValidatedDate = lastValidatedAt != null ? new Date(lastValidatedAt) : undefined;
		} else {
			subscription = undefined;
		}

		if (subscription != null) {
			// Migrate the plan names to the latest names
			(subscription.plan.actual as Mutable<Subscription['plan']['actual']>).name = getSubscriptionProductPlanName(
				subscription.plan.actual.id,
			);
			(subscription.plan.effective as Mutable<Subscription['plan']['effective']>).name =
				getSubscriptionProductPlanName(subscription.plan.effective.id);
		}

		return subscription;
	}

	private async storeSubscription(subscription: Subscription): Promise<void> {
		return this.container.storage.store('premium:subscription', {
			v: 1,
			data: { ...subscription, lastValidatedAt: this._lastValidatedDate?.getTime() },
		});
	}

	private getStoredFeaturePreview(feature: FeaturePreviews): FeaturePreview {
		return {
			feature: feature,
			usages: this.container.storage.get(`plus:preview:${feature}:usages`, []),
		};
	}

	private storeFeaturePreview(feature: FeaturePreviews, usages: StoredFeaturePreviewUsagePeriod[]): Promise<void> {
		return this.container.storage.store(`plus:preview:${feature}:usages`, usages);
	}

	private _cancellationSource: CancellationTokenSource | undefined;
	private _updateAccessContextDebounced: Deferrable<SubscriptionService['updateAccessContext']> | undefined;

	private updateContext(): void {
		this._updateAccessContextDebounced?.cancel();
		this._updateAccessContextDebounced ??= debounce(this.updateAccessContext.bind(this), 500);

		if (this._cancellationSource != null) {
			this._cancellationSource.cancel();
		}
		this._cancellationSource = new CancellationTokenSource();

		void this._updateAccessContextDebounced(this._cancellationSource.token);
		this.updateStatusBar();

		const {
			plan: { actual },
			state,
		} = this._subscription;

		void setContext('gitlens:plus', actual.id !== 'community' ? actual.id : undefined);
		void setContext('gitlens:plus:state', state);
	}

	private async updateAccessContext(cancellation: CancellationToken): Promise<void> {
		let allowed: boolean | 'mixed' = false;
		// For performance reasons, only check if we have any repositories
		if (this.container.git.repositoryCount !== 0) {
			({ allowed } = await this.container.git.access());
			if (cancellation.isCancellationRequested) return;
		}

		const plusEnabled = configuration.get('plusFeatures.enabled') ?? true;

		let disallowedRepos: string[] | undefined;

		if (!plusEnabled && allowed === 'mixed') {
			disallowedRepos = [];
			for (const repo of this.container.git.repositories) {
				if (repo.closed) continue;

				const access = await this.container.git.access(undefined, repo.uri);
				if (cancellation.isCancellationRequested) return;

				if (!access.allowed) {
					disallowedRepos.push(repo.uri.toString());
				}
			}
		}

		const plusDisabled = !plusEnabled && !allowed;
		void setContext('gitlens:plus:disabled', plusDisabled);
		void setContext('gitlens:plus:required', allowed === false);
		void setContext('gitlens:plus:disallowedRepos', disallowedRepos);

		if (!plusDisabled) {
			void setContext('gitlens:plus:disabled:view:overrides', undefined);
		}
	}

	private updateStatusBar(): void {
		const {
			account,
			plan: { effective },
		} = this._subscription;

		if (effective.id === 'community') {
			this._statusBarSubscription?.dispose();
			this._statusBarSubscription = undefined;
			return;
		}

		const trial = isSubscriptionTrial(this._subscription);
		const trialEligible = this._subscription.state === SubscriptionState.TrialReactivationEligible;

		if (!(trial || trialEligible) && account?.verified !== false) {
			this._statusBarSubscription?.dispose();
			this._statusBarSubscription = undefined;
			return;
		}

		this._statusBarSubscription ??= window.createStatusBarItem(
			'gitlens.plus.subscription',
			StatusBarAlignment.Right,
		);

		this._statusBarSubscription.name = 'GitLens Pro';
		this._statusBarSubscription.text = '$(gitlens-gitlens)';
		this._statusBarSubscription.command = 'gitlens.showAccountView' satisfies GlCommands;
		this._statusBarSubscription.backgroundColor = undefined;

		if (account?.verified === false) {
			this._statusBarSubscription.text = `$(gitlens-gitlens)\u00a0\u00a0$(warning)`;
			this._statusBarSubscription.backgroundColor = new ThemeColor(
				'statusBarItem.warningBackground' satisfies CoreColors,
			);
			this._statusBarSubscription.tooltip = new MarkdownString(
				trial
					? `**GitLens Pro — verify your email**\n\nYou must verify your email before you can start your **${effective.name}** trial.`
					: `**GitLens Pro — verify your email**\n\nYou must verify your email before you can unlock Pro features.`,
				true,
			);
		} else {
			let tooltip;
			if (trialEligible) {
				tooltip = `**GitLens Pro — reactivate your Pro trial**\n\nExperience full access to all the [new Pro features](${
					urls.releaseNotes
				}) — free for another ${pluralize('day', proTrialLengthInDays)}.`;
			} else if (trial) {
				const remaining = getSubscriptionTimeRemaining(this._subscription, 'days') ?? 0;
				tooltip = `**GitLens Pro — trial**\n\nYou now have full access to all GitLens Pro features for ${pluralize(
					'day',
					remaining,
					{ infix: ' more ' },
				)}.`;
			}

			this._statusBarSubscription.tooltip = new MarkdownString(tooltip, true);
		}

		this._statusBarSubscription.show();
	}

	@debug()
	async switchOrganization(source: Source | undefined): Promise<void> {
		const scope = getScopedLogger();
		if (this._session == null) return;

		let organizations;
		try {
			organizations = await this.container.organizations.getOrganizations();
		} catch (ex) {
			debugger;
			scope?.error(ex);
			return;
		}

		if (organizations == null || organizations.length === 0) return;

		// Show a quickpick to select the active organization
		const picks: { label: string; org: Organization | null }[] = organizations.map(org => ({
			label: org.name,
			org: org,
		}));

		const pick = await window.showQuickPick(picks, {
			title: 'Switch Organization',
			placeHolder: 'Choose an active organization for your account',
		});

		const currentActiveOrganization = this._subscription?.activeOrganization;
		if (pick?.org == null) {
			return;
		}

		if (pick.org.id === currentActiveOrganization?.id) {
			return;
		}

		try {
			await this.checkInAndValidate(this._session, source, { force: true, organizationId: pick.org.id });
		} catch (ex) {
			debugger;
			scope?.error(ex);
			return;
		}

		const checkInData = await this._getCheckInData();
		if (checkInData == null) return;

		const organizationSubscription = getSubscriptionFromCheckIn(checkInData, organizations, pick.org.id);

		if (getConfiguredActiveOrganizationId() !== pick.org.id) {
			await updateActiveOrganizationId(pick.org.id);
		}

		this.changeSubscription(
			{
				...this._subscription,
				...organizationSubscription,
			},
			source,
			{ store: true },
		);
	}

	@info()
	private onLoginUriReceived(uri: Uri): void {
		const scope = getScopedLogger();

		const queryParams = new URLSearchParams(uri.query);
		const code = queryParams.get('code');
		const state = queryParams.get('state');
		const context = queryParams.get('context');
		let contextMessage = 'sign in to GitKraken';

		switch (context) {
			case 'start_trial':
				contextMessage = 'start a Pro trial';
				break;
		}

		if (code == null) {
			scope?.error(undefined, `No code provided. Link: ${uri.toString(true)}`);
			void window.showErrorMessage(
				`Unable to ${contextMessage} with that link. Please try clicking the link again. If this issue persists, please contact support.`,
			);
			return;
		}

		void this.loginWithCode({ code: code, state: state ?? undefined }, { source: 'deeplink' });
	}

	async checkUpdatedSubscription(source: Source | undefined): Promise<SubscriptionState | undefined> {
		const scope = getScopedLogger();
		if (this._session == null) return undefined;
		const oldSubscriptionState = this._subscription.state;
		try {
			await this.checkInAndValidate(this._session, source, { force: true });
		} catch (ex) {
			debugger;
			scope?.error(ex);
			return undefined;
		}

		if (oldSubscriptionState !== this._subscription.state) {
			void this.showPlanMessage({ source: 'subscription' });
		}

		return this._subscription.state;
	}

	@debug()
	async aiAllAccessOptIn(source: Source | undefined): Promise<boolean> {
		const scope = getScopedLogger();

		if (!(await ensurePlusFeaturesEnabled())) return false;

		const hasAccount = this._session != null;

		const query = new URLSearchParams();
		query.set('product', 'gitlens');

		try {
			if (hasAccount) {
				try {
					const token =
						await this.container.accountAuthentication.getExchangeToken(AiAllAccessOptInPathPrefix);
					query.set('token', token);
				} catch (ex) {
					scope?.error(ex);
				}
			} else {
				const callbackUri = await env.asExternalUri(
					Uri.parse(
						`${env.uriScheme}://${this.container.context.extension.id}/${AiAllAccessOptInPathPrefix}`,
					),
				);
				query.set('redirect_uri', callbackUri.toString(true));
			}

			if (this.container.telemetry.enabled) {
				this.container.telemetry.sendEvent('aiAllAccess/opened', undefined, source);
			}

			if (!(await openUrl(await this.container.urls.getGkDevUrl('all-access', query)))) {
				return false;
			}
		} catch (ex) {
			scope?.error(ex);
			return false;
		}

		const completionPromises = [
			new Promise<string>(resolve => setTimeout(resolve, 5 * 60 * 1000, 'cancel')),
			new Promise<string>(resolve =>
				once(this.container.uri.onDidReceiveAiAllAccessOptInUri)(() =>
					resolve(hasAccount ? 'update' : 'login'),
				),
			),
		];

		const action = await Promise.race(completionPromises);

		if (action === 'update' && hasAccount) {
			void this.checkUpdatedSubscription(source);
			void this.container.storage
				.store(`gk:promo:${this._session?.account.id ?? '00000000'}:ai:allAccess:dismissed`, true)
				.catch();
			void this.container.views.home.refresh();
		}

		if (action !== 'cancel') {
			if (this.container.telemetry.enabled) {
				this.container.telemetry.sendEvent('aiAllAccess/optedIn', undefined, source);
			}

			return true;
		}

		return false;
	}

	private async onAiAllAccessOptInUri(uri: Uri): Promise<void> {
		const queryParams = new URLSearchParams(uri.query);
		const code = queryParams.get('code');

		if (code == null) return;

		// If we don't have an account and received a code, login with the code
		if (this._session == null) {
			await this.loginWithCode({ code: code }, { source: 'subscription' });
			const newSession = await this.getAuthenticationSession();
			if (newSession?.account?.id != null) {
				await this.container.storage
					.store(`gk:promo:${newSession.account.id}:ai:allAccess:dismissed`, true)
					.catch();
				void this.container.views.home.refresh();
			}
		}
	}
}

function flattenFeaturePreview(preview: FeaturePreview): FeaturePreviewEventData {
	const status = getFeaturePreviewStatus(preview);
	if (status === 'eligible') {
		return {
			feature: preview.feature,
			status: status,
		};
	}

	return {
		feature: preview.feature,
		status: status,
		day: preview.usages.length,
		startedOn: preview.usages[0].startedOn,
		...Object.fromEntries(
			preview.usages.map<EntriesType<FeaturePreviewDayEventData>>((d, i) => [
				`day.${i + 1}.startedOn`,
				d.startedOn,
			]),
		),
	};
}

function flattenSubscription(
	subscription: Optional<Subscription, 'state'> | undefined,
	prefix?: string,
	featurePreviews?: FeaturePreview[] | undefined,
	promo?: Promo | undefined,
): SubscriptionEventDataWithPrevious {
	if (subscription == null) return {};

	const flattenedFeaturePreviews = featurePreviews != null ? flattenSubscriptionFeaturePreviews(featurePreviews) : {};

	return {
		...flatten(subscription.account, `${prefix ? `${prefix}.` : ''}account`, {
			joinArrays: true,
			skipPaths: ['name', 'email'],
		}),
		...flatten(subscription.plan, `${prefix ? `${prefix}.` : ''}subscription`, {
			skipPaths: ['actual.name', 'effective.name'],
		}),
		'subscription.promo.key': promo?.key,
		'subscription.promo.code': promo?.code,
		'subscription.state': subscription.state,
		'subscription.stateString': getSubscriptionStateString(subscription.state),
		...flattenedFeaturePreviews,
	};
}

function flattenSubscriptionFeaturePreviews(previews: FeaturePreview[]): SubscriptionFeaturePreviewsEventData {
	const flattened: SubscriptionFeaturePreviewsEventData = Object.create(null);

	for (const fp of previews) {
		// Strip the `feature` property from the flattened object, since we put it in the key
		const { feature, ...props } = flattenFeaturePreview(fp);
		Object.assign(flattened, flatten(props, `subscription.featurePreviews.${fp.feature}`));
	}

	return flattened;
}

function getTrackingContextFromSource(source: Source | undefined): TrackingContext | undefined {
	switch (source?.source) {
		case 'deeplink':
			return source.detail === 'mcp' ? 'mcp' : undefined;
		case 'graph':
			return 'graph';
		case 'launchpad':
			return 'launchpad';
		case 'timeline':
			return 'visual_file_history';
		case 'quick-wizard':
			if (source.detail != null && typeof source.detail !== 'string' && 'action' in source.detail) {
				switch (source.detail.action) {
					case 'worktree':
						return 'worktrees';
					case 'launchpad':
						return 'launchpad';
				}
			}
			break;
		case 'worktrees':
			return 'worktrees';
	}

	return undefined;
}
