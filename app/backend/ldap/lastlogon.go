package ldap

import (
	"fmt"
	"strconv"
	"sync"
)

// Accurate last-login analysis. AD's `lastLogon` is NOT replicated between
// domain controllers, each DC records the logons it authenticated, so the
// only reliable "last login" is the newest `lastLogon` across every DC.
// `lastLogonTimestamp` IS replicated but lags (default ~9-14 days), so it's the
// "fast" approximation good enough for stale-account sweeps but not forensics.

// DCLastLogon is one domain controller's answer for a user.
type DCLastLogon struct {
	DC        string `json:"dc"`
	Reachable bool   `json:"reachable"`
	LastLogon string `json:"lastLogon"` // raw FILETIME (caller formats); "" / "0" = none
	Error     string `json:"error,omitempty"`
}

// LastLogonReport is the aggregated accurate-last-login result for a user.
type LastLogonReport struct {
	DN                 string        `json:"dn"`
	AccurateLastLogon  string        `json:"accurateLastLogon"`  // newest lastLogon (raw FILETIME), "" if none
	SourceDC           string        `json:"sourceDC"`           // DC that held the newest value
	LastLogonTimestamp string        `json:"lastLogonTimestamp"` // replicated value, for comparison
	QueriedDCs         int           `json:"queriedDCs"`
	ReachedDCs         int           `json:"reachedDCs"`
	PerDC              []DCLastLogon `json:"perDC"`
	Confidence         string        `json:"confidence"` // High | Medium | Low
	Note               string        `json:"note"`
}

func firstAttr(e Entry, a string) string {
	if v := e.Attributes[a]; len(v) > 0 {
		return v[0]
	}
	return ""
}

// DomainControllers enumerates the domain's DCs (by dNSHostName). DCs are the
// computer objects in the Domain Controllers group (primaryGroupID 516).
func (c *Conn) DomainControllers() ([]string, error) {
	info, err := c.RootDSE()
	if err != nil || info.DefaultNamingContext == "" {
		return nil, fmt.Errorf("could not determine the domain root")
	}
	res, err := c.Search(SearchRequest{
		BaseDN:     info.DefaultNamingContext,
		Scope:      ScopeSubtree,
		Filter:     "(&(objectCategory=computer)(primaryGroupID=516))",
		Attributes: []string{"dNSHostName"},
		PageSize:   1000,
	})
	if err != nil {
		return nil, err
	}
	hosts := make([]string, 0, len(res.Entries))
	for _, e := range res.Entries {
		if h := firstAttr(e, "dNSHostName"); h != "" {
			hosts = append(hosts, h)
		}
	}
	return hosts, nil
}

// AccurateLastLogon dials each DC (reusing the session's auth, host swapped),
// reads the user's lastLogon, and reports the newest. DCs are queried in
// parallel; an unreachable DC degrades confidence but never fails the whole
// check.
func AccurateLastLogon(opts ConnectOptions, dcs []string, dn string) *LastLogonReport {
	perDC := make([]DCLastLogon, len(dcs))
	var llt string
	var mu sync.Mutex
	var wg sync.WaitGroup

	for i, dc := range dcs {
		wg.Add(1)
		go func(i int, dc string) {
			defer wg.Done()
			r := DCLastLogon{DC: dc}
			o := opts
			o.Host = dc
			o.ServicePrincipal = "" // recompute SPN (ldap/<dc>) for Kerberos
			conn, err := Connect(o)
			if err != nil {
				r.Error = err.Error()
				perDC[i] = r
				return
			}
			defer conn.Close()
			res, err := conn.Search(SearchRequest{
				BaseDN: dn, Scope: ScopeBase, Filter: "(objectClass=*)",
				Attributes: []string{"lastLogon", "lastLogonTimestamp"},
			})
			if err != nil {
				r.Error = err.Error()
				perDC[i] = r
				return
			}
			r.Reachable = true
			if len(res.Entries) > 0 {
				r.LastLogon = firstAttr(res.Entries[0], "lastLogon")
				if t := firstAttr(res.Entries[0], "lastLogonTimestamp"); t != "" {
					mu.Lock()
					if llt == "" {
						llt = t
					}
					mu.Unlock()
				}
			}
			perDC[i] = r
		}(i, dc)
	}
	wg.Wait()
	return aggregateLastLogon(dn, perDC, llt)
}

// aggregateLastLogon picks the newest lastLogon across the responding DCs and
// assigns a confidence. Pure (no I/O) so it is unit-tested directly.
func aggregateLastLogon(dn string, perDC []DCLastLogon, llt string) *LastLogonReport {
	rep := &LastLogonReport{DN: dn, PerDC: perDC, QueriedDCs: len(perDC), LastLogonTimestamp: llt}
	var best int64
	for _, d := range perDC {
		if d.Reachable {
			rep.ReachedDCs++
		}
		if v := parseFileTime(d.LastLogon); v > best {
			best = v
			rep.SourceDC = d.DC
			rep.AccurateLastLogon = d.LastLogon
		}
	}
	switch {
	case rep.ReachedDCs == 0:
		rep.Confidence = "Low"
		rep.Note = "No domain controllers responded. The result is unavailable."
	case best == 0:
		rep.Confidence = "Low"
		rep.Note = fmt.Sprintf("No interactive login recorded on the %d responding DC(s).", rep.ReachedDCs)
	case rep.ReachedDCs < rep.QueriedDCs:
		rep.Confidence = "Medium"
		rep.Note = fmt.Sprintf("%d of %d domain controllers responded; %d did not. A newer login may exist on an unreachable DC.", rep.ReachedDCs, rep.QueriedDCs, rep.QueriedDCs-rep.ReachedDCs)
	default:
		rep.Confidence = "High"
		rep.Note = fmt.Sprintf("Queried all %d domain controllers.", rep.QueriedDCs)
	}
	return rep
}

func parseFileTime(s string) int64 {
	n, _ := strconv.ParseInt(s, 10, 64)
	return n
}
