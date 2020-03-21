'use strict';
import { Disposable, workspace } from 'vscode';
import { getApi, LiveShare, Role, SessionChangeEvent } from 'vsls';
import { CommandContext, DocumentSchemes, setCommandContext } from '../constants';
import { Container } from '../container';
import { Logger } from '../logger';
import { VslsGuestService } from './guest';
import { VslsHostService } from './host';
import { debug, timeout } from '../system';

export const vslsUriPrefixRegex = /^[/|\\]~(?:\d+?|external)(?:[/|\\]|$)/;
export const vslsUriRootRegex = /^[/|\\]~(?:\d+?|external)$/;

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
	private _disposable: Disposable | undefined;
	private _guest: VslsGuestService | undefined;
	private _host: VslsHostService | undefined;

	private _onReady: (() => void) | undefined;
	private _waitForReady: Promise<void> | undefined;

	private _api: Promise<LiveShare | null> | undefined;

	constructor() {
		void this.initialize();
	}

	dispose() {
		this._disposable && this._disposable.dispose();
		if (this._host !== undefined) {
			this._host.dispose();
		}

		if (this._guest !== undefined) {
			this._guest.dispose();
		}
	}

	private async initialize() {
		try {
			// If we have a vsls: workspace open, we might be a guest, so wait until live share transitions into a mode
			if (
				workspace.workspaceFolders !== undefined &&
				workspace.workspaceFolders.some(f => f.uri.scheme === DocumentSchemes.Vsls)
			) {
				this.setReadonly(true);
				this._waitForReady = new Promise(resolve => (this._onReady = resolve));
			}

			this._api = getApi();
			const api = await this._api;
			if (api == null) {
				setCommandContext(CommandContext.Vsls, false);
				// Tear it down if we can't talk to live share
				if (this._onReady !== undefined) {
					this._onReady();
					this._waitForReady = undefined;
				}

				return;
			}

			setCommandContext(CommandContext.Vsls, true);

			this._disposable = Disposable.from(
				api.onDidChangeSession(e => this.onLiveShareSessionChanged(api, e), this),
			);
		} catch (ex) {
			Logger.error(ex);
		}
	}

	get isMaybeGuest() {
		return this._guest !== undefined || this._waitForReady !== undefined;
	}

	private _readonly: boolean = false;
	get readonly() {
		return this._readonly;
	}
	private setReadonly(value: boolean) {
		this._readonly = value;
		setCommandContext(CommandContext.Readonly, value ? true : undefined);
	}

	@debug()
	async getContact(email: string | undefined) {
		if (email === undefined) return undefined;

		const api = await this._api;
		if (api == null) return undefined;

		const contacts = await api.getContacts([email]);
		return contacts.contacts[email];
	}

	@debug({
		args: {
			0: (emails: string[]) => `length=${emails.length}`,
		},
	})
	async getContacts(emails: string[]) {
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

	@debug({
		args: {
			0: (emails: string[]) => `length=${emails.length}`,
		},
	})
	async getContactsPresence(emails: string[]): Promise<Map<string, ContactPresence> | undefined> {
		const contacts = await this.getContacts(emails);
		if (contacts == null) return undefined;

		return new Map<string, ContactPresence>(
			Object.values(contacts).map(c => [c.email, contactStatusToPresence(c.status)]),
		);
	}

	@debug()
	@timeout(250)
	maybeGetPresence(email: string | undefined) {
		return Container.vsls.getContactPresence(email);
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

	async guest() {
		if (this._waitForReady !== undefined) {
			await this._waitForReady;
			this._waitForReady = undefined;
		}

		return this._guest;
	}

	host() {
		return this._host;
	}

	private async onLiveShareSessionChanged(api: LiveShare, e: SessionChangeEvent) {
		if (this._host !== undefined) {
			this._host.dispose();
		}

		if (this._guest !== undefined) {
			this._guest.dispose();
		}

		switch (e.session.role) {
			case Role.Host:
				this.setReadonly(false);
				setCommandContext(CommandContext.Vsls, 'host');
				if (Container.config.liveshare.allowGuestAccess) {
					this._host = await VslsHostService.share(api);
				}
				break;
			case Role.Guest:
				this.setReadonly(true);
				setCommandContext(CommandContext.Vsls, 'guest');
				this._guest = await VslsGuestService.connect(api);
				break;

			default:
				this.setReadonly(false);
				setCommandContext(CommandContext.Vsls, true);
				break;
		}

		if (this._onReady !== undefined) {
			this._onReady();
			this._onReady = undefined;
		}
	}
}
