export interface AIProviderContext {
	defaultTemperature?: number;

	fetch(url: string | URL, init?: RequestInit): Promise<Response>;

	getApiKey(
		config: {
			id: string;
			name: string;
			requiresAccount: boolean;
			validator?: (value: string) => boolean;
			url?: string;
		},
		silent: boolean,
	): Promise<string | undefined>;

	getProviderConfig(type: string): { enabled: boolean; key?: string; url?: string };

	getOrPromptUrl(
		providerId: string,
		options: {
			currentUrl: string | undefined;
			title: string;
			placeholder: string;
			validator?: (url: string) => string | undefined | Promise<string | undefined>;
		},
		silent: boolean,
	): Promise<string | undefined>;
}
