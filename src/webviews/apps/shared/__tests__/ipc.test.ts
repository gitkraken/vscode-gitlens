import * as assert from 'assert';
import { URI } from 'vscode-uri';
import { deserializeIpcData } from '../../../../system/ipcSerialize';
import type { IpcPromise } from '../../../ipc';

suite('IPC Deserialization Test Suite', () => {
	suite('deserializeIpcData (pure function)', () => {
		const mockPromiseFactory = (_value: IpcPromise['value']): Promise<unknown> => Promise.resolve();

		test('should be exported and callable', () => {
			assert.strictEqual(typeof deserializeIpcData, 'function');
		});

		suite('IpcDate deserialization', () => {
			test('should deserialize IpcDate to Date', () => {
				const timestamp = new Date('2024-01-15T10:30:00.000Z').getTime();
				const input = {
					date: { __ipc: 'date', value: timestamp },
				};
				const jsonString = JSON.stringify(input);

				const result: any = deserializeIpcData(jsonString, mockPromiseFactory);

				assert.ok(result.date instanceof Date);
				assert.strictEqual(result.date.getTime(), timestamp);
			});

			test('should deserialize nested IpcDate objects', () => {
				const timestamp1 = new Date('2024-01-15T10:30:00.000Z').getTime();
				const timestamp2 = new Date('2024-01-16T14:45:00.000Z').getTime();
				const input = {
					commit: {
						author: {
							name: 'John Doe',
							date: { __ipc: 'date', value: timestamp1 },
						},
						committer: {
							name: 'Jane Doe',
							date: { __ipc: 'date', value: timestamp2 },
						},
					},
				};
				const jsonString = JSON.stringify(input);

				const result: any = deserializeIpcData(jsonString, mockPromiseFactory);

				assert.ok(result.commit.author.date instanceof Date);
				assert.strictEqual(result.commit.author.date.getTime(), timestamp1);
				assert.ok(result.commit.committer.date instanceof Date);
				assert.strictEqual(result.commit.committer.date.getTime(), timestamp2);
			});

			test('should deserialize array of IpcDate objects', () => {
				const timestamps = [
					new Date('2024-01-15T10:30:00.000Z').getTime(),
					new Date('2024-01-16T14:45:00.000Z').getTime(),
					new Date('2024-01-17T08:15:00.000Z').getTime(),
				];
				const input = {
					dates: timestamps.map(t => ({ __ipc: 'date', value: t })),
				};
				const jsonString = JSON.stringify(input);

				const result: any = deserializeIpcData(jsonString, mockPromiseFactory);

				assert.strictEqual(result.dates.length, 3);
				result.dates.forEach((date: Date, index: number) => {
					assert.ok(date instanceof Date);
					assert.strictEqual(date.getTime(), timestamps[index]);
				});
			});
		});

		suite('IpcUri deserialization', () => {
			test('should deserialize IpcUri to URI', () => {
				const input = {
					uri: {
						__ipc: 'uri',
						value: {
							scheme: 'file',
							authority: '',
							path: '/path/to/file.ts',
							query: '',
							fragment: '',
						},
					},
				};
				const jsonString = JSON.stringify(input);

				const result: any = deserializeIpcData(jsonString, mockPromiseFactory);

				assert.ok(URI.isUri(result.uri));
				assert.strictEqual(result.uri.scheme, 'file');
				assert.strictEqual(result.uri.path, '/path/to/file.ts');
			});

			test('should deserialize IpcUri with all components', () => {
				const input = {
					uri: {
						__ipc: 'uri',
						value: {
							scheme: 'https',
							authority: 'example.com:8080',
							path: '/path/to/file',
							query: 'query=value',
							fragment: 'fragment',
						},
					},
				};
				const jsonString = JSON.stringify(input);

				const result: any = deserializeIpcData(jsonString, mockPromiseFactory);

				assert.ok(URI.isUri(result.uri));
				assert.strictEqual(result.uri.scheme, 'https');
				assert.strictEqual(result.uri.authority, 'example.com:8080');
				assert.strictEqual(result.uri.path, '/path/to/file');
				assert.strictEqual(result.uri.query, 'query=value');
				assert.strictEqual(result.uri.fragment, 'fragment');
			});
		});

		suite('IpcPromise deserialization', () => {
			test('should deserialize IpcPromise to Promise', () => {
				const input = {
					promise: {
						__ipc: 'promise',
						value: {
							id: 'test-id-1',
							method: 'core/ipc/promise/settled',
						},
					},
				};
				const jsonString = JSON.stringify(input);

				const result: any = deserializeIpcData(jsonString, mockPromiseFactory);

				assert.ok(result.promise instanceof Promise);
			});
		});

		suite('Mixed types deserialization', () => {
			test('should deserialize object with multiple IPC types', () => {
				const timestamp = new Date('2024-01-15T10:30:00.000Z').getTime();
				const input = {
					date: { __ipc: 'date', value: timestamp },
					uri: {
						__ipc: 'uri',
						value: {
							scheme: 'file',
							authority: '',
							path: '/path/to/file.ts',
							query: '',
							fragment: '',
						},
					},
					promise: {
						__ipc: 'promise',
						value: {
							id: 'test-id-1',
							method: 'core/ipc/promise/settled',
						},
					},
					normal: 'string',
					number: 42,
					boolean: true,
				};
				const jsonString = JSON.stringify(input);

				const result: any = deserializeIpcData(jsonString, mockPromiseFactory);

				assert.ok(result.date instanceof Date);
				assert.ok(URI.isUri(result.uri));
				assert.ok(result.promise instanceof Promise);
				assert.strictEqual(result.normal, 'string');
				assert.strictEqual(result.number, 42);
				assert.strictEqual(result.boolean, true);
			});
		});

		suite('Edge cases', () => {
			test('should handle empty object', () => {
				const input = {};
				const jsonString = JSON.stringify(input);

				const result: any = deserializeIpcData(jsonString, mockPromiseFactory);

				assert.deepStrictEqual(result, {});
			});

			test('should handle primitive values', () => {
				const input = {
					string: 'test',
					number: 42,
					boolean: true,
					null: null,
				};
				const jsonString = JSON.stringify(input);

				const result: any = deserializeIpcData(jsonString, mockPromiseFactory);

				assert.strictEqual(result.string, 'test');
				assert.strictEqual(result.number, 42);
				assert.strictEqual(result.boolean, true);
				assert.strictEqual(result.null, null);
			});

			test('should handle JSON string input', () => {
				const timestamp = new Date('2024-01-15T10:30:00.000Z').getTime();
				const jsonString = JSON.stringify({
					date: { __ipc: 'date', value: timestamp },
					value: 'test',
				});

				const result: any = deserializeIpcData(jsonString, mockPromiseFactory);

				assert.ok(result.date instanceof Date);
				assert.strictEqual(result.date.getTime(), timestamp);
				assert.strictEqual(result.value, 'test');
			});
		});
	});
});
