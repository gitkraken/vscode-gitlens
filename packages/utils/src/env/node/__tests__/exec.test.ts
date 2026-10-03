import * as assert from 'assert';
import * as process from 'process';
import { CancelledRunError, run, RunError, runSpawn } from '../exec.js';

// Far past any OS pipe buffer, so the write is still in flight when the child goes away
const largeInput = Buffer.alloc(32 * 1024 * 1024, 'x');

const exitsWithoutReading = ['-e', 'process.exit(3)'];
const neverReads = ['-e', 'process.stdin.pause(); setTimeout(() => {}, 30000)'];

suite('Exec stdin Test Suite', () => {
	test('runSpawn rejects with the exit code when the child exits before reading its input', async () => {
		await assert.rejects(
			runSpawn(process.execPath, exitsWithoutReading, 'utf8', { stdin: largeInput }),
			(ex: unknown) => ex instanceof RunError && ex.code === 3,
		);
	});

	test('run rejects with the exit code when the child exits before reading its input', async () => {
		await assert.rejects(
			run(process.execPath, exitsWithoutReading, 'utf8', { stdin: largeInput }),
			(ex: unknown) => ex instanceof RunError && ex.code === 3,
		);
	});

	test('runSpawn rejects as cancelled when cancelled while its input is still being written', async () => {
		const controller = new AbortController();
		const promise = runSpawn(process.execPath, neverReads, 'utf8', {
			stdin: largeInput,
			cancellation: controller.signal,
		});
		setTimeout(() => controller.abort(), 100);
		await assert.rejects(promise, (ex: unknown) => ex instanceof CancelledRunError);
	});

	test('run rejects as cancelled when cancelled while its input is still being written', async () => {
		const controller = new AbortController();
		const promise = run(process.execPath, neverReads, 'utf8', {
			stdin: largeInput,
			cancellation: controller.signal,
		});
		setTimeout(() => controller.abort(), 100);
		await assert.rejects(promise, (ex: unknown) => ex instanceof RunError);
	});
});
