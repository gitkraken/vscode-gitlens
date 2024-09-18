import type { ConfigurationChangeEvent, Extension } from 'vscode';
import { Disposable, extensions, workspace } from 'vscode';
import type { LiveShare, LiveShareExtension, SessionChangeEvent } from '../@types/vsls';
import { Schemes } from '../constants';
import type { Container } from '../container';
import { debug } from '../system/decorators/log';
import { once } from '../system/event';
import { Logger } from '../system/logger';
import type { Deferred } from '../system/promise';
import { defer } from '../system/promise';
import { configuration } from '../system/vscode/configuration';
import { setContext } from '../system/vscode/context';
import { VslsGuestService } from './guest';
import { VslsHostService } from './host';

export interface ContactPresence {
	status: ContactPresenceStatus;
	statusText: string;
}
export type ContactPresenceStatus = 'online' | 'away' | 'busy' | 'dnd' | 'offline';

function contactStatusToPresence(status: string | undefined): ContactPresence {
	switch (status) {
		case 'available':
			return { status: 'online', statusText: 'Available' };
		case 'away':
			return { status: 'away', statusText: 'Away' };
		case 'busy':
			return { status: 'busy', statusText: 'Busy' };
		case 'doNotDisturb':
			return { status: 'dnd', statusText: 'DND' };
		default:
			return { status: 'offline', statusText: 'Offline' };
	}
}

export class VslsController implements Disposable {
	private _api: Promise<LiveShare | undefined> | undefined;
	private _disposable: Disposable;
	private _guest: VslsGuestService | undefined;
	private _host: VslsHostService | undefined;
	private _ready: Deferred<void>;

	constructor(private readonly container: Container) {
		this._ready = defer<void>();
		this._disposable = Disposable.from(
			once(container.onReady)(this.onReady, this),
			configuration.onDidChange(this.onConfigurationChanged, this),
		);
	}

	dispose() {
		this._ready.fulfill();

		this._disposable.dispose();
		this._host?.dispose();
		this._guest?.dispose();
	}

	private onReady(): void {
		void this.initialize();
	}

	private async initialize() {
		if (!this.enabled) {
			void setContext('gitlens:vsls', false);
			return;
		}

		// If we have a vsls: workspace open, we might be a guest, so wait until live share transitions into a mode
		if (workspace.workspaceFolders?.some(f => f.uri.scheme === Schemes.Vsls)) {
			this.setReadonly(true);
		}

		try {
			this._api = this.getLiveShareApi();
			const api = await this._api;
			if (api == null) {
				void setContext('gitlens:vsls', false);
				// Tear it down if we can't talk to live share
				this._ready.fulfill();

				return;
			}

			void setContext('gitlens:vsls', true);

			this._disposable = Disposable.from(
				this._disposable,
				api.onDidChangeSession(e => this.onLiveShareSessionChanged(api, e), this),
			);
			void this.onLiveShareSessionChanged(api, { session: api.session });
		} catch (ex) {
			Logger.error(ex);
			debugger;
		}
	}

	private onConfigurationChanged(e: ConfigurationChangeEvent) {
		if (configuration.changed(e, 'liveshare.enabled')) {
			void this.initialize();
		}
	}

	private async onLiveShareSessionChanged(api: LiveShare, e: SessionChangeEvent) {
		this._host?.dispose();
		this._host = undefined;
		this._guest?.dispose();
		this._guest = undefined;

		switch (e.session.role) {
			case 1 /*Role.Host*/:
				this.setReadonly(false);
				void setContext('gitlens:vsls', 'host');
				if (configuration.get('liveshare.allowGuestAccess')) {
					this._host = await VslsHostService.share(api, this.container);
				}

				this._ready.fulfill();

				break;

			case 2 /*Role.Guest*/:
				this.setReadonly(true);
				void setContext('gitlens:vsls', 'guest');
				this._guest = await VslsGuestService.connect(api, this.container);

				this._ready.fulfill();

				break;

			default:
				this.setReadonly(false);
				void setContext('gitlens:vsls', true);

				if (!this._ready.pending) {
					this._ready = defer<void>();
				}

				break;
		}
	}

	private async getLiveShareApi(): Promise<LiveShare | undefined> {
		try {
			const extension = this.getLiveShareExtension();
			if (extension != null) {
				const vsls = extension.isActive ? extension.exports : await extension.activate();
				return (await vsls.getApi('1.0.4753')) ?? undefined;
			}
		} catch (ex) {
			debugger;
			Logger.error(ex);
		}

		return undefined;
	}

	private getLiveShareExtension(): Extension<LiveShareExtension> | undefined {
		return extensions.getExtension<LiveShareExtension>('ms-vsliveshare.vsliveshare');
	}

	get active() {
		return configuration.get('liveshare.enabled') && this.getLiveShareExtension()?.isActive;
	}

	get enabled() {
		return configuration.get('liveshare.enabled');
	}

	private _readonly: boolean = false;
	get readonly() {
		return this._readonly;
	}
	private setReadonly(value: boolean) {
		this._readonly = value;
		void setContext('gitlens:readonly', value ? true : undefined);
	}

	async guest() {
		if (this._guest != null) return this._guest;

		await this._ready.promise;
		return this._guest;
	}

	@debug()
	async getContact(email: string | undefined) {
		if (email == null) return undefined;

		const api = await this._api;
		if (api == null) return undefined;

		const contacts = await api.getContacts([email]);
		return contacts.contacts[email];
	}

	@debug<VslsController['getContacts']>({ args: { 0: emails => emails.length } })
	private async getContacts(emails: string[]) {
		const api = await this._api;
		if (api == null) return undefined;

		const contacts = await api.getContacts(emails);
		return Object.values(contacts.contacts);
	}

	@debug()
	async getContactPresence(email: string | undefined): Promise<ContactPresence | undefined> {
		const contact = await this.getContact(email);
		if (contact == null) return undefined;

		return contactStatusToPresence(contact.status);
	}

	@debug<VslsController['getContactsPresence']>({ args: { 0: emails => emails.length } })
	async getContactsPresence(emails: string[]): Promise<Map<string, ContactPresence> | undefined> {
		const contacts = await this.getContacts(emails);
		if (contacts == null) return undefined;

		return new Map<string, ContactPresence>(
			Object.values(contacts).map(c => [c.email, contactStatusToPresence(c.status)]),
		);
	}

	async invite(email: string | undefined) {
		if (email == null) return undefined;

		const contact = await this.getContact(email);
		if (contact == null) return undefined;

		return contact.invite();
	}

	async startSession() {
		const api = await this._api;
		if (api == null) return undefined;

		return api.share();
	}
}
