export interface GitLabCommit {
	id: string;
	short_id: string;
	created_at: Date;
	parent_ids: string[];
	title: string;
	message: string;
	author_name: string;
	author_email: string;
	authored_date: Date;
	committer_name: string;
	committer_email: string;
	committed_date: Date;
	stats: GitLabCommitStats;
	status: string;
	project_id: number;
	last_pipeline: GitLabPipeline;
}

export interface GitLabCommitStats {
	additions: number;
	deletions: number;
	total: number;
}

export interface GitLabPipeline {
	id: number;
	sha: string;
	ref: string;
	status: string;
	created_at: Date;
	updated_at: Date;
	web_url: string;
}
