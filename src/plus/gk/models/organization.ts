import type { AIProviders } from '../../../constants.ai';

export interface Organization {
	readonly id: string;
	readonly name: string;
	readonly role: OrganizationRole;
}

export type OrganizationRole = 'owner' | 'admin' | 'billing' | 'user';

export type OrganizationsResponse = Organization[];

export type OrganizationMemberStatus = 'activated' | 'pending';

export interface OrganizationMember {
	readonly id: string;
	readonly email: string;
	readonly name: string;
	readonly username: string;
	readonly role: OrganizationRole;
	readonly status: OrganizationMemberStatus;
}

export interface OrganizationSettings {
	aiEnabled: boolean;
	enforceAiProviders: boolean;
	aiSettings: OrganizationSetting;
	aiProviders: GkDevAIProviders;
	draftsSettings: OrganizationDraftsSettings;
}

export interface OrganizationSetting {
	readonly enabled: boolean;
	readonly createdAt: string;
	readonly updatedAt: string;
}

export interface OrganizationDraftsSettings extends OrganizationSetting {
	readonly bucket:
		| {
				readonly name: string;
				readonly region: string;
				readonly provider: string;
		  }
		| undefined;
}

export type GkDevAIProviders = Partial<Record<GkDevAIProviderType, GkDevAIProvider>>;

export interface GkDevAIProvider {
	enabled: boolean;
	url?: string;
	key?: string;
}

export interface OrgAIProvider {
	readonly type: AIProviders;
	readonly enabled: boolean;
	readonly url?: string;
	readonly key?: string;
}

export type OrgAIProviders = Partial<Record<AIProviders, OrgAIProvider | undefined>>;
export interface OrgAIConfig {
	readonly aiEnabled: boolean;
	readonly enforceAiProviders: boolean;
	readonly aiProviders: OrgAIProviders;
}

export type GkDevAIProviderType =
	| 'anthropic'
	| 'azure'
	| 'deepseek'
	| 'github_copilot'
	| 'gitkraken_ai'
	| 'google'
	| 'huggingface'
	| 'mistral'
	| 'ollama'
	| 'openai'
	| 'openai_compatible'
	| 'openrouter'
	| 'xai';

export function fromGkDevAIProviderType(type: GkDevAIProviderType): AIProviders;
export function fromGkDevAIProviderType(type: Exclude<unknown, GkDevAIProviderType>): never;
export function fromGkDevAIProviderType(type: unknown): AIProviders | never {
	switch (type) {
		case 'anthropic':
			return 'anthropic';
		case 'azure':
			return 'azure';
		case 'deepseek':
			return 'deepseek';
		case 'github_copilot':
			return 'vscode';
		case 'gitkraken_ai':
			return 'gitkraken';
		case 'google':
			return 'gemini';
		case 'huggingface':
			return 'huggingface';
		case 'mistral':
			return 'mistral';
		case 'ollama':
			return 'ollama';
		case 'openai':
			return 'openai';
		case 'openai_compatible':
			return 'openaicompatible';
		case 'openrouter':
			return 'openrouter';
		case 'xai':
			return 'xai';
		default:
			throw new Error(`Unknown AI provider type: ${String(type)}`);
	}
}

function fromGkDevAIProvider(type: GkDevAIProviderType, provider: GkDevAIProvider): OrgAIProvider {
	return {
		type: fromGkDevAIProviderType(type),
		enabled: provider.enabled,
		url: provider.url,
		key: provider.key,
	};
}

export function fromGKDevAIProviders(providers?: GkDevAIProviders): OrgAIProviders {
	const result: OrgAIProviders = {};
	if (providers == null) return result;

	Object.entries(providers).forEach(([type, provider]) => {
		try {
			result[fromGkDevAIProviderType(type as GkDevAIProviderType)] = fromGkDevAIProvider(
				type as GkDevAIProviderType,
				provider,
			);
		} catch {
			// ignore invalid provider, continue with others
		}
	});
	return result;
}
