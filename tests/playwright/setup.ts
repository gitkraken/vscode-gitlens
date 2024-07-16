import { downloadAndUnzipVSCode } from '@vscode/test-electron';

export default async () => {
	await downloadAndUnzipVSCode('insiders');
	await downloadAndUnzipVSCode('stable');
};
