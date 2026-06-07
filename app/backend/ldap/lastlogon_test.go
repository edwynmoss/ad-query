package ldap

import "testing"

func TestAggregateLastLogon(t *testing.T) {
	t.Run("picks the newest across reachable DCs (high confidence)", func(t *testing.T) {
		rep := aggregateLastLogon("CN=u", []DCLastLogon{
			{DC: "dc1", Reachable: true, LastLogon: "133600000000000000"},
			{DC: "dc2", Reachable: true, LastLogon: "133700000000000000"}, // newest
			{DC: "dc3", Reachable: true, LastLogon: "0"},
		}, "133500000000000000")
		if rep.AccurateLastLogon != "133700000000000000" || rep.SourceDC != "dc2" {
			t.Fatalf("expected newest from dc2, got %q from %q", rep.AccurateLastLogon, rep.SourceDC)
		}
		if rep.Confidence != "High" || rep.ReachedDCs != 3 || rep.QueriedDCs != 3 {
			t.Fatalf("expected High/3/3, got %s/%d/%d", rep.Confidence, rep.ReachedDCs, rep.QueriedDCs)
		}
		if rep.LastLogonTimestamp != "133500000000000000" {
			t.Fatalf("replicated timestamp not carried through")
		}
	})

	t.Run("unreachable DC drops confidence to Medium", func(t *testing.T) {
		rep := aggregateLastLogon("CN=u", []DCLastLogon{
			{DC: "dc1", Reachable: true, LastLogon: "133700000000000000"},
			{DC: "dc2", Reachable: false, Error: "dial tcp: timeout"},
		}, "")
		if rep.Confidence != "Medium" || rep.ReachedDCs != 1 {
			t.Fatalf("expected Medium/1, got %s/%d", rep.Confidence, rep.ReachedDCs)
		}
	})

	t.Run("no login data anywhere => Low", func(t *testing.T) {
		rep := aggregateLastLogon("CN=u", []DCLastLogon{
			{DC: "dc1", Reachable: true, LastLogon: "0"},
		}, "")
		if rep.Confidence != "Low" || rep.AccurateLastLogon != "" {
			t.Fatalf("expected Low/empty, got %s/%q", rep.Confidence, rep.AccurateLastLogon)
		}
	})

	t.Run("nothing responded => Low", func(t *testing.T) {
		rep := aggregateLastLogon("CN=u", []DCLastLogon{{DC: "dc1", Reachable: false}}, "")
		if rep.Confidence != "Low" || rep.ReachedDCs != 0 {
			t.Fatalf("expected Low/0, got %s/%d", rep.Confidence, rep.ReachedDCs)
		}
	})
}
