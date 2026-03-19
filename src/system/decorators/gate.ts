import type { GateOptions } from '@gitlens/utils/decorators/gate.js';
import { gate as _gate } from '@gitlens/utils/decorators/gate.js';

export type { GateOptions } from '@gitlens/utils/decorators/gate.js';

export function gate<T extends (...args: any[]) => any>(
	getGroupingKey?: (...args: Parameters<T>) => string,
	options?: GateOptions,
): (_target: any, key: string, descriptor: TypedPropertyDescriptor<T>) => void {
	return _gate<T>(getGroupingKey, {
		...options,
		onDeadlock: async info => {
			options?.onDeadlock?.(info);
			// Lazy import to avoid circular dependency: gate.ts → providers.ts → vslsGitProvider.ts → gate.ts
			const { getTelementryService } = await import(/* webpackChunkName: "__lazy__" */ '@env/providers.js');
			getTelementryService()?.sendEvent('op/gate/deadlock', info);
		},
	});
}
