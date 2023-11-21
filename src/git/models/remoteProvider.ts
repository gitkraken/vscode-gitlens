export interface RemoteProviderReference {
	readonly id: string;
	readonly name: string;
	readonly domain: string;
	readonly icon: string;
}

export interface Provider extends RemoteProviderReference {
	getIgnoreSSLErrors(): boolean | 'force';
	reauthenticate(): Promise<void>;
	trackRequestException(): void;
}
