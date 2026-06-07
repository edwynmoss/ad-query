package creds

import "testing"

// Exercises the real Windows Credential Manager (no domain required). Cleans up
// the test entry afterward.
func TestStoreGetDelete(t *testing.T) {
	const name = "__adquery_unit_test__"
	const secret = "S3cr3t-Passw0rd!"

	defer Delete(name)

	if err := Store(name, secret); err != nil {
		t.Fatalf("Store: %v", err)
	}
	if !Exists(name) {
		t.Fatalf("Exists should be true after Store")
	}
	got, err := Get(name)
	if err != nil {
		t.Fatalf("Get: %v", err)
	}
	if got != secret {
		t.Errorf("Get = %q, want %q", got, secret)
	}

	// Overwrite.
	if err := Store(name, "new-value"); err != nil {
		t.Fatalf("Store overwrite: %v", err)
	}
	if got, _ := Get(name); got != "new-value" {
		t.Errorf("after overwrite Get = %q", got)
	}

	if err := Delete(name); err != nil {
		t.Fatalf("Delete: %v", err)
	}
	if Exists(name) {
		t.Errorf("Exists should be false after Delete")
	}
}
