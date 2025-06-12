import { createHash } from 'crypto';
import { networkInterfaces } from 'os';

// Sourced from GKD
const knownBadAppIds = [
	// this appId corresponds to the 'iBridge Adapter for the Touchbar' on macbooks
	// https://github.com/bevry/getmac/issues/42
	// https://discussions.apple.com/thread/7763102
	// discovered 3/21/23 with ~28,000 unique users
	'8149453d12fde3c987f5ceb011360abe56307d17', // sha1('ac:de:48:00:11:22')

	// these appIds correspond to the default VMWARE vnet1 and vmnet8 interface mac address
	// https://communities.vmware.com/t5/VMware-Workstation-Pro/Why-are-MAC-addresses-for-vmnet1-and-vmnet8-hardcoded/td-p/1580213
	// discovered 3/21/23 with 10250 unique users
	'a76a6cbfb93cbb6daa4c4836544564fb777a0803', // sha1('00-50-56-C0-00-01')
	// discovered 3/22/23 with 3473 unique users
	'4433e1caaca0b97ba94ef3e0772e5931f792fa9b', // sha1('00-50-56-C0-00-08')

	// this appId corresponds to the "Forticlient VPN client" adapter mac address
	// https://community.fortinet.com/t5/Support-Forum/FortiClient-MAC-Address/m-p/60724
	// discovered 3/21/23 with 5655 unique users
	'b14e824ad9cd8a3e95493d48e6132ecce40e0e47', // sha1('00-09-0F-FE-00-01')
];

// Sourced from https://github.com/bevry/getmac/blob/master/source/index.ts
// There's issues with importing 'getmac' directly, so we referenced the relevant code here

const zeroRegex = /(?:[0]{1,2}[:-]){5}[0]{1,2}/;
export function getMac(): string | undefined {
	const list = networkInterfaces();

	for (const parts of Object.values(list)) {
		// for some reason beyond me, this is needed to satisfy typescript
		// fix https://github.com/bevry/getmac/issues/100
		if (!parts) continue;
		for (const part of parts) {
			if (zeroRegex.test(part.mac) === false) {
				const appId = sha1(part.mac);
				if (appId != null && !knownBadAppIds.includes(appId)) {
					return appId;
				}
			}
		}
	}
	return undefined;
}

function sha1(data: string): string | undefined {
	return createHash('sha1').update(data, 'utf8').digest('hex');
}
