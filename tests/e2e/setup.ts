import { downloadAndUnzipVSCode } from '@vscode/test-electron';

// eslint-disable-next-line import-x/no-default-export
export default async (): Promise<void> => {
	await downloadAndUnzipVSCode('insiders');
	await downloadAndUnzipVSCode('stable');
};
