import { getPlatform } from '@env/platform';
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
import type { OpenWalkthroughCommandArgs } from '../../../commands/walkthroughs';
import { urls } from '../../../constants';
import type { CoreColors } from '../../../constants.colors';
import { GlCommand } from '../../../constants.commands';
import type { StoredFeaturePreviewUsagePeriod } from '../../../constants.storage';
import {
	proFeaturePreviewUsageDurationInDays,
	proFeaturePreviewUsages,
	proPreviewLengthInDays,
	proTrialLengthInDays,
	SubscriptionPlanId,
	SubscriptionState,
} from '../../../constants.subscription';
import type {
	FeaturePreviewActionEventData,
	FeaturePreviewDayEventData,
	FeaturePreviewEventData,
	Source,
	SubscriptionEventDataWithPrevious,
	SubscriptionFeaturePreviewsEventData,
	TrackingContext,
} from '../../../constants.telemetry';
import type { Container } from '../../../container';
import { AccountValidationError, RequestsAreBlockedTemporarilyError } from '../../../errors';
import type { FeaturePreview, FeaturePreviews } from '../../../features';
import { featurePreviews, getFeaturePreviewLabel, getFeaturePreviewStatus } from '../../../features';
import type { RepositoriesChangeEvent } from '../../../git/gitProviderService';
import { createFromDateDelta, fromNow } from '../../../system/date';
import { gate } from '../../../system/decorators/gate';
import { debug, log } from '../../../system/decorators/log';
import { take } from '../../../system/event';
import type { Deferrable } from '../../../system/function';
import { debounce, once } from '../../../system/function';
import { Logger } from '../../../system/logger';
import { getLogScope, setLogScopeExit } from '../../../system/logger.scope';
import { flatten } from '../../../system/object';
import { pauseOnCancelOrTimeout } from '../../../system/promise';
import { pluralize } from '../../../system/string';
import { satisfies } from '../../../system/version';
import { executeCommand, registerCommand } from '../../../system/vscode/command';
import { configuration } from '../../../system/vscode/configuration';
import { setContext } from '../../../system/vscode/context';
import { openUrl } from '../../../system/vscode/utils';
import type { GKCheckInResponse } from '../checkin';
import { getSubscriptionFromCheckIn } from '../checkin';
import type { ServerConnection } from '../serverConnection';
import { ensurePlusFeaturesEnabled } from '../utils';
import { LoginUriPathPrefix } from './authenticationConnection';
import { authenticationProviderScopes } from './authenticationProvider';
import type { Organization } from './organization';
import { getApplicablePromo } from './promos';
import type { Subscription } from './subscription';
import {
	assertSubscriptionState,
	computeSubscriptionState,
	getCommunitySubscription,
	getPreviewSubscription,
	getSubscriptionPlan,
	getSubscriptionPlanName,
	getSubscriptionStateString,
	getSubscriptionTimeRemaining,
	getTimeRemaining,
	isSubscriptionExpired,
	isSubscriptionInProTrial,
	isSubscriptionPaid,
	isSubscriptionTrial,
	SubscriptionUpdatedUriPathPrefix,
} from './subscription';

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

	private _onDidCheckIn = new EventEmitter<void>();
	get onDidCheckIn(): Event<void> {
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
		previousVersion: string | undefined,
	) {
		this._disposable = Disposable.from(
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
			container.uri.onDidReceiveLoginUri(this.onLoginUri, this),
		);

		const subscription = this.getStoredSubscription();
		this._getCheckInData = () => Promise.resolve(undefined);
		// Resets the preview trial state on the upgrade to 14.0
		if (subscription != null) {
			if (satisfies(previousVersion, '< 14.0')) {
				subscription.previewTrial = undefined;
			}

			if (subscription.account?.id != null) {
				this._getCheckInData = () => this.loadStoredCheckInData(subscription.account!.id);
			}
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
			void import(/* webpackChunkName: "__debug__" */ './__debug__accountDebug').then(m => {
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
			registerCommand(GlCommand.PlusLogin, (src?: Source) => this.loginOrSignUp(false, src)),
			registerCommand(GlCommand.PlusSignUp, (src?: Source) => this.loginOrSignUp(true, src)),
			registerCommand(GlCommand.PlusLogout, (src?: Source) => this.logout(src)),
			registerCommand(GlCommand.GKSwitchOrganization, (src?: Source) => this.switchOrganization(src)),

			registerCommand(GlCommand.PlusManage, (src?: Source) => this.manage(src)),
			registerCommand(GlCommand.PlusShowPlans, (src?: Source) => this.showPlans(src)),
			registerCommand(GlCommand.PlusStartPreviewTrial, (src?: Source) => this.startPreviewTrial(src)),
			registerCommand(GlCommand.PlusReactivateProTrial, (src?: Source) => this.reactivateProTrial(src)),
			registerCommand(GlCommand.PlusResendVerification, (src?: Source) => this.resendVerification(src)),
			registerCommand(GlCommand.PlusUpgrade, (src?: Source) => this.upgrade(src)),

			registerCommand(GlCommand.PlusHide, (src?: Source) => this.setProFeaturesVisibility(false, src)),
			registerCommand(GlCommand.PlusRestore, (src?: Source) => this.setProFeaturesVisibility(true, src)),

			registerCommand(GlCommand.PlusValidate, (src?: Source) => this.validate({ force: true }, src)),

			registerCommand(GlCommand.PlusContinueFeaturePreview, ({ feature }: { feature: FeaturePreviews }) =>
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
	@log()
	async continueFeaturePreview(feature: FeaturePreviews) {
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

	@debug()
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
				void executeCommand<OpenWalkthroughCommandArgs>(GlCommand.OpenWalkthrough, {
					...source,
					step: 'get-started-community',
				});
				break;
			case SubscriptionState.ProTrial:
			case SubscriptionState.ProPreview:
				void executeCommand<OpenWalkthroughCommandArgs>(GlCommand.OpenWalkthrough, {
					...source,
					step: 'welcome-in-trial',
				});
				break;
			case SubscriptionState.ProTrialReactivationEligible:
			case SubscriptionState.ProTrialExpired:
			case SubscriptionState.ProPreviewExpired:
				void executeCommand<OpenWalkthroughCommandArgs>(GlCommand.OpenWalkthrough, {
					...source,
					step: 'welcome-in-trial-expired',
				});
				break;
			case SubscriptionState.Paid:
				void executeCommand<OpenWalkthroughCommandArgs>(GlCommand.OpenWalkthrough, {
					...source,
					step: 'welcome-paid',
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
				void this.upgrade(source);
			} else if (result === learn) {
				void this.learnAboutPro({ source: 'prompt', detail: { action: 'trial-ended' } }, source);
			}
		}
	}

	@log()
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
			void this.showPlanMessage(options?.source);
		}
		return loggedIn;
	}

	@log()
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

	@log()
	async manage(source: Source | undefined): Promise<void> {
		const scope = getLogScope();
		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent('subscription/action', { action: 'manage' }, source);
		}

		try {
			const exchangeToken = await this.container.accountAuthentication.getExchangeToken();
			await openUrl(this.container.getGkDevUri('account', `token=${exchangeToken}`).toString(true));
		} catch (ex) {
			Logger.error(ex, scope);
			await openUrl(this.container.getGkDevUri('account').toString(true));
		}
	}

	@gate(() => '')
	@log()
	async reactivateProTrial(source: Source | undefined): Promise<void> {
		if (!(await ensurePlusFeaturesEnabled())) return;
		const scope = getLogScope();

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
			Logger.error(ex, scope);
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
			Logger.error(ex, scope);
			debugger;
		}
	}

	@gate(() => '')
	@log()
	async resendVerification(source: Source | undefined): Promise<boolean> {
		if (this._subscription.account?.verified) return true;

		const scope = getLogScope();

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
			Logger.error(ex, scope);
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

	@log()
	async showAccountView(silent: boolean = false): Promise<void> {
		if (silent && !configuration.get('plusFeatures.enabled', undefined, true)) return;

		if (!this.container.views.home.visible) {
			await executeCommand(GlCommand.ShowAccountView);
		}
	}

	private showPlans(source: Source | undefined): void {
		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent('subscription/action', { action: 'pricing' }, source);
		}

		void openUrl(urls.pricing);
	}

	@gate(() => '')
	@log()
	async startPreviewTrial(source: Source | undefined): Promise<void> {
		if (!(await ensurePlusFeaturesEnabled())) return;

		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent('subscription/action', { action: 'start-preview-trial' }, source);
		}

		const { plan, previewTrial } = this._subscription;
		if (previewTrial != null) {
			void this.showAccountView();

			if (plan.effective.id === SubscriptionPlanId.Community) {
				const signUp: MessageItem = { title: 'Try GitLens Pro' };
				const signIn: MessageItem = { title: 'Sign In' };
				const cancel: MessageItem = { title: 'Cancel', isCloseAffordance: true };
				const result = await window.showInformationMessage(
					`Do you want to start your free ${proTrialLengthInDays}-day Pro trial for full access to all GitLens Pro features?`,
					{ modal: true },
					signUp,
					signIn,
					cancel,
				);

				if (result === signUp || result === signIn) {
					void this.loginOrSignUp(result === signUp, source);
				}
			}

			return;
		}

		// Don't overwrite a trial that is already in progress
		if (isSubscriptionInProTrial(this._subscription)) return;

		const days = proPreviewLengthInDays;
		const subscription = getPreviewSubscription(days, this._subscription);
		this.changeSubscription(subscription, source);

		setTimeout(async () => {
			const confirm: MessageItem = { title: 'Continue' };
			const learn: MessageItem = { title: 'Learn More' };
			const result = await window.showInformationMessage(
				`You can now preview local Pro features for ${
					days < 1 ? '1 day' : pluralize('day', days)
				}, or for full access to all GitLens Pro features, [start your free ${proTrialLengthInDays}-day Pro trial](command:gitlens.plus.signUp "Try GitLens Pro") — no credit card required.`,
				confirm,
				learn,
			);

			if (result === learn) {
				void this.learnAboutPro({ source: 'notification', detail: { action: 'preview-started' } }, source);
			}
		}, 1);
	}

	@log()
	async upgrade(source: Source | undefined): Promise<void> {
		const scope = getLogScope();

		if (!(await ensurePlusFeaturesEnabled())) return;

		if (this.container.telemetry.enabled) {
			this.container.telemetry.sendEvent('subscription/action', { action: 'upgrade' }, source);
		}

		if (this._subscription.account != null) {
			// Do a pre-check-in to see if we've already upgraded to a paid plan.
			try {
				const session = await this.ensureSession(false, source);
				if (session != null) {
					if ((await this.checkUpdatedSubscription(source)) === SubscriptionState.Paid) {
						return;
					}
				}
			} catch {}
		}

		const query = new URLSearchParams();
		query.set('source', 'gitlens');
		query.set('product', 'gitlens');

		const hasAccount = this._subscription.account != null;

		const promoCode = getApplicablePromo(this._subscription.state)?.code;
		if (promoCode != null) {
			query.set('promoCode', promoCode);
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
				const token = await this.container.accountAuthentication.getExchangeToken(
					SubscriptionUpdatedUriPathPrefix,
				);
				query.set('token', token);
			} else {
				const successUri = await env.asExternalUri(
					Uri.parse(`${env.uriScheme}://${this.container.context.extension.id}/${LoginUriPathPrefix}`),
				);
				query.set('success_uri', successUri.toString(true));
			}

			if (!(await openUrl(this.container.getGkDevUri('purchase/checkout', query.toString()).toString(true)))) {
				return;
			}
		} catch (ex) {
			Logger.error(ex, scope);
			if (!(await openUrl(this.container.getGkDevUri('purchase/checkout', query.toString()).toString(true)))) {
				return;
			}
		}

		const completionPromises = [new Promise<boolean>(resolve => setTimeout(() => resolve(false), 5 * 60 * 1000))];

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
	}

	@gate<SubscriptionService['validate']>(o => `${o?.force ?? false}`)
	@log()
	async validate(options?: { force?: boolean }, source?: Source | undefined): Promise<void> {
		const scope = getLogScope();

		const session = await this.ensureSession(false, source);
		if (session == null) {
			this.changeSubscription(this._subscription, source);
			return;
		}

		try {
			await this.checkInAndValidate(session, source, options);
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;
		}
	}

	private _lastValidatedDate: Date | undefined;

	@debug<SubscriptionService['checkInAndValidate']>({ args: { 0: s => s?.account?.label } })
	private async checkInAndValidate(
		session: AuthenticationSession,
		source: Source | undefined,
		options?: { force?: boolean; showSlowProgress?: boolean; organizationId?: string },
	): Promise<GKCheckInResponse | undefined> {
		const scope = getLogScope();

		// Only check in if we haven't in the last 12 hours
		if (
			!options?.force &&
			this._lastValidatedDate != null &&
			Date.now() - this._lastValidatedDate.getTime() < 12 * 60 * 60 * 1000 &&
			!isSubscriptionExpired(this._subscription)
		) {
			setLogScopeExit(scope, ` (${fromNow(this._lastValidatedDate.getTime(), true)})...`, 'skipped');
			return;
		}

		const validating = this.checkInAndValidateCore(session, source, options?.organizationId);
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

	@gate<SubscriptionService['checkInAndValidateCore']>(s => s.account.id)
	@debug<SubscriptionService['checkInAndValidateCore']>({ args: { 0: s => s?.account?.label } })
	private async checkInAndValidateCore(
		session: AuthenticationSession,
		source: Source | undefined,
		organizationId?: string,
	): Promise<GKCheckInResponse | undefined> {
		const scope = getLogScope();
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
				previewStartedOn: this._subscription.previewTrial?.startedOn,
				previewExpiresOn: this._subscription.previewTrial?.expiresOn,
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

			this._onDidCheckIn.fire();

			const data: GKCheckInResponse = await rsp.json();
			this._getCheckInData = () => Promise.resolve(data);
			this.storeCheckInData(data);

			await this.validateAndUpdateSubscriptions(data, session, source);
			return data;
		} catch (ex) {
			this._getCheckInData = () => Promise.resolve(undefined);

			Logger.error(ex, scope);
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
				if (this._lastValidatedDate == null || this._lastValidatedDate.getDate() !== new Date().getDate()) {
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

	private async loadStoredCheckInData(userId: string): Promise<GKCheckInResponse | undefined> {
		const scope = getLogScope();
		const storedCheckIn = this.container.storage.get(`gk:${userId}:checkin`);
		// If more than a day old, ignore
		if (storedCheckIn?.timestamp == null || Date.now() - storedCheckIn.timestamp > 24 * 60 * 60 * 1000) {
			// Attempt a check-in to see if we can get a new one
			const session = await this.getAuthenticationSession(false);
			if (session == null) return undefined;

			try {
				return await this.checkInAndValidate(session, undefined, { force: true });
			} catch (ex) {
				Logger.error(ex, scope);
				return undefined;
			}
		}

		return storedCheckIn?.data;
	}

	@debug()
	private async validateAndUpdateSubscriptions(
		data: GKCheckInResponse,
		session: AuthenticationSession,
		source: Source | undefined,
	): Promise<void> {
		const scope = getLogScope();
		let organizations: Organization[];
		try {
			organizations =
				(await this.container.organizations.getOrganizations({
					force: true,
					accessToken: session.accessToken,
					userId: session.account.id,
				})) ?? [];
		} catch (ex) {
			Logger.error(ex, scope);
			organizations = [];
		}
		let chosenOrganizationId: string | undefined = configuration.get('gitKraken.activeOrganizationId') ?? undefined;
		if (chosenOrganizationId === '') {
			chosenOrganizationId = undefined;
		} else if (chosenOrganizationId != null && !organizations.some(o => o.id === chosenOrganizationId)) {
			chosenOrganizationId = undefined;
			void configuration.updateEffective('gitKraken.activeOrganizationId', undefined);
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
	@debug()
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

	@debug()
	private async getOrCreateSession(
		createIfNeeded: boolean,
		source: Source | undefined,
		options?: { signUp?: boolean; signIn?: { code: string; state?: string }; context?: TrackingContext },
	): Promise<AuthenticationSession | null> {
		const scope = getLogScope();

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
				setLogScopeExit(scope, ' \u2022 User declined authentication');
				await this.logoutCore(source);
				return null;
			}

			Logger.error(ex, scope);
		}

		if (session == null) {
			setLogScopeExit(scope, ' \u2022 No valid session was found');
			await this.logoutCore(source);
			return session ?? null;
		}

		try {
			await this.checkInAndValidate(session, source, { showSlowProgress: createIfNeeded, force: createIfNeeded });
		} catch (ex) {
			Logger.error(ex, scope);
			debugger;

			this.container.telemetry.sendEvent('account/validation/failed', {
				'account.id': session.account.id,
				exception: String(ex),
				code: ex.original?.code,
				statusCode: ex.statusCode,
			});

			setLogScopeExit(
				scope,
				` \u2022 Account validation failed (${ex.statusCode ?? ex.original?.code})`,
				'FAILED',
			);

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

	@debug()
	private changeSubscription(
		subscription: Optional<Subscription, 'state'> | undefined,
		source: Source | undefined,
		options?: { silent?: boolean; store?: boolean },
	): void {
		if (subscription == null) {
			subscription = {
				plan: {
					actual: getSubscriptionPlan(SubscriptionPlanId.Community, false, 0, undefined),
					effective: getSubscriptionPlan(SubscriptionPlanId.Community, false, 0, undefined),
				},
				account: undefined,
				state: SubscriptionState.Community,
			};
		}

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

		// If we don't have a paid plan (or a non-preview trial), check if the preview trial has expired, if not apply it
		if (
			!isSubscriptionPaid(subscription) &&
			subscription.previewTrial != null &&
			(getTimeRemaining(subscription.previewTrial.expiresOn) ?? 0) > 0
		) {
			subscription = {
				...subscription,
				plan: {
					...subscription.plan,
					effective: getSubscriptionPlan(
						SubscriptionPlanId.Pro,
						false,
						0,
						undefined,
						new Date(subscription.previewTrial.startedOn),
						new Date(subscription.previewTrial.expiresOn),
					),
				},
			};
		}

		subscription.state = computeSubscriptionState(subscription);
		assertSubscriptionState(subscription);

		const promo = getApplicablePromo(subscription.state);
		void setContext('gitlens:promo', promo?.key);

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

		queueMicrotask(() => {
			let data = flattenSubscription(subscription, undefined, this.getFeaturePreviews());
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
			(subscription.plan.actual as Mutable<Subscription['plan']['actual']>).name = getSubscriptionPlanName(
				subscription.plan.actual.id,
			);
			(subscription.plan.effective as Mutable<Subscription['plan']['effective']>).name = getSubscriptionPlanName(
				subscription.plan.effective.id,
			);
			// Deprecate (expire) the preview trial
			if (
				subscription.previewTrial?.expiresOn == null ||
				new Date(subscription.previewTrial.expiresOn) >= new Date()
			) {
				subscription.previewTrial = {
					startedOn: subscription.previewTrial?.startedOn ?? new Date(0).toISOString(),
					...subscription.previewTrial,
					expiresOn: new Date(0).toISOString(),
				};
			}
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
		if (this._updateAccessContextDebounced == null) {
			this._updateAccessContextDebounced = debounce(this.updateAccessContext.bind(this), 500);
		}

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

		void setContext('gitlens:plus', actual.id !== SubscriptionPlanId.Community ? actual.id : undefined);
		void setContext('gitlens:plus:state', state);
	}

	private async updateAccessContext(cancellation: CancellationToken): Promise<void> {
		let allowed: boolean | 'mixed' = false;
		// For performance reasons, only check if we have any repositories
		if (this.container.git.repositoryCount !== 0) {
			({ allowed } = await this.container.git.access());
			if (cancellation.isCancellationRequested) return;
		}

		const plusFeatures = configuration.get('plusFeatures.enabled') ?? true;

		let disallowedRepos: string[] | undefined;

		if (!plusFeatures && allowed === 'mixed') {
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

		void setContext('gitlens:plus:enabled', Boolean(allowed) || plusFeatures);
		void setContext('gitlens:plus:required', allowed === false);
		void setContext('gitlens:plus:disallowedRepos', disallowedRepos);
	}

	private updateStatusBar(): void {
		const {
			account,
			plan: { effective },
		} = this._subscription;

		if (effective.id === SubscriptionPlanId.Community) {
			this._statusBarSubscription?.dispose();
			this._statusBarSubscription = undefined;
			return;
		}

		const trial = isSubscriptionTrial(this._subscription);
		const trialEligible = this._subscription.state === SubscriptionState.ProTrialReactivationEligible;

		if (!(trial || trialEligible) && account?.verified !== false) {
			this._statusBarSubscription?.dispose();
			this._statusBarSubscription = undefined;
			return;
		}

		if (this._statusBarSubscription == null) {
			this._statusBarSubscription = window.createStatusBarItem(
				'gitlens.plus.subscription',
				StatusBarAlignment.Right,
			);
		}

		this._statusBarSubscription.name = 'GitLens Pro';
		this._statusBarSubscription.text = '$(gitlens-gitlens)';
		this._statusBarSubscription.command = GlCommand.ShowAccountView;
		this._statusBarSubscription.backgroundColor = undefined;

		if (account?.verified === false) {
			this._statusBarSubscription.text = `$(gitlens-gitlens)\u00a0\u00a0$(warning)`;
			this._statusBarSubscription.backgroundColor = new ThemeColor(
				'statusBarItem.warningBackground' satisfies CoreColors,
			);
			this._statusBarSubscription.tooltip = new MarkdownString(
				trial
					? `**GitLens Pro — verify your email**\n\nYou must verify your email before you can start your **${effective.name}** trial.`
					: `**GitLens Pro — verify your email**\n\nYou must verify your email before you can use Pro features on privately-hosted repos.`,
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

	async switchOrganization(source: Source | undefined): Promise<void> {
		const scope = getLogScope();
		if (this._session == null) return;

		let organizations;
		try {
			organizations = await this.container.organizations.getOrganizations();
		} catch (ex) {
			debugger;
			Logger.error(ex, scope);
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
			placeHolder: 'Select the active organization for your account',
		});

		const currentActiveOrganization = this._subscription?.activeOrganization;
		if (pick?.org == null) {
			return;
		}

		if (currentActiveOrganization != null && pick.org.id === currentActiveOrganization.id) {
			return;
		}

		await this.checkInAndValidate(this._session, source, { force: true, organizationId: pick.org.id });
		const checkInData = await this._getCheckInData();
		if (checkInData == null) return;

		const organizationSubscription = getSubscriptionFromCheckIn(checkInData, organizations, pick.org.id);

		if (configuration.get('gitKraken.activeOrganizationId') !== pick.org.id) {
			await configuration.updateEffective('gitKraken.activeOrganizationId', pick.org.id);
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

	onLoginUri(uri: Uri) {
		const scope = getLogScope();
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
			Logger.error(undefined, scope, `No code provided. Link: ${uri.toString(true)}`);
			void window.showErrorMessage(
				`Unable to ${contextMessage} with that link. Please try clicking the link again. If this issue persists, please contact support.`,
			);
			return;
		}

		void this.loginWithCode({ code: code, state: state ?? undefined }, { source: 'deeplink' });
	}

	async checkUpdatedSubscription(source: Source | undefined): Promise<SubscriptionState | undefined> {
		if (this._session == null) return undefined;
		const oldSubscriptionState = this._subscription.state;
		await this.checkInAndValidate(this._session, source, { force: true });
		if (oldSubscriptionState !== this._subscription.state) {
			void this.showPlanMessage({ source: 'subscription' });
		}

		return this._subscription.state;
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
): SubscriptionEventDataWithPrevious {
	if (subscription == null) return {};

	let state = subscription.state;
	// Normalize preview states to community since we deprecated the preview
	if (state === SubscriptionState.ProPreview || state === SubscriptionState.ProPreviewExpired) {
		state = SubscriptionState.Community;
	}

	const flattenedFeaturePreviews = featurePreviews != null ? flattenSubscriptionFeaturePreviews(featurePreviews) : {};

	return {
		...flatten(subscription.account, `${prefix ? `${prefix}.` : ''}account`, {
			joinArrays: true,
			skipPaths: ['name', 'email'],
		}),
		...flatten(subscription.plan, `${prefix ? `${prefix}.` : ''}subscription`, {
			skipPaths: ['actual.name', 'effective.name'],
		}),
		...flatten(subscription.previewTrial, `${prefix ? `${prefix}.` : ''}subscription.previewTrial`, {
			skipPaths: ['actual.name', 'effective.name'],
		}),
		'subscription.state': state,
		'subscription.stateString': getSubscriptionStateString(state),
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
