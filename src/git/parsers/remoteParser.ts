'use strict';
import { GitRemote } from './../git';
import { GitRemoteType } from '../models/remote';
import { RemoteProvider } from '../remotes/factory';

const remoteRegex = /^(.*)\t(.*)\s\((.*)\)$/gm;
const urlRegex = /^(?:(git:\/\/)(.*?)\/|(https?:\/\/)(?:.*?@)?(.*?)\/|git@(.*):|(ssh:\/\/)(?:.*@)?(.*?)(?::.*?)?\/|(?:.*?@)(.*?):)(.*)$/;

// Test git urls
/*
http://host.xz/user/project.git
http://host.xz/path/to/repo.git
http://host.xz/path/to/repo.git/
http://username@host.xz/user/project.git
http://username:password@host.xz/user/project.git
https://host.xz/user/project.git
https://host.xz/path/to/repo.git
https://host.xz/path/to/repo.git/
https://username@host.xz/user/project.git
https://username:password@host.xz/user/project.git

git@host.xz:user/project.git
git://host.xz/path/to/repo.git/
git://host.xz/~user/path/to/repo.git/

ssh://host.xz/project.git
ssh://host.xz/path/to/repo.git
ssh://host.xz/path/to/repo.git/
ssh://host.xz:port/path/to/repo.git/
ssh://user@host.xz/project.git
ssh://user@host.xz/path/to/repo.git
ssh://user@host.xz/path/to/repo.git/
ssh://user@host.xz:port/path/to/repo.git/
ssh://user:password@host.xz/project.git
ssh://user:password@host.xz/path/to/repo.git
ssh://user:password@host.xz/path/to/repo.git/

user@host.xz:project.git
user@host.xz:path/to/repo.git
user@host.xz:/path/to/repo.git/
user:password@host.xz:project.git
user:password@host.xz:/path/to/repo.git
user:password@host.xz:/path/to/repo.git/
*/

export class GitRemoteParser {

    static parse(data: string, repoPath: string, providerFactory: (domain: string, path: string) => RemoteProvider | undefined): GitRemote[] {
        if (!data) return [];

        const remotes: GitRemote[] = [];
        const groups = Object.create(null);

        let match: RegExpExecArray | null = null;
        do {
            match = remoteRegex.exec(data);
            if (match == null) break;

            const url = match[2];

            const [scheme, domain, path] = this.parseGitUrl(url);

            const uniqueness = `${domain}/${path}`;
            let remote: GitRemote | undefined = groups[uniqueness];
            if (remote === undefined) {
                remote = new GitRemote(repoPath, match[1], scheme, domain, path, providerFactory(domain, path), [{ url: url, type: match[3] as GitRemoteType }]);
                remotes.push(remote);
                groups[uniqueness] = remote;
            }
            else {
                remote.types.push({ url: url, type: match[3] as GitRemoteType });
            }
        } while (match != null);

        if (!remotes.length) return [];

        return remotes;
    }

    static parseGitUrl(url: string): [string, string, string] {
        const match = urlRegex.exec(url);
        if (match == null) return ['', '', ''];

        return [
            match[1] || match[3] || match[6],
            match[2] || match[4] || match[5] || match[7] || match[8],
            match[9].replace(/\.git\/?$/, '')
        ];
    }
}