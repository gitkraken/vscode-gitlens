import type { AIProviders } from '@gitlens/ai/constants.js';
import type { AIProviderDescriptor } from '@gitlens/ai/models/model.js';
import type { AIProvider } from '@gitlens/ai/models/provider.js';
import type { AIProviderContext } from '@gitlens/ai/providers/context.js';
import type { Lazy } from '@gitlens/utils/lazy.js';

export interface AIProviderConstructor<Provider extends AIProviders = AIProviders> {
	new (context: AIProviderContext): AIProvider<Provider>;
}

export interface AIProviderDescriptorWithType<T extends AIProviders = AIProviders> extends Omit<
	AIProviderDescriptor<T>,
	'type'
> {
	readonly type: Lazy<Promise<AIProviderConstructor<T>>>;
}
