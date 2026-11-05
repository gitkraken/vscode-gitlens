import { l10n, ThemeIcon, window } from 'vscode';
import type { NotificationContentType, NotificationSettings, RawNotification } from '@gitlens/notifications/models.js';
import type { Container } from '../../container.js';
import type { QuickPickItemOfT } from '../../quickpicks/items/common.js';
import { createQuickPickSeparator } from '../../quickpicks/items/common.js';
import { registerCommand } from '../../system/-webview/command.js';

type Scenario = 'all-types' | 'empty' | 'many';
type Preset = 'security' | 'system' | 'feature' | 'marketing';
type FailTarget = 'none' | 'list' | 'list-html' | 'actions' | 'settings' | 'all';

export type SimulateNotificationsArgs =
	| { op: 'start'; scenario?: Scenario }
	| { op: 'add'; preset: Preset; title?: string; count?: number }
	| { op: 'fail'; target: FailTarget }
	/** Deletes on the server only, as if from gitkraken.dev or another window: the client still shows them */
	| { op: 'remove'; ids: string[] }
	/** Delays every response by `ms` (0 to turn off), to exercise in-flight races */
	| { op: 'latency'; ms: number }
	| { op: 'state' }
	| { op: 'refresh' }
	| { op: 'stop' };

export interface SimulatedNotificationsState {
	active: boolean;
	scenario: Scenario | undefined;
	fail: FailTarget;
	items: { id: string; readAt: string | null; deleted: boolean }[];
	settings: NotificationSettings | undefined;
	/** `{method} {path}`, oldest first */
	requests: string[];
}

export function registerNotificationsSimulator(container: Container): void {
	new NotificationsSimulatorDebug(container);
}

type SimulatorQuickPickItem = QuickPickItemOfT<SimulateNotificationsArgs>;

class NotificationsSimulatorDebug {
	private server: FakeNotificationsServer | undefined;

	constructor(private readonly container: Container) {
		this.container.context.subscriptions.push(
			registerCommand(
				'gitlens.plus.simulate.notifications',
				(args?: SimulateNotificationsArgs) => this.handleSimulate(args),
				undefined,
				{ returnResult: true },
			),
		);
	}

	private async handleSimulate(args?: SimulateNotificationsArgs): Promise<unknown> {
		if (args == null) {
			const pick = await this.showPicker();
			if (pick == null) return this.server != null;

			return this.handleSimulate(pick);
		}

		switch (args.op) {
			case 'start': {
				this.server = new FakeNotificationsServer(args.scenario ?? 'all-types');
				const server = this.server;
				await this.container.notifications.setSimulation((path, init, query) =>
					server.fetch(path, init, query),
				);
				// Without an account there is no service (the inbox shows its sign-in prompt)
				return this.container.notifications.enabled;
			}
			case 'add':
				return this.server?.add(args.preset, args.title, args.count) ?? [];
			case 'fail':
				if (this.server != null) {
					this.server.fail = args.target;
				}
				return this.server != null;
			case 'remove':
				return this.server?.remove(args.ids) ?? [];
			case 'latency':
				if (this.server != null) {
					this.server.latency = Math.max(args.ms, 0);
				}
				return this.server != null;
			case 'state':
				return this.getState();
			case 'refresh':
				await this.container.notifications.refresh();
				return true;
			case 'stop':
				if (this.server != null) {
					this.server = undefined;
					await this.container.notifications.setSimulation(undefined);
				}
				return false;
		}
	}

	private getState(): SimulatedNotificationsState {
		const server = this.server;
		return {
			active: server != null,
			scenario: server?.scenario,
			fail: server?.fail ?? 'none',
			items:
				server?.items.map(i => ({
					id: i.raw.notificationId,
					readAt: i.raw.readAt ?? null,
					deleted: i.deleted,
				})) ?? [],
			settings: server != null ? { ...server.settings } : undefined,
			requests: server != null ? [...server.requests] : [],
		};
	}

	private async showPicker(): Promise<SimulateNotificationsArgs | undefined> {
		const items: SimulatorQuickPickItem[] = (['all-types', 'empty', 'many'] as const).map(scenario => ({
			label: l10n.t('Start: {0}', scenario),
			iconPath: new ThemeIcon('beaker'),
			item: { op: 'start', scenario: scenario },
		}));

		if (this.server != null) {
			items.unshift(
				{
					label: l10n.t('End Simulation'),
					iconPath: new ThemeIcon('beaker-stop'),
					item: { op: 'stop' },
				},
				{
					label: l10n.t('Refresh'),
					iconPath: new ThemeIcon('refresh'),
					item: { op: 'refresh' },
				},
				createQuickPickSeparator<SimulatorQuickPickItem>(),
			);
			items.push(
				createQuickPickSeparator<SimulatorQuickPickItem>(),
				...(['security', 'system', 'feature', 'marketing'] as const).map<SimulatorQuickPickItem>(preset => ({
					label: l10n.t('Add: {0}', preset),
					iconPath: new ThemeIcon('add'),
					item: { op: 'add', preset: preset },
				})),
				createQuickPickSeparator<SimulatorQuickPickItem>(),
				...(['none', 'list', 'list-html', 'actions', 'settings', 'all'] as const).map<SimulatorQuickPickItem>(
					target => ({
						label: l10n.t('Fail Requests: {0}', target),
						iconPath: new ThemeIcon(target === 'none' ? 'pass' : 'error'),
						picked: this.server?.fail === target,
						item: { op: 'fail', target: target },
					}),
				),
			);
		}

		const pick = await window.showQuickPick(items, {
			title: l10n.t('Notifications Simulator'),
			placeHolder:
				this.server != null ? l10n.t('Active: {0}', this.server.scenario) : l10n.t('Choose a simulator mode'),
			ignoreFocusOut: true,
		});
		return pick?.item;
	}
}

interface FakeItem {
	raw: RawNotification;
	deleted: boolean;
}

const minute = 60 * 1000;
const hour = 60 * minute;
const day = 24 * hour;

/** An in-memory `notifications-service-v2` (v1 API), answering what `@gitlens/notifications`'s `NotificationsApi` sends */
class FakeNotificationsServer {
	readonly items: FakeItem[];
	readonly requests: string[] = [];
	settings: NotificationSettings = { marketingEnabled: true, helpEnabled: true, securityEnabled: true };
	fail: FailTarget = 'none';
	latency = 0;
	private added = 0;

	constructor(readonly scenario: Scenario) {
		this.items = createFixtures(scenario, Date.now()).map(raw => ({ raw: raw, deleted: false }));
	}

	add(preset: Preset, title: string | undefined, count: number | undefined): string[] {
		const now = Date.now();
		const ids: string[] = [];
		for (let i = 0; i < Math.max(count ?? 1, 1); i++) {
			this.added++;
			// Unique across simulator runs too: toasted ids are remembered in globalState
			const id = `sim-added-${preset}-${now}-${this.added}`;
			const raw = createPresetNotification(id, preset, title, now);
			this.items.push({ raw: raw, deleted: false });
			ids.push(id);
		}
		return ids;
	}

	remove(ids: readonly string[]): string[] {
		const removed: string[] = [];
		for (const item of this.items) {
			if (!item.deleted && ids.includes(item.raw.notificationId)) {
				item.deleted = true;
				removed.push(item.raw.notificationId);
			}
		}
		return removed;
	}

	async fetch(path: string, init?: RequestInit, query?: URLSearchParams): Promise<Response> {
		const response = this.respond(path, init, query);
		if (this.latency > 0) {
			await new Promise(resolve => setTimeout(resolve, this.latency));
		}
		return response;
	}

	private respond(path: string, init?: RequestInit, query?: URLSearchParams): Promise<Response> {
		const method = (init?.method ?? 'GET').toUpperCase();
		const search = query?.toString();
		this.requests.push(search ? `${method} ${path}?${search}` : `${method} ${path}`);
		if (this.requests.length > 50) {
			this.requests.splice(0, this.requests.length - 50);
		}

		const url = new URL(path, 'https://simulator.invalid/');
		const route = `${method} ${url.pathname}`;
		switch (route) {
			case 'GET /v1/notifications':
				if (this.fail === 'list-html') {
					return Promise.resolve(new Response('<html><body>Gateway error</body></html>', { status: 200 }));
				}
				if (this.shouldFail('list')) return Promise.resolve(errorResponse());

				return Promise.resolve(this.list(query ?? new URLSearchParams()));
			case 'POST /v1/notifications/read':
			case 'POST /v1/notifications/unread':
			case 'DELETE /v1/notifications': {
				if (this.shouldFail('actions')) return Promise.resolve(errorResponse());

				const ids = new Set(readIds(init?.body));
				// Like the real service: ids the user can no longer see are dropped, and none left is a 404
				const visible = this.items.filter(i => !i.deleted && ids.has(i.raw.notificationId));
				if (!visible.length) {
					return Promise.resolve(
						new Response(JSON.stringify({ error: 'No valid notifications found' }), {
							status: 404,
							statusText: 'Not Found',
						}),
					);
				}

				const readAt = new Date().toISOString();
				for (const item of visible) {
					if (method === 'DELETE') {
						item.deleted = true;
					} else {
						item.raw.readAt = url.pathname.endsWith('/unread') ? null : readAt;
					}
				}
				return Promise.resolve(jsonResponse({}));
			}
			case 'GET /v1/notifications/user-settings':
				if (this.shouldFail('settings')) return Promise.resolve(errorResponse());

				return Promise.resolve(jsonResponse({ ...this.settings }));
			case 'POST /v1/notifications/user-settings': {
				if (this.shouldFail('settings')) return Promise.resolve(errorResponse());

				const body = parseBody(init?.body);
				for (const key of ['marketingEnabled', 'helpEnabled', 'securityEnabled'] as const) {
					if (typeof body?.[key] === 'boolean') {
						this.settings[key] = body[key];
					}
				}
				return Promise.resolve(jsonResponse({ ...this.settings }));
			}
			default:
				return Promise.resolve(new Response('Not Found', { status: 404, statusText: 'Not Found' }));
		}
	}

	private shouldFail(target: Exclude<FailTarget, 'none' | 'list-html' | 'all'>): boolean {
		return this.fail === 'all' || this.fail === target;
	}

	private list(params: URLSearchParams): Response {
		const page = Math.max(Number(params.get('page')) || 1, 1);
		const pageSize = Math.max(Number(params.get('pageSize')) || 50, 1);
		const visible = this.items
			.filter(i => !i.deleted)
			.map(i => i.raw)
			.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
		const start = (page - 1) * pageSize;
		return jsonResponse({
			results: visible.slice(start, start + pageSize),
			hasMore: start + pageSize < visible.length,
			page: page,
			pageSize: pageSize,
		});
	}
}

function jsonResponse(data: unknown): Response {
	return new Response(JSON.stringify({ data: data }), {
		status: 200,
		headers: { 'Content-Type': 'application/json' },
	});
}

function errorResponse(): Response {
	return new Response('Internal Server Error', { status: 500, statusText: 'Internal Server Error' });
}

function parseBody(body: RequestInit['body'] | undefined): Record<string, unknown> | undefined {
	if (typeof body !== 'string') return undefined;

	try {
		const json: unknown = JSON.parse(body);
		return typeof json === 'object' && json != null && !Array.isArray(json)
			? (json as Record<string, unknown>)
			: undefined;
	} catch {
		return undefined;
	}
}

function readIds(body: RequestInit['body'] | undefined): string[] {
	const ids = parseBody(body)?.notificationIds;
	return Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string') : [];
}

function raw(
	now: number,
	notification: Pick<RawNotification, 'notificationId' | 'name' | 'contentType' | 'event'> &
		Partial<Omit<RawNotification, 'createdAt' | 'updatedAt'>> & { ago: number },
): RawNotification {
	const { ago, ...rest } = notification;
	const createdAt = new Date(now - ago).toISOString();
	return {
		title: null,
		notificationType: 'system',
		readAt: null,
		expiresAt: null,
		fallback: null,
		...rest,
		createdAt: createdAt,
		updatedAt: createdAt,
	};
}

function createPresetNotification(id: string, preset: Preset, title: string | undefined, now: number): RawNotification {
	const contentType: NotificationContentType = preset;
	switch (preset) {
		case 'security':
			return raw(now, {
				notificationId: id,
				name: 'gl-security-unusual-signin-2026q4',
				title: title ?? 'Unusual sign-in to your GitKraken account',
				contentType: contentType,
				event: 'general',
				ago: 0,
				payload: {
					desktopMessage: 'Security notice: unusual sign-in to your GitKraken account.',
					markdown: "We noticed a sign-in from a new device. If this wasn't you, **reset your password**.",
				},
			});
		case 'system':
			return raw(now, {
				notificationId: id,
				name: 'gl-system-degraded-services',
				title: title ?? 'GitKraken services are degraded',
				contentType: contentType,
				event: 'callToAction',
				ago: 0,
				payload: {
					desktopMessage: 'GitKraken services are degraded.',
					markdown: 'Some cloud features may be slow or unavailable while we investigate.',
					callToAction: { text: 'View Status', link: 'https://status.gitkraken.com' },
				},
			});
		case 'feature':
			return raw(now, {
				notificationId: id,
				name: 'gl-feature-simulated-announcement',
				title: title ?? 'New in GitLens: a simulated feature',
				contentType: contentType,
				event: 'general',
				ago: 0,
				payload: {
					desktopMessage: 'New in GitLens: a simulated feature.',
					markdown: 'A simulated feature announcement.',
				},
			});
		case 'marketing':
			return raw(now, {
				notificationId: id,
				name: 'gl-marketing-pro-50-off-simulated',
				title: title ?? 'Limited time: 50% off GitKraken Pro',
				contentType: contentType,
				event: 'callToAction',
				ago: 0,
				payload: {
					desktopMessage: 'Limited time: save 50% on GitKraken Pro.',
					markdown: 'Upgrade today and save on your first year.',
					callToAction: { text: 'See Offer', link: 'https://www.gitkraken.com/pricing' },
				},
			});
	}
}

function createFixtures(scenario: Scenario, now: number): RawNotification[] {
	switch (scenario) {
		case 'empty':
			return [];
		case 'many': {
			const items: RawNotification[] = [];
			for (let i = 1; i <= 62; i++) {
				items.push(
					raw(now, {
						notificationId: `sim-many-feature-${i}`,
						name: `gl-feature-simulated-${i}`,
						title: `Simulated feature announcement #${i}`,
						contentType: 'feature',
						event: 'general',
						ago: i * hour,
						payload: {
							desktopMessage: `Simulated feature announcement #${i}.`,
							markdown: `Body of simulated feature announcement **#${i}**.`,
						},
					}),
				);
			}
			for (let i = 1; i <= 2; i++) {
				items.push(
					raw(now, {
						notificationId: `sim-many-security-${i}`,
						name: `gl-security-simulated-${i}`,
						title: `Simulated security notice #${i}`,
						contentType: 'security',
						event: 'general',
						ago: i * 30 * minute,
						payload: {
							desktopMessage: `Simulated security notice #${i}.`,
							markdown: `Body of simulated security notice **#${i}**.`,
						},
					}),
				);
			}
			return items;
		}
		case 'all-types':
			return createAllTypesFixtures(now);
	}
}

function createAllTypesFixtures(now: number): RawNotification[] {
	const readAt = new Date(now - hour).toISOString();
	return [
		raw(now, {
			notificationId: 'sim-feature-inbox',
			name: 'gl-feature-notifications-inbox-2026q4',
			title: 'New in GitLens: Notifications inbox',
			contentType: 'feature',
			event: 'general',
			ago: 2 * minute,
			payload: {
				desktopMessage: 'GitKraken notifications now show right inside GitLens.',
				markdown: [
					'GitKraken notifications now show **right inside GitLens**, in the `Notifications` section of Settings.',
					'',
					'- Mark notifications read or unread',
					'- Delete the ones you are done with',
					'- Opt out of marketing',
					'',
					'Read more on [the GitLens blog](https://www.gitkraken.com/blog).',
					'',
					'Sanitizing checks: [run](command:workbench.action.quit), [script](javascript:alert(1)), <b>raw html</b>, and an image:',
					'',
					'![x](https://example.com/x.png)',
				].join('\n'),
			},
		}),
		raw(now, {
			notificationId: 'sim-help-tip',
			name: 'gl-help-commit-graph-search-tip',
			contentType: 'help',
			event: 'general',
			ago: 15 * minute,
			payload: {
				desktopMessage: 'Tip: search the Commit Graph by message, author, or file.',
				markdown: 'Use the search box in the Commit Graph to jump straight to matching commits.',
			},
		}),
		raw(now, {
			notificationId: 'sim-marketing-offer',
			name: 'gl-marketing-pro-50-off-2026q4',
			title: 'Limited time: 50% off GitKraken Pro',
			contentType: 'marketing',
			event: 'callToAction',
			ago: 40 * minute,
			payload: {
				desktopMessage: 'Limited time: save 50% on GitKraken Pro.',
				markdown: 'Unlock the full **GitKraken** suite for your team at half the price.',
				callToAction: { text: 'Claim Offer', link: 'https://www.gitkraken.com/pricing' },
			},
		}),
		raw(now, {
			notificationId: 'sim-security-notice',
			name: 'gl-security-rotate-pats-2026q4',
			title: 'Rotate your personal access tokens',
			contentType: 'security',
			event: 'general',
			ago: hour + 20 * minute,
			payload: {
				desktopMessage: 'Security notice: rotate any personal access tokens created before March 1.',
				markdown: 'As a precaution, please rotate any personal access tokens created before **March 1**.',
			},
		}),
		raw(now, {
			notificationId: 'sim-system-maintenance',
			name: 'gl-system-maintenance-sat-0200utc',
			contentType: 'system',
			event: 'callToAction',
			ago: 3 * hour,
			payload: {
				desktopMessage: 'Scheduled maintenance this Saturday, 02:00 to 03:00 UTC.',
				markdown: 'GitKraken cloud services will be briefly unavailable on Saturday from 02:00 to 03:00 UTC.',
				callToAction: { text: 'View Status', link: 'https://status.gitkraken.com' },
			},
		}),
		raw(now, {
			notificationId: 'sim-org-join-request',
			name: 'org-join-request-notify-owner',
			title: 'Request to join Acme',
			notificationType: 'user',
			contentType: 'feature',
			event: 'callToAction',
			ago: 5 * hour,
			payload: {
				desktopMessage: 'jane@acme.dev has requested to join Acme.',
				markdown:
					'jane@acme.dev has requested to join Acme. This request is waiting on your approval.\n\n**User message:**\n_Hi! I just joined the payments team._\n',
				callToAction: { text: 'Review', link: 'https://gitkraken.dev/users?review_invites=true' },
			},
		}),
		raw(now, {
			notificationId: 'sim-org-invitations',
			name: 'org-invitations-notify-owner',
			title: 'Invitations to join Acme',
			notificationType: 'user',
			contentType: 'feature',
			event: 'callToAction',
			ago: 8 * hour,
			payload: {
				desktopMessage: 'sam@acme.dev has invited 3 people to join Acme.',
				markdown:
					'sam@acme.dev has invited 3 people to join Acme. This invitation is waiting on your approval.',
				callToAction: { text: 'Review', link: 'https://gitkraken.dev/users?review_invites=true' },
			},
		}),
		raw(now, {
			notificationId: 'sim-org-reminder',
			name: 'org-pending-approvals-reminder',
			title: 'People are waiting to join Acme',
			notificationType: 'user',
			contentType: 'feature',
			event: 'callToAction',
			ago: day,
			payload: {
				desktopMessage: '3 people are waiting for your approval to join Acme.',
				markdown: '3 people are waiting for your approval to join Acme.',
				callToAction: { text: 'Review Requests', link: 'https://gitkraken.dev/users?review_invites=true' },
			},
		}),
		raw(now, {
			notificationId: 'sim-org-rejected',
			name: 'org-join-request-rejected',
			title: 'Request to join Acme rejected',
			notificationType: 'user',
			contentType: 'feature',
			event: 'callToAction',
			ago: day + 6 * hour,
			payload: {
				desktopMessage: 'Your request to join Acme was rejected.',
				markdown: 'Ask owner@acme.dev for access, or get GitKraken Pro at a special price.',
				callToAction: { text: 'Get GitKraken Pro offer', link: 'https://www.gitkraken.com/pricing' },
			},
		}),
		raw(now, {
			notificationId: 'sim-org-pending',
			name: 'org-join-request-pending-nudge',
			title: 'Still waiting on Acme?',
			notificationType: 'user',
			contentType: 'feature',
			event: 'callToAction',
			ago: 2 * day,
			payload: {
				desktopMessage: 'Your request to join Acme is still pending.',
				markdown: 'Request pending. Contact owner@acme.dev or get started now.',
				callToAction: { text: 'Get GitKraken Pro', link: 'https://www.gitkraken.com/pricing' },
			},
		}),
		raw(now, {
			notificationId: 'sim-org-insights',
			name: 'org-insights-member-add-failed',
			title: "Couldn't add insights member",
			notificationType: 'user',
			contentType: 'feature',
			event: 'callToAction',
			ago: 2 * day + 4 * hour,
			payload: {
				desktopMessage: "Couldn't add github/octocat as an insights user.",
				markdown: "Couldn't add `github/octocat` as an insights user.",
				callToAction: { text: 'Review', link: 'https://gitkraken.dev/users?review_invites=true' },
			},
		}),
		raw(now, {
			notificationId: 'sim-project-shared',
			name: 'project-shared-payments-platform',
			title: '',
			notificationType: 'user',
			contentType: 'feature',
			event: 'projectShared',
			ago: 3 * day,
			payload: {
				owner: { id: 'user-owner', name: 'Olivia Owner' },
				project: { id: 'project-payments', name: 'Payments Platform' },
				organization: { id: 'org-acme', name: 'Acme' },
				shareType: 'org',
				teams: [
					{ id: 'team-platform', name: 'Platform' },
					{ id: 'team-web', name: 'Web' },
				],
			},
		}),
		raw(now, {
			notificationId: 'sim-nudge',
			name: 'user-nudge-jane',
			title: 'You have been Nudged',
			notificationType: 'user',
			contentType: 'feature',
			event: 'nudge',
			ago: 3 * day + 5 * hour,
			payload: {
				initiatorUserId: 'user-jane',
				metadata: { message: 'Can you take a look at my cloud patch?' },
			},
		}),
		raw(now, {
			notificationId: 'sim-unknown-with-fallback',
			name: 'poll-result-available-poll-1',
			contentType: 'feature',
			event: 'pollResult',
			ago: 4 * day,
			fallback: 'Your **poll** has results. Update GitLens to see them here, or view them on gitkraken.dev.',
			payload: { pollId: 'poll-1', winner: 'Option A' },
		}),
		// Dropped by the client: unknown event without a fallback
		raw(now, {
			notificationId: 'sim-unknown-no-fallback',
			name: 'poll-result-available-poll-2',
			title: 'This must never show (unknown event)',
			contentType: 'feature',
			event: 'pollResult',
			ago: 4 * day + hour,
			payload: { pollId: 'poll-2' },
		}),
		// Dropped by the client: unsafe call-to-action link
		raw(now, {
			notificationId: 'sim-unsafe-cta',
			name: 'gl-marketing-unsafe-cta',
			title: 'This must never show (unsafe link)',
			contentType: 'marketing',
			event: 'callToAction',
			ago: 4 * day + 2 * hour,
			payload: {
				desktopMessage: 'This must never show (unsafe link).',
				markdown: 'Unsafe call-to-action link.',
				callToAction: { text: 'Click Me', link: 'javascript:alert(1)' },
			},
		}),
		raw(now, {
			notificationId: 'sim-long-headline',
			name: 'gl-feature-long-summary-layout-test',
			contentType: 'feature',
			event: 'general',
			ago: 5 * day,
			payload: {
				desktopMessage:
					'This is a deliberately very long notification summary that keeps going well past what fits on a single line, to exercise wrapping, truncation and layout in the notifications inbox',
				markdown: 'A short body under a very long headline.',
			},
		}),
		// Pruned by the client: already expired
		raw(now, {
			notificationId: 'sim-expired',
			name: 'gl-system-expired-notice',
			title: 'This must never show (expired)',
			contentType: 'system',
			event: 'general',
			ago: 5 * day + hour,
			expiresAt: new Date(now - day).toISOString(),
			payload: { desktopMessage: 'This must never show (expired).', markdown: 'Expired yesterday.' },
		}),
		raw(now, {
			notificationId: 'sim-read-1',
			name: 'gl-feature-gitlens-17-release',
			title: 'Already read: GitLens 17.0 is here',
			contentType: 'feature',
			event: 'general',
			ago: 6 * day,
			readAt: readAt,
			payload: { desktopMessage: 'GitLens 17.0 is here.', markdown: 'An already-read feature announcement.' },
		}),
		raw(now, {
			notificationId: 'sim-read-2',
			name: 'gl-help-tip-of-the-week',
			contentType: 'help',
			event: 'general',
			ago: 7 * day,
			readAt: readAt,
			payload: { markdown: 'An already-read help tip.' },
		}),
		raw(now, {
			notificationId: 'sim-read-3',
			name: 'gl-marketing-trial-ending-soon',
			title: 'Already read: Your trial ends soon',
			contentType: 'marketing',
			event: 'callToAction',
			ago: 9 * day,
			readAt: readAt,
			payload: {
				desktopMessage: 'Your GitKraken trial ends soon.',
				markdown: 'An already-read marketing offer.',
				callToAction: { text: 'Upgrade', link: 'https://www.gitkraken.com/pricing' },
			},
		}),
	];
}
