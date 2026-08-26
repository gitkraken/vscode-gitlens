import type { Disposable } from '@gitlens/utils/disposable.js';
import { createDisposable } from '@gitlens/utils/disposable.js';
import { Logger } from '@gitlens/utils/logger.js';
import type { ResourceUsage, ResourceUsageMetric } from '@gitlens/utils/resourceUsage.js';

type ResourceUsageProvider = () => Readonly<ResourceUsage>;

export class ResourceUsageRegistry implements Disposable {
	private readonly providers = new Map<string, ResourceUsageProvider>();

	dispose(): void {
		this.providers.clear();
	}

	register(namespace: string, provider: ResourceUsageProvider): Disposable {
		if (this.providers.has(namespace)) {
			throw new Error(`Resource usage provider '${namespace}' is already registered`);
		}

		this.providers.set(namespace, provider);
		return createDisposable(() => {
			if (this.providers.get(namespace) === provider) {
				this.providers.delete(namespace);
			}
		});
	}

	collect(): ResourceUsage {
		const usage: ResourceUsage = {};
		for (const [namespace, provider] of this.providers) {
			try {
				for (const [key, value] of Object.entries(provider()) as [ResourceUsageMetric, number | undefined][]) {
					const metric = `${namespace}.${key}` as ResourceUsageMetric;
					usage[metric] = value;
				}
			} catch (ex) {
				Logger.error(ex, `ResourceUsageRegistry.collect(${namespace})`);
			}
		}

		return usage;
	}
}
