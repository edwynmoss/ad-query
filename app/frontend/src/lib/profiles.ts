// Connection-profile metadata, stored in localStorage. The password is NOT
// stored here — it lives in the Windows Credential Manager (see App.StoreSecret
// / GetSecret), keyed by the profile name.

export interface ConnectionProfile {
  name: string;
  host: string;
  port: number;
  encryption: string;
  bindDN: string;
  insecureSkipVerify: boolean;
}

const KEY = "adquery.profiles";

export function loadProfiles(): ConnectionProfile[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function persist(list: ConnectionProfile[]) {
  localStorage.setItem(KEY, JSON.stringify(list));
}

export function saveProfile(p: ConnectionProfile): ConnectionProfile[] {
  const list = loadProfiles();
  const i = list.findIndex((x) => x.name.toLowerCase() === p.name.toLowerCase());
  if (i >= 0) list[i] = p;
  else list.push(p);
  persist(list);
  return list;
}

export function deleteProfile(name: string): ConnectionProfile[] {
  const list = loadProfiles().filter((p) => p.name !== name);
  persist(list);
  return list;
}
