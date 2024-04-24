export interface ProviderReference {
	readonly id: string;
	readonly name: string;
	readonly domain: string;
	readonly icon: string;
}

export interface Provider extends ProviderReference {
	getIgnoreSSLErrors(): boolean | 'force';
	reauthenticate(): Promise<void>;
	trackRequestException(): void;
}
