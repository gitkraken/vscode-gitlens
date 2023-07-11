export type LocalRepoDataMap = Record<
	string /* key can be remote url, provider/owner/name, or first commit SHA*/,
	RepoLocalData
>;

export interface RepoLocalData {
	paths: string[];
	name?: string;
	hostName?: string;
	owner?: string;
	hostingServiceType?: string;
}
