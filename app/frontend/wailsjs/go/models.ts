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

