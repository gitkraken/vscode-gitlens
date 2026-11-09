export {
	CancelledRunError,
	endStdin,
	findExecutable,
	fsExists,
	run,
	RunError,
	runSpawn,
} from '@gitlens/utils/env/node/exec.js';
export type {
	ProcessSpawner,
	ProcessSpawnOptions,
	RunExitResult,
	RunOptions,
	RunResult,
	SpawnedProcess,
} from '@gitlens/utils/env/node/exec.js';
export { isWindows } from '@gitlens/utils/env/node/platform.js';
