import type { Disposable } from 'vscode';
import { version as codeVersion, env } from 'vscode';
import type { Platform } from '@env/platform.js';
import { getPlatform, isWeb } from '@env/platform.js';
import { debug } from '@gitlens/utils/decorators/log.js';
import { getScopedLogger } from '@gitlens/utils/logger.scoped.js';
import { urls } from '../../constants.js';
import type { Container } from '../../container.js';
import type { ServerConnection } from './serverConnection.js';

/** Mirrors Kepler's feedback categories so both products' feedback lands in the same warehouse series. */
export type FeedbackType = 'general' | 'feature_request' | 'bug_report';

export interface FeedbackInput {
	type: FeedbackType;
	message: string;
	surface: 'graph';
	/** Whether a prefilled GitHub issue was also opened for this submission (bug reports only). */
	githubIssueOpened?: boolean;
}

interface FeedbackEventBody {
	source: 'gitlens';
	event: 'feedback';
	data: {
		action: 'submitted';
		feedbackType: FeedbackType;
		message: string;
		accountId?: string;
		planType?: string;
		origin: 'ui';
		surface: FeedbackInput['surface'];
		deviceID: string;
		sessionID: string;
		clientTimestamp: number;
		appVersion: string;
		runtime: 'web' | 'desktop';
		platform: Platform;
		vscodeVersion: string;
		vscodeEdition: string;
		vscodeHost: string;
		vscodeRemoteName: string;
		githubIssueOpened: boolean;
	};
}

/** Posts Send Feedback dialog submissions to the GitKraken events intake. */
export class FeedbackService implements Disposable {
	constructor(
		private readonly container: Container,
		private readonly connection: ServerConnection,
	) {}

	dispose(): void {}

	/** Sends a feedback record. Anonymous (signed-out) sends are allowed. Throws (with the HTTP status
	 *  in the message) on a non-2xx response or a network failure. */
	@debug()
	async send(input: FeedbackInput): Promise<void> {
		const scope = getScopedLogger();

		try {
			// `getAuthenticationSession` throws when signed out — check first so anonymous sends still work,
			// and pass `token: false` to skip the throwing lookup `fetchGkApi` would otherwise make.
			const session = await this.container.subscription.getAuthenticationSession();
			const subscription = await this.container.subscription.getSubscription(true);

			const body: FeedbackEventBody = {
				source: 'gitlens',
				event: 'feedback',
				data: {
					action: 'submitted',
					feedbackType: input.type,
					message: input.message.trim(),
					accountId: subscription.account?.id,
					planType: subscription.plan.effective.name,
					origin: 'ui',
					surface: input.surface,
					deviceID: env.machineId,
					sessionID: env.sessionId,
					clientTimestamp: Date.now(),
					appVersion: this.container.version,
					runtime: isWeb ? 'web' : 'desktop',
					platform: getPlatform(),
					vscodeVersion: codeVersion,
					vscodeEdition: env.appName,
					vscodeHost: env.appHost,
					vscodeRemoteName: env.remoteName ?? '',
					githubIssueOpened: input.githubIssueOpened ?? false,
				},
			};

			const rsp = await this.connection.fetchGkApi(
				'events',
				{ method: 'POST', body: JSON.stringify(body) },
				session == null ? { token: false } : undefined,
			);

			if (!rsp.ok) {
				throw new Error(`Unable to send feedback: (${rsp.status}) ${rsp.statusText}`);
			}
		} catch (ex) {
			scope?.error(ex);
			debugger;
			throw ex;
		}
	}
}

/** The maximum length of a GitHub "new issue" URL before we truncate the prefilled description. */
const maxIssueUrlLength = 6000;
/** How much of the message survives when the URL would exceed {@link maxIssueUrlLength}. */
const maxTruncatedDescriptionLength = 1500;

/** Builds a prefilled "new issue" GitHub URL from a Send Feedback dialog submission — the bug-report
 *  form (with the GitLens and VS Code versions filled in too) or the feature-request form. */
export function getFeedbackIssueUrl(
	container: Container,
	type: Exclude<FeedbackType, 'general'>,
	message: string,
): string {
	const build = (description: string) => {
		const params = new URLSearchParams({ description: description });
		if (type === 'bug_report') {
			params.set('gitlens', container.version);
			params.set(
				'vscode',
				`Version: ${codeVersion}\n${env.appName} (${env.appHost}${env.remoteName ? `, ${env.remoteName}` : ''})`,
			);
		}

		const base = type === 'bug_report' ? urls.githubNewBugIssue : urls.githubNewFeatureIssue;
		return `${base}&${params.toString()}`;
	};

	const url = build(message);
	if (url.length <= maxIssueUrlLength) return url;

	// URL-encoding expands a character to at most three, so this cap always fits under the limit with
	// room for the other params.
	const truncationNotice = '\n\n[Message truncated here — the full text was sent to GitKraken with your feedback.]';
	return build(`${message.slice(0, maxTruncatedDescriptionLength)}${truncationNotice}`);
}
