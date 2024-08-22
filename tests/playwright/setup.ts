import { downloadAndUnzipVSCode } from '@vscode/test-electron/out/download';

export default async () => {
	await downloadAndUnzipVSCode('insiders');
	await downloadAndUnzipVSCode('stable');
};
