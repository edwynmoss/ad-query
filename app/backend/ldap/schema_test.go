package ldap

import (
	"strings"
	"testing"
)

func TestParseSchemaNames(t *testing.T) {
	defs := []string{
		"( 2.5.4.3 NAME 'cn' SUP name )",
		"( 2.5.4.42 NAME ( 'givenName' 'gn' ) EQUALITY caseIgnoreMatch )",
		"( 0.9.2342.19200300.100.1.1 NAME 'uid' EQUALITY caseIgnoreMatch )",
		"( 1.2.3 NAME 'cn' )", // duplicate, different definition
		"( 1.2.4 DESC 'no name token' )",
	}
	got := parseSchemaNames(defs)

	want := map[string]bool{"cn": true, "givenName": true, "gn": true, "uid": true}
	if len(got) != len(want) {
		t.Fatalf("expected %d unique names, got %d: %v", len(want), len(got), got)
	}
	for _, n := range got {
		if !want[n] {
			t.Errorf("unexpected name %q in %v", n, got)
		}
	}

	// Result must be sorted case-insensitively.
	for i := 1; i < len(got); i++ {
		if strings.ToLower(got[i-1]) > strings.ToLower(got[i]) {
			t.Errorf("not sorted: %v", got)
		}
	}
}

func TestNamesInDefinition(t *testing.T) {
	if got := namesInDefinition("( 1 NAME 'sn' )"); len(got) != 1 || got[0] != "sn" {
		t.Errorf("single name: %v", got)
	}
	if got := namesInDefinition("( 1 NAME ( 'a' 'b' 'c' ) )"); len(got) != 3 {
		t.Errorf("multi name: %v", got)
	}
	if got := namesInDefinition("( 1 DESC 'x' )"); got != nil {
		t.Errorf("no NAME should yield nil, got %v", got)
	}
}

func TestIntegrationSchemaAttributes(t *testing.T) {
	c := connectOrSkip(t)
	defer c.Close()

	names, err := c.SchemaAttributeNames()
	if err != nil {
		t.Fatalf("SchemaAttributeNames: %v", err)
	}
	if len(names) < 20 {
		t.Errorf("expected a rich schema, got only %d attributes", len(names))
	}
	// Attributes we know OpenLDAP's core schema defines.
	set := make(map[string]bool, len(names))
	for _, n := range names {
		set[strings.ToLower(n)] = true
	}
	for _, must := range []string{"cn", "uid", "mail", "member", "objectclass"} {
		if !set[must] {
			t.Errorf("schema missing expected attribute %q", must)
		}
	}
}
