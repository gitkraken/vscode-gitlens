import { CancellationToken, Disposable, Event, TreeDataProvider, Uri } from 'vscode';

export interface LiveShareExtension {
	getApi(version: string): Promise<LiveShare | null>;
}

export interface LiveShare {
	readonly session: Session;
	readonly onDidChangeSession: Event<SessionChangeEvent>;

	share(options?: ShareOptions): Promise<Uri | null>;
	shareService(name: string): Promise<SharedService | null>;
	unshareService(name: string): Promise<void>;
	getSharedService(name: string): Promise<SharedServiceProxy | null>;
	convertLocalUriToShared(localUri: Uri): Uri;
	convertSharedUriToLocal(sharedUri: Uri): Uri;
	getContacts(emails: string[]): Promise<Contacts>;
}

export const enum Access {
	None = 0,
	ReadOnly = 1,
	ReadWrite = 3,
	Owner = 0xff,
}

export const enum Role {
	None = 0,
	Host = 1,
	Guest = 2,
}

export interface Session {
	readonly id: string | null;
	readonly role: Role;
	readonly access: Access;
}

export interface SessionChangeEvent {
	readonly session: Session;
}

export interface Contact {
	readonly onDidChange: Event<string[]>;
	readonly id: string;
	readonly email: string;
	readonly displayName?: string;
	readonly status?: string;
	readonly avatarUri?: string;

	invite(options?: ContactInviteOptions): Promise<boolean>;
}

export interface Contacts {
	readonly contacts: { [email: string]: Contact };
	dispose(): Promise<void>;
}

export interface ContactInviteOptions {
	useEmail?: boolean;
}

export interface SharedService {
	readonly isServiceAvailable: boolean;
	readonly onDidChangeIsServiceAvailable: Event<boolean>;

	onRequest(name: string, handler: RequestHandler): void;
	onNotify(name: string, handler: NotifyHandler): void;
	notify(name: string, args: object): void;
}

export interface SharedServiceProxy {
	readonly isServiceAvailable: boolean;
	readonly onDidChangeIsServiceAvailable: Event<boolean>;

	onNotify(name: string, handler: NotifyHandler): void;
	request<T>(name: string, args: any[], cancellation?: CancellationToken): Promise<T>;
	notify(name: string, args: object): void;
}

export interface SharedServiceProxyError extends Error {}

export interface SharedServiceResponseError extends Error {
	remoteStack?: string;
}

export interface RequestHandler {
	(args: any[], cancellation: CancellationToken): any | Promise<any>;
}

export interface NotifyHandler {
	(args: object): void;
}
