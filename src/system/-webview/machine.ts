import { env } from 'vscode';
import { getMac } from '@env/machine';
import { isWeb } from '@env/platform';

export function getMachineId(): string {
	if (isWeb) {
		return env.machineId;
	}
	return getMac() ?? env.machineId;
}
