import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { gunzipSync } from 'node:zlib';

/** Extracts the regular files and directories emitted by `pnpm pack`. */
export async function extractTarGz(tarball, destination) {
	const archive = gunzipSync(await readFile(tarball));
	for (let offset = 0; offset + 512 <= archive.length;) {
		const header = archive.subarray(offset, offset + 512);
		const name = readTarString(header, 0, 100);
		if (name.length === 0) return;

		const prefix = readTarString(header, 345, 155);
		const relativePath = prefix.length === 0 ? name : `${prefix}/${name}`;
		const size = Number.parseInt(readTarString(header, 124, 12).trim() || '0', 8);
		const type = String.fromCharCode(header[156]);
		const target = join(destination, relativePath);
		offset += 512;

		if (type === '5') {
			await mkdir(target, { recursive: true });
		} else if (type === '0' || type === '\0') {
			await mkdir(dirname(target), { recursive: true });
			await writeFile(target, archive.subarray(offset, offset + size));
		}

		offset += Math.ceil(size / 512) * 512;
	}
}

function readTarString(buffer, offset, length) {
	const end = buffer.indexOf(0, offset);
	const limit = end === -1 || end > offset + length ? offset + length : end;
	return new TextDecoder().decode(buffer.subarray(offset, limit));
}
