export namespace adtypes {
	
	export class ACE {
	    type: string;
	    allow: boolean;
	    flags: number;
	    mask: number;
	    rights: string[];
	    sid: string;
	    trustee: string;
	    objectType: string;
	
	    static createFrom(source: any = {}) {
	        return new ACE(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.type = source["type"];
	        this.allow = source["allow"];
	        this.flags = source["flags"];
	        this.mask = source["mask"];
	        this.rights = source["rights"];
	        this.sid = source["sid"];
	        this.trustee = source["trustee"];
	        this.objectType = source["objectType"];
	    }
	}
	export class SecurityDescriptor {
	    owner: string;
	    group: string;
	    dacl: ACE[];
	
	    static createFrom(source: any = {}) {
	        return new SecurityDescriptor(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.owner = source["owner"];
	        this.group = source["group"];
	        this.dacl = this.convertValues(source["dacl"], ACE);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace gpo {
	
	export class Policy {
	    dn: string;
	    guid: string;
	    name: string;
	    version: number;
	    path: string;
	    userDisabled: boolean;
	    computerDisabled: boolean;
	    wmiFilter: string;
	    wmiFilterName: string;
	    applyAllow: string[];
	    applyDeny: string[];
	    aclKnown: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Policy(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dn = source["dn"];
	        this.guid = source["guid"];
	        this.name = source["name"];
	        this.version = source["version"];
	        this.path = source["path"];
	        this.userDisabled = source["userDisabled"];
	        this.computerDisabled = source["computerDisabled"];
	        this.wmiFilter = source["wmiFilter"];
	        this.wmiFilterName = source["wmiFilterName"];
	        this.applyAllow = source["applyAllow"];
	        this.applyDeny = source["applyDeny"];
	        this.aclKnown = source["aclKnown"];
	    }
	}
	export class Entry {
	    precedence: number;
	    policy: Policy;
	    somDN: string;
	    somKind: string;
	    somName: string;
	    enforced: boolean;
	    verdict: string;
	    reason: string;
	    wmiUnknown: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Entry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.precedence = source["precedence"];
	        this.policy = this.convertValues(source["policy"], Policy);
	        this.somDN = source["somDN"];
	        this.somKind = source["somKind"];
	        this.somName = source["somName"];
	        this.enforced = source["enforced"];
	        this.verdict = source["verdict"];
	        this.reason = source["reason"];
	        this.wmiUnknown = source["wmiUnknown"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Link {
	    policyDN: string;
	    enforced: boolean;
	    disabled: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Link(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.policyDN = source["policyDN"];
	        this.enforced = source["enforced"];
	        this.disabled = source["disabled"];
	    }
	}
	export class SOM {
	    dn: string;
	    kind: string;
	    name: string;
	    links: Link[];
	    blockInheritance: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SOM(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dn = source["dn"];
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.links = this.convertValues(source["links"], Link);
	        this.blockInheritance = source["blockInheritance"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Chain {
	    targetDN: string;
	    targetKind: string;
	    path: SOM[];
	    entries: Entry[];
	    notes: string[];
	    names: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new Chain(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.targetDN = source["targetDN"];
	        this.targetKind = source["targetKind"];
	        this.path = this.convertValues(source["path"], SOM);
	        this.entries = this.convertValues(source["entries"], Entry);
	        this.notes = source["notes"];
	        this.names = source["names"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Change {
	    kind: string;
	    policyDN: string;
	    containerDN: string;
	
	    static createFrom(source: any = {}) {
	        return new Change(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.kind = source["kind"];
	        this.policyDN = source["policyDN"];
	        this.containerDN = source["containerDN"];
	    }
	}
	export class Effect {
	    containerDN: string;
	    name: string;
	    kind: string;
	    loses: string[];
	    gains: string[];
	    reordered: string[];
	    users: number;
	    computers: number;
	    root: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Effect(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.containerDN = source["containerDN"];
	        this.name = source["name"];
	        this.kind = source["kind"];
	        this.loses = source["loses"];
	        this.gains = source["gains"];
	        this.reordered = source["reordered"];
	        this.users = source["users"];
	        this.computers = source["computers"];
	        this.root = source["root"];
	    }
	}
	
	export class LinkPlace {
	    somDN: string;
	    somKind: string;
	    somName: string;
	    enforced: boolean;
	    disabled: boolean;
	    order: number;
	
	    static createFrom(source: any = {}) {
	        return new LinkPlace(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.somDN = source["somDN"];
	        this.somKind = source["somKind"];
	        this.somName = source["somName"];
	        this.enforced = source["enforced"];
	        this.disabled = source["disabled"];
	        this.order = source["order"];
	    }
	}
	export class PolicyLinks {
	    policy: Policy;
	    links: LinkPlace[];
	
	    static createFrom(source: any = {}) {
	        return new PolicyLinks(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.policy = this.convertValues(source["policy"], Policy);
	        this.links = this.convertValues(source["links"], LinkPlace);
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Inventory {
	    policies: PolicyLinks[];
	    notes: string[];
	    names: Record<string, string>;
	
	    static createFrom(source: any = {}) {
	        return new Inventory(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.policies = this.convertValues(source["policies"], PolicyLinks);
	        this.notes = source["notes"];
	        this.names = source["names"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	export class MapNode {
	    dn: string;
	    parentDN: string;
	    kind: string;
	    name: string;
	    links: Link[];
	    blockInheritance: boolean;
	    relevant: boolean;
	
	    static createFrom(source: any = {}) {
	        return new MapNode(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dn = source["dn"];
	        this.parentDN = source["parentDN"];
	        this.kind = source["kind"];
	        this.name = source["name"];
	        this.links = this.convertValues(source["links"], Link);
	        this.blockInheritance = source["blockInheritance"];
	        this.relevant = source["relevant"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Map {
	    nodes: MapNode[];
	    policies: Record<string, Policy>;
	    names: Record<string, string>;
	    notes: string[];
	
	    static createFrom(source: any = {}) {
	        return new Map(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.nodes = this.convertValues(source["nodes"], MapNode);
	        this.policies = this.convertValues(source["policies"], Policy, true);
	        this.names = source["names"];
	        this.notes = source["notes"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	
	
	
	
	export class WhatIf {
	    change: Change;
	    description: string;
	    users: Effect[];
	    computers: Effect[];
	    notes: string[];
	
	    static createFrom(source: any = {}) {
	        return new WhatIf(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.change = this.convertValues(source["change"], Change);
	        this.description = source["description"];
	        this.users = this.convertValues(source["users"], Effect);
	        this.computers = this.convertValues(source["computers"], Effect);
	        this.notes = source["notes"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}

}

export namespace ldap {
	
	export class ConnectOptions {
	    host: string;
	    port: number;
	    encryption: string;
	    bindDN: string;
	    password: string;
	    insecureSkipVerify: boolean;
	    timeoutSeconds: number;
	    auth: string;
	    realm: string;
	    kdc: string;
	    servicePrincipal: string;
	
	    static createFrom(source: any = {}) {
	        return new ConnectOptions(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.host = source["host"];
	        this.port = source["port"];
	        this.encryption = source["encryption"];
	        this.bindDN = source["bindDN"];
	        this.password = source["password"];
	        this.insecureSkipVerify = source["insecureSkipVerify"];
	        this.timeoutSeconds = source["timeoutSeconds"];
	        this.auth = source["auth"];
	        this.realm = source["realm"];
	        this.kdc = source["kdc"];
	        this.servicePrincipal = source["servicePrincipal"];
	    }
	}
	export class DCLastLogon {
	    dc: string;
	    reachable: boolean;
	    lastLogon: string;
	    error?: string;
	
	    static createFrom(source: any = {}) {
	        return new DCLastLogon(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dc = source["dc"];
	        this.reachable = source["reachable"];
	        this.lastLogon = source["lastLogon"];
	        this.error = source["error"];
	    }
	}
	export class Entry {
	    dn: string;
	    attributes: Record<string, Array<string>>;
	
	    static createFrom(source: any = {}) {
	        return new Entry(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dn = source["dn"];
	        this.attributes = source["attributes"];
	    }
	}
	export class LastLogonReport {
	    dn: string;
	    accurateLastLogon: string;
	    sourceDC: string;
	    lastLogonTimestamp: string;
	    queriedDCs: number;
	    reachedDCs: number;
	    perDC: DCLastLogon[];
	    confidence: string;
	    note: string;
	
	    static createFrom(source: any = {}) {
	        return new LastLogonReport(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dn = source["dn"];
	        this.accurateLastLogon = source["accurateLastLogon"];
	        this.sourceDC = source["sourceDC"];
	        this.lastLogonTimestamp = source["lastLogonTimestamp"];
	        this.queriedDCs = source["queriedDCs"];
	        this.reachedDCs = source["reachedDCs"];
	        this.perDC = this.convertValues(source["perDC"], DCLastLogon);
	        this.confidence = source["confidence"];
	        this.note = source["note"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class SearchRequest {
	    baseDN: string;
	    scope: number;
	    filter: string;
	    attributes: string[];
	    pageSize: number;
	    sizeLimit: number;
	    sdFlags: number;
	
	    static createFrom(source: any = {}) {
	        return new SearchRequest(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.baseDN = source["baseDN"];
	        this.scope = source["scope"];
	        this.filter = source["filter"];
	        this.attributes = source["attributes"];
	        this.pageSize = source["pageSize"];
	        this.sizeLimit = source["sizeLimit"];
	        this.sdFlags = source["sdFlags"];
	    }
	}
	export class SearchResult {
	    entries: Entry[];
	    count: number;
	    truncated: boolean;
	
	    static createFrom(source: any = {}) {
	        return new SearchResult(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.entries = this.convertValues(source["entries"], Entry);
	        this.count = source["count"];
	        this.truncated = source["truncated"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class ServerInfo {
	    defaultNamingContext: string;
	    namingContexts: string[];
	    supportedControls: string[];
	    supportedSASLMechanisms: string[];
	    vendorName: string;
	    vendorVersion: string;
	    isActiveDirectory: boolean;
	
	    static createFrom(source: any = {}) {
	        return new ServerInfo(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.defaultNamingContext = source["defaultNamingContext"];
	        this.namingContexts = source["namingContexts"];
	        this.supportedControls = source["supportedControls"];
	        this.supportedSASLMechanisms = source["supportedSASLMechanisms"];
	        this.vendorName = source["vendorName"];
	        this.vendorVersion = source["vendorVersion"];
	        this.isActiveDirectory = source["isActiveDirectory"];
	    }
	}

}

export namespace m365 {
	
	export class DeviceCode {
	    device_code: string;
	    user_code: string;
	    verification_uri: string;
	    expires_in: number;
	    interval: number;
	    message: string;
	
	    static createFrom(source: any = {}) {
	        return new DeviceCode(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.device_code = source["device_code"];
	        this.user_code = source["user_code"];
	        this.verification_uri = source["verification_uri"];
	        this.expires_in = source["expires_in"];
	        this.interval = source["interval"];
	        this.message = source["message"];
	    }
	}
	export class LicenseSku {
	    product: string;
	    skuPartNumber: string;
	    purchased: number;
	    assigned: number;
	    available: number;
	
	    static createFrom(source: any = {}) {
	        return new LicenseSku(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.product = source["product"];
	        this.skuPartNumber = source["skuPartNumber"];
	        this.purchased = source["purchased"];
	        this.assigned = source["assigned"];
	        this.available = source["available"];
	    }
	}
	export class User {
	    identity: string;
	    exists: boolean;
	    enabled: boolean;
	    displayName: string;
	    upn: string;
	    licenses: string[];
	    lastSignIn: string;
	    error: string;
	
	    static createFrom(source: any = {}) {
	        return new User(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.identity = source["identity"];
	        this.exists = source["exists"];
	        this.enabled = source["enabled"];
	        this.displayName = source["displayName"];
	        this.upn = source["upn"];
	        this.licenses = source["licenses"];
	        this.lastSignIn = source["lastSignIn"];
	        this.error = source["error"];
	    }
	}

}

export namespace main {
	
	export class CachedSearch {
	    result?: ldap.SearchResult;
	    fetchedAt: number;
	    fromCache: boolean;
	
	    static createFrom(source: any = {}) {
	        return new CachedSearch(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.result = this.convertValues(source["result"], ldap.SearchResult);
	        this.fetchedAt = source["fetchedAt"];
	        this.fromCache = source["fromCache"];
	    }
	
		convertValues(a: any, classs: any, asMap: boolean = false): any {
		    if (!a) {
		        return a;
		    }
		    if (a.slice && a.map) {
		        return (a as any[]).map(elem => this.convertValues(elem, classs));
		    } else if ("object" === typeof a) {
		        if (asMap) {
		            for (const key of Object.keys(a)) {
		                a[key] = new classs(a[key]);
		            }
		            return a;
		        }
		        return new classs(a);
		    }
		    return a;
		}
	}
	export class Counts {
	    dn: string;
	    users: number;
	    computers: number;
	    truncated: boolean;
	
	    static createFrom(source: any = {}) {
	        return new Counts(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.dn = source["dn"];
	        this.users = source["users"];
	        this.computers = source["computers"];
	        this.truncated = source["truncated"];
	    }
	}

}

export namespace sysenv {
	
	export class Domain {
	    joined: boolean;
	    domain: string;
	    server: string;
	    user: string;
	
	    static createFrom(source: any = {}) {
	        return new Domain(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.joined = source["joined"];
	        this.domain = source["domain"];
	        this.server = source["server"];
	        this.user = source["user"];
	    }
	}

}

export namespace update {
	
	export class Available {
	    version: string;
	    current: string;
	    notes: string;
	    url: string;
	    signature: string;
	
	    static createFrom(source: any = {}) {
	        return new Available(source);
	    }
	
	    constructor(source: any = {}) {
	        if ('string' === typeof source) source = JSON.parse(source);
	        this.version = source["version"];
	        this.current = source["current"];
	        this.notes = source["notes"];
	        this.url = source["url"];
	        this.signature = source["signature"];
	    }
	}

}

