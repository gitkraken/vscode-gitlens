import type { Container } from '../../../container';
import { GitFileChange } from '../../models/fileChange';

export function mapFilesWithStats(
	container: Container,
	files: GitFileChange[],
	filesWithStats: GitFileChange[],
): GitFileChange[] {
	return files.map(file => {
		const stats = filesWithStats.find(f => f.path === file.path)?.stats;
		return stats != null
			? new GitFileChange(
					container,
					file.repoPath,
					file.path,
					file.status,
					file.originalPath,
					file.previousSha,
					stats,
					file.staged,
			  )
			: file;
	});
}
