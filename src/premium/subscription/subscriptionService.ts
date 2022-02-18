import {
	authentication,
	AuthenticationSession,
	version as codeVersion,
	commands,
	Disposable,
	env,
	Event,
	EventEmitter,
	MarkdownString,
	StatusBarAlignment,
	StatusBarItem,
	Uri,
	window,
} from 'vscode';
import { fetch } from '@env/fetch';
import { getPlatform } from '@env/platform';
import { Commands, ContextKeys } from '../../constants';
import type { Container } from '../../container';
import { setContext } from '../../context';
import { AccountValidationError } from '../../errors';
import { RepositoriesChangeEvent } from '../../git/gitProviderService';
import { Logger } from '../../logger';
import { StorageKeys, WorkspaceStorageKeys } from '../../storage';
import {
	computeSubscriptionState,
	getSubscriptionPlan,
	getSubscriptionPlanPriority,
	getSubscriptionTimeRemaining,
	getTimeRemaining,
	isPaidSubscriptionPlan,
	isSubscriptionExpired,
	isSubscriptionTrial,
	Subscription,
	SubscriptionPlanId,
	SubscriptionState,
} from '../../subscription';
import { executeCommand } from '../../system/command';
import { createFromDateDelta } from '../../system/date';
import { gate } from '../../system/decorators/gate';
import { debug, log } from '../../system/decorators/log';
import { memoize } from '../../system/decorators/memoize';
import { pluralize } from '../../system/string';

// TODO: What user-agent should we use?
const userAgent = 'Visual-Studio-Code-GitLens';

export interface SubscriptionChangeEvent {
	readonly current: Subscription;
	readonly previous: Subscription;
}

export class SubscriptionService implements Disposable {
	private static authenticationProviderId = 'gitkraken';
	private static authenticationScopes = ['gitlens'];

	private _onDidChange = new EventEmitter<SubscriptionChangeEvent>();
	get onDidChange(): Event<SubscriptionChangeEvent> {
		return this._onDidChange.event;
	}

	private _disposable: Disposable;
	private _subscription!: Subscription;
	private _statusBarSubscription: StatusBarItem | undefined;

	constructor(private readonly container: Container) {
		this._disposable = this.container.onReady(this.onReady, this);

		this.changeSubscription(this.getStoredSubscription(), true);
		setTimeout(() => void this.ensureSession(false), 10000);
	}

	dispose(): void {
		this._statusBarSubscription?.dispose();

		this._disposable.dispose();
	}

	@memoize()
	private get baseApiUri(): Uri {
		const { env } = this.container;
		if (env === 'staging') {
			return Uri.parse('https://stagingapi.gitkraken.com');
		}

		if (env === 'dev' || this.container.debugging) {
			return Uri.parse('https://devapi.gitkraken.com');
		}

		return Uri.parse('https://api.gitkraken.com');
	}

	@memoize()
	private get baseAccountUri(): Uri {
		const { env } = this.container;
		if (env === 'staging') {
			return Uri.parse('https://stagingaccount.gitkraken.com');
		}

		if (env === 'dev' || this.container.debugging) {
			return Uri.parse('https://devaccount.gitkraken.com');
		}

		return Uri.parse('https://account.gitkraken.com');
	}

	@memoize()
	private get baseSiteUri(): Uri {
		const { env } = this.container;
		if (env === 'staging') {
			return Uri.parse('https://staging.gitkraken.com');
		}

		if (env === 'dev' || this.container.debugging) {
			return Uri.parse('https://dev.gitkraken.com');
		}

		return Uri.parse('https://gitkraken.com');
	}

	private get connectedKey(): `${WorkspaceStorageKeys.ConnectedPrefix}${string}` {
		return `${WorkspaceStorageKeys.ConnectedPrefix}gitkraken`;
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
	}

	private onRepositoriesChanged(_e: RepositoriesChangeEvent): void {
		this.updateContext();
	}

	private registerCommands(): Disposable[] {
		void this.container.viewCommands;

		return [
			commands.registerCommand('gitlens.premium.login', () => this.loginOrSignUp()),
			commands.registerCommand('gitlens.premium.loginOrSignUp', () => this.loginOrSignUp()),
			commands.registerCommand('gitlens.premium.signUp', () => this.loginOrSignUp()),
			commands.registerCommand('gitlens.premium.logout', () => this.logout()),

			commands.registerCommand('gitlens.premium.startPreview', () => this.startPreview()),
			commands.registerCommand('gitlens.premium.purchase', () => this.purchase()),
			commands.registerCommand('gitlens.premium.reset', () => this.logout(true)),

			commands.registerCommand('gitlens.premium.resendVerification', () => this.resendVerification()),
			commands.registerCommand('gitlens.premium.validate', () => this.validate()),

			commands.registerCommand('gitlens.premium.showPlans', () => this.showPlans()),
		];
	}

	async getSubscription(): Promise<Subscription> {
		void (await this.ensureSession(false));
		return this._subscription;
	}

	@gate()
	@log()
	async loginOrSignUp(): Promise<boolean> {
		void this.showHomeView();

		await this.container.storage.deleteWorkspace(this.connectedKey);

		const session = await this.ensureSession(true);
		const loggedIn = Boolean(session);
		if (loggedIn) {
			const {
				account,
				plan: { actual, effective },
			} = this._subscription;

			if (account?.verified === false) {
				const confirm = { title: 'Resend Verification' };
				const cancel = { title: 'Cancel' };
				const result = await window.showInformationMessage(
					`Before you can access your ${actual.name} account, you must verify your email address.`,
					confirm,
					cancel,
				);

				if (result === confirm) {
					void this.resendVerification();
				}
			} else if (isSubscriptionTrial(this._subscription)) {
				const remaining = getSubscriptionTimeRemaining(this._subscription, 'days');
				void window.showInformationMessage(
					`You are now signed in to your ${actual.name} account. There are ${pluralize(
						'day',
						remaining ?? 0,
					)} remaining in your ${
						effective.name
					} trial which grants you access to premium features for private repos.`,
					'OK',
				);
			} else {
				void window.showInformationMessage(`You are now signed in to your ${actual.name} account.`, 'OK');
			}
		}
		return loggedIn;
	}

	@gate()
	@log()
	logout(reset: boolean = false): void {
		this._sessionPromise = undefined;
		this._session = undefined;
		void this.container.storage.storeWorkspace(this.connectedKey, false);

		// TODO@eamodio remove this before release
		if (reset && this.container.env === 'dev') {
			this.changeSubscription(undefined);
		}

		this.changeSubscription({
			...this._subscription,
			plan: {
				actual: getSubscriptionPlan(SubscriptionPlanId.Free),
				effective: getSubscriptionPlan(SubscriptionPlanId.Free),
			},
			account: undefined,
		});
	}

	@log()
	async purchase(): Promise<void> {
		void this.showPlans();
		await this.showHomeView();
	}

	@gate()
	@log()
	async resendVerification(): Promise<void> {
		if (this._subscription.account?.verified) return;

		void this.showHomeView();

		const session = await this.ensureSession(false);
		if (session == null) return;

		const rsp = await fetch(Uri.joinPath(this.baseApiUri, 'resend-email').toString(), {
			method: 'POST',
			headers: {
				Authorization: `Bearer ${session.accessToken}`,
				'User-Agent': userAgent,
			},
			body: JSON.stringify({ id: session.account.id }),
		});

		if (!rsp.ok) {
			debugger;
			return;
		}

		const confirm = { title: 'Recheck' };
		const cancel = { title: 'Cancel' };
		const result = await window.showInformationMessage(
			"Once you have verified your email address, click 'Recheck'.",
			confirm,
			cancel,
		);
		if (result === confirm) {
			await this.validate();
		}
	}

	@log()
	async showHomeView(): Promise<void> {
		if (!this.container.homeWebviewView.visible) {
			await executeCommand(Commands.ShowHomeView);
		}
	}

	private showPlans(): void {
		void env.openExternal(Uri.joinPath(this.baseSiteUri, 'gitlens/pricing'));
	}

	@gate()
	@log()
	async startPreview(): Promise<void> {
		let { plan, preview } = this._subscription;
		if (preview != null || plan.effective.id !== SubscriptionPlanId.Free) {
			if (plan.effective.id === SubscriptionPlanId.Free) {
				const confirm = { title: 'Extend Trial' };
				const cancel = { title: 'Cancel' };
				const result = await window.showInformationMessage(
					'Your premium feature trial has expired. Please create a free account to extend your trial.',
					confirm,
					cancel,
				);

				if (result === confirm) {
					void this.loginOrSignUp();
				}
			}
			return;
		}

		const startedOn = new Date();

		let days;
		let expiresOn = new Date(startedOn);
		if (!this.container.debugging && this.container.env !== 'dev') {
			// Normalize the date to just before midnight on the same day
			expiresOn.setHours(23, 59, 59, 999);
			expiresOn = createFromDateDelta(expiresOn, { days: 3 });
			days = 3;
		} else {
			expiresOn = createFromDateDelta(expiresOn, { minutes: 1 });
			days = 0;
		}

		preview = {
			startedOn: startedOn.toISOString(),
			expiresOn: expiresOn.toISOString(),
		};

		this.changeSubscription({
			...this._subscription,
			plan: {
				...this._subscription.plan,
				effective: getSubscriptionPlan(SubscriptionPlanId.Pro, startedOn, expiresOn),
			},
			preview: preview,
		});

		void window.showInformationMessage(`You can now try premium GitLens features for ${days} days.`);
	}

	@gate()
	@log()
	async validate(): Promise<void> {
		const cc = Logger.getCorrelationContext();

		const session = await this.ensureSession(false);
		if (session == null) return;

		try {
			await this.checkInAndValidate(session);
		} catch (ex) {
			Logger.error(ex, cc);
			debugger;
		}
	}

	private async checkInAndValidate(session: AuthenticationSession): Promise<void> {
		try {
			const checkInData = {
				id: session.account.id,
				platform: getPlatform(),
				gitlensVersion: this.container.version,
				vscodeEdition: env.appName,
				vscodeHost: env.appHost,
				vscodeVersion: codeVersion,
				previewStartedOn: this._subscription.preview?.startedOn,
				previewExpiresOn: this._subscription.preview?.expiresOn,
			};

			const rsp = await fetch(Uri.joinPath(this.baseApiUri, 'gitlens/checkin').toString(), {
				method: 'POST',
				headers: {
					Authorization: `Bearer ${session.accessToken}`,
					'User-Agent': userAgent,
				},
				body: JSON.stringify(checkInData),
			});

			if (!rsp.ok) {
				throw new AccountValidationError('Unable to validate account', undefined, rsp.status, rsp.statusText);
			}

			const data: GKLicenseInfo = await rsp.json();
			this.validateSubscription(data);
		} catch (ex) {
			Logger.error(ex);
			debugger;
			if (ex instanceof AccountValidationError) throw ex;

			throw new AccountValidationError('Unable to validate account', ex);
		}
	}

	@debug()
	private validateSubscription(data: GKLicenseInfo) {
		const account: Subscription['account'] = {
			id: data.user.id,
			name: data.user.name,
			email: data.user.email,
			verified: data.user.status === 'activated',
		};

		const effectiveLicenses = Object.entries(data.licenses.effectiveLicenses) as [GKLicenseType, GKLicense][];
		const paidLicenses = Object.entries(data.licenses.paidLicenses) as [GKLicenseType, GKLicense][];

		let actual: Subscription['plan']['actual'] | undefined;
		if (paidLicenses.length > 0) {
			paidLicenses.sort(
				(a, b) =>
					licenseStatusPriority(b[1].latestStatus) - licenseStatusPriority(a[1].latestStatus) ||
					getSubscriptionPlanPriority(convertLicenseTypeToPlanId(b[0])) -
						getSubscriptionPlanPriority(convertLicenseTypeToPlanId(a[0])),
			);

			const [licenseType, license] = paidLicenses[0];
			actual = getSubscriptionPlan(
				convertLicenseTypeToPlanId(licenseType),
				new Date(license.latestStartDate),
				new Date(license.latestEndDate),
			);
		}

		if (actual == null) {
			actual = getSubscriptionPlan(
				SubscriptionPlanId.FreePlus,
				data.user.firstGitLensCheckIn != null ? new Date(data.user.firstGitLensCheckIn) : undefined,
			);
		}

		let effective: Subscription['plan']['effective'] | undefined;
		if (effectiveLicenses.length > 0) {
			effectiveLicenses.sort(
				(a, b) =>
					licenseStatusPriority(b[1].latestStatus) - licenseStatusPriority(a[1].latestStatus) ||
					getSubscriptionPlanPriority(convertLicenseTypeToPlanId(b[0])) -
						getSubscriptionPlanPriority(convertLicenseTypeToPlanId(a[0])),
			);

			const [licenseType, license] = effectiveLicenses[0];
			effective = getSubscriptionPlan(
				convertLicenseTypeToPlanId(licenseType),
				new Date(license.latestStartDate),
				new Date(license.latestEndDate),
			);
		}

		if (effective == null) {
			effective = { ...actual };
		}

		this.changeSubscription({
			plan: {
				actual: actual,
				effective: effective,
			},
			account: account,
		});
	}

	private _sessionPromise: Promise<AuthenticationSession | null> | undefined;
	private _session: AuthenticationSession | null | undefined;

	@gate()
	private async ensureSession(createIfNeeded: boolean): Promise<AuthenticationSession | undefined> {
		if (this._sessionPromise != null && this._session === undefined) {
			this._session = await this._sessionPromise;
			this._sessionPromise = undefined;
		}

		if (this._session != null) return this._session;
		if (this._session === null && !createIfNeeded) return undefined;

		if (createIfNeeded) {
			await this.container.storage.deleteWorkspace(this.connectedKey);
		} else if (this.container.storage.getWorkspace<boolean>(this.connectedKey) === false) {
			return undefined;
		}

		if (this._sessionPromise === undefined) {
			this._sessionPromise = this.getOrCreateSession(createIfNeeded);
		}

		this._session = await this._sessionPromise;
		this._sessionPromise = undefined;
		return this._session ?? undefined;
	}

	private async getOrCreateSession(createIfNeeded: boolean): Promise<AuthenticationSession | null> {
		let session: AuthenticationSession | null | undefined;

		this.updateStatusBar(true);

		try {
			session = await authentication.getSession(
				SubscriptionService.authenticationProviderId,
				SubscriptionService.authenticationScopes,
				{
					createIfNone: createIfNeeded,
					silent: !createIfNeeded,
				},
			);
		} catch (ex) {
			session = null;

			if (ex instanceof Error && ex.message.includes('User did not consent')) {
				this.logout();
				return null;
			}
		}

		if (session == null) {
			this.updateContext();
			return session ?? null;
		}

		try {
			await this.checkInAndValidate(session);
		} catch (ex) {
			Logger.error(ex);
			debugger;

			const name = session.account.label;
			session = null;
			if (ex instanceof AccountValidationError) {
				this.logout();

				if (createIfNeeded) {
					void window.showErrorMessage(
						`Unable to sign in to your account. Please try again. If this issue persists, please contact support. Account=${name} Error=${ex.message}`,
						'OK',
					);
				}
			}
		}

		return session;
	}

	@debug()
	private changeSubscription(
		subscription: Optional<Subscription, 'state'> | undefined,
		silent: boolean = false,
	): void {
		if (subscription == null) {
			subscription = {
				plan: {
					actual: getSubscriptionPlan(SubscriptionPlanId.Free),
					effective: getSubscriptionPlan(SubscriptionPlanId.Free),
				},
				account: undefined,
				state: SubscriptionState.Free,
			};
		}

		// If the effective plan is Free, then check if the preview has expired, if not apply it
		if (
			subscription.plan.effective.id === SubscriptionPlanId.Free &&
			subscription.preview != null &&
			(getTimeRemaining(subscription.preview.expiresOn) ?? 0) > 0
		) {
			(subscription.plan as PickMutable<Subscription['plan'], 'effective'>).effective = getSubscriptionPlan(
				SubscriptionPlanId.Pro,
				new Date(subscription.preview.startedOn),
				new Date(subscription.preview.expiresOn),
			);
		}

		// If the effective plan has expired, then replace it with the actual plan
		if (isSubscriptionExpired(subscription)) {
			(subscription.plan as PickMutable<Subscription['plan'], 'effective'>).effective = subscription.plan.actual;
		}

		subscription.state = computeSubscriptionState(subscription);
		assertSubscriptionState(subscription);
		void this.storeSubscription(subscription);

		const previous = this._subscription; // Can be undefined here, since we call this in the constructor
		this._subscription = subscription;

		this._etag = Date.now();
		this.updateContext();

		if (!silent && previous != null) {
			this._onDidChange.fire({ current: subscription, previous: previous });
		}
	}

	private getStoredSubscription(): Subscription | undefined {
		const storedSubscription = this.container.storage.get<Stored<Subscription>>(StorageKeys.PremiumSubscription);
		return storedSubscription?.data;
	}

	private async storeSubscription(subscription: Subscription): Promise<void> {
		return this.container.storage.store<Stored<Subscription>>(StorageKeys.PremiumSubscription, {
			v: 1,
			data: subscription,
		});
	}

	private updateContext(): void {
		void this.updateStatusBar();

		queueMicrotask(async () => {
			const { allowed, subscription } = await this.container.git.access();
			void setContext(
				ContextKeys.PremiumUpgradeRequired,
				allowed
					? false
					: subscription.required != null && isPaidSubscriptionPlan(subscription.required)
					? 'paid'
					: 'free+',
			);
		});

		const {
			plan: { actual },
		} = this._subscription;

		void setContext(ContextKeys.Premium, actual.id);
		void setContext(ContextKeys.PremiumPaid, isPaidSubscriptionPlan(actual.id));
		void setContext(ContextKeys.PremiumRequiresVerification, this._subscription.account?.verified === false);
	}

	private updateStatusBar(pending: boolean = false): void {
		this._statusBarSubscription =
			this._statusBarSubscription ??
			window.createStatusBarItem('gitlens.subscription', StatusBarAlignment.Left, 1);
		this._statusBarSubscription.name = 'GitLens Subscription';

		if (pending) {
			this._statusBarSubscription.text = `$(sync~spin) GitLens signing in...`;
			this._statusBarSubscription.tooltip = 'Signing in or validating your subscription...';
			return;
		}

		const {
			account,
			plan: { effective },
		} = this._subscription;

		switch (effective.id) {
			case SubscriptionPlanId.Free:
				this._statusBarSubscription.text = effective.name;
				this._statusBarSubscription.command = Commands.ShowHomeView;
				this._statusBarSubscription.tooltip = new MarkdownString(
					`You are on **${effective.name}**\n\nClick for details`,
					true,
				);
				break;

			case SubscriptionPlanId.FreePlus:
			case SubscriptionPlanId.Pro:
			case SubscriptionPlanId.Teams:
			case SubscriptionPlanId.Enterprise: {
				const trial = isSubscriptionTrial(this._subscription);
				this._statusBarSubscription.text = trial ? `${effective.name} (Trial)` : effective.name;
				this._statusBarSubscription.command = Commands.ShowHomeView;

				if (account?.verified === false) {
					this._statusBarSubscription.tooltip = new MarkdownString(
						trial
							? `Before you can trial **${effective.name}**, you must verify your email address.\n\nClick for details`
							: `Before you can access **${effective.name}**, you must verify your email address.\n\nClick for details`,
						true,
					);
				} else {
					const remaining = getSubscriptionTimeRemaining(this._subscription, 'days');

					this._statusBarSubscription.tooltip = new MarkdownString(
						trial
							? `You are trialing **${effective.name}**\n\nYou have ${pluralize(
									'day',
									remaining ?? 0,
							  )} remaining in your trial.\n\nClick for details`
							: `You are on **${effective.name}**\n\nClick for details`,
						true,
					);
				}
				break;
			}
		}

		this._statusBarSubscription.show();
	}
}

function assertSubscriptionState(subscription: Optional<Subscription, 'state'>): asserts subscription is Subscription {}

interface GKLicenseInfo {
	user: GKUser;
	licenses: {
		paidLicenses: Record<GKLicenseType, GKLicense>;
		effectiveLicenses: Record<GKLicenseType, GKLicense>;
	};
}

type GKLicenseType =
	| 'gitlens-pro'
	| 'gitlens-hosted-enterprise'
	| 'gitlens-self-hosted-enterprise'
	| 'gitlens-standalone-enterprise'
	| 'bundle-pro'
	| 'bundle-hosted-enterprise'
	| 'bundle-self-hosted-enterprise'
	| 'bundle-standalone-enterprise';

function convertLicenseTypeToPlanId(licenseType: GKLicenseType): SubscriptionPlanId {
	switch (licenseType) {
		case 'gitlens-pro':
		case 'bundle-pro':
			return SubscriptionPlanId.Pro;
		case 'gitlens-hosted-enterprise':
		case 'gitlens-self-hosted-enterprise':
		case 'gitlens-standalone-enterprise':
		case 'bundle-hosted-enterprise':
		case 'bundle-self-hosted-enterprise':
		case 'bundle-standalone-enterprise':
			return SubscriptionPlanId.Enterprise;
		default:
			return SubscriptionPlanId.FreePlus;
	}
}

function licenseStatusPriority(status: GKLicense['latestStatus']): number {
	switch (status) {
		case 'active':
			return 100;
		case 'expired':
			return -100;
		case 'trial':
			return 1;
		case 'canceled':
			return 0;
	}
}

interface GKLicense {
	latestStatus: 'active' | 'canceled' | 'expired' | 'trial';
	latestStartDate: string;
	latestEndDate: string;
}

interface GKUser {
	id: string;
	name: string;
	email: string;
	status: 'activated' | 'pending';
	firstGitLensCheckIn?: string;
}

interface Stored<T, SchemaVersion extends number = 1> {
	v: SchemaVersion;
	data: T;
}
