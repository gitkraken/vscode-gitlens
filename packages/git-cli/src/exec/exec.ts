export {
	CancelledRunError,
	findExecutable,
	fsExists,
	getWindowsShortPath,
	run,
	RunError,
	runSpawn,
} from '@gitlens/utils/env/node/exec.js';
export type { RunExitResult, RunOptions, RunResult } from '@gitlens/utils/env/node/exec.js';
export { isWindows } from '@gitlens/utils/env/node/platform.js';
