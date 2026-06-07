// Package creds stores connection secrets in the Windows Credential Manager so
// passwords never touch disk in plaintext (or the frontend's localStorage).
// Targets are namespaced under "ADQuery:" to avoid colliding with other apps.
package creds

import (
	"fmt"

	"github.com/danieljoos/wincred"
)

const targetPrefix = "ADQuery:"

func targetName(name string) string {
	return targetPrefix + name
}

// Store writes (or overwrites) the secret for a named profile.
func Store(name, secret string) error {
	if name == "" {
		return fmt.Errorf("profile name is required")
	}
	c := wincred.NewGenericCredential(targetName(name))
	c.CredentialBlob = []byte(secret)
	c.Persist = wincred.PersistLocalMachine
	return c.Write()
}

// Get retrieves the secret for a named profile. Returns an error if absent.
func Get(name string) (string, error) {
	c, err := wincred.GetGenericCredential(targetName(name))
	if err != nil {
		return "", err
	}
	return string(c.CredentialBlob), nil
}

// Exists reports whether a stored secret exists for the profile.
func Exists(name string) bool {
	c, err := wincred.GetGenericCredential(targetName(name))
	return err == nil && c != nil
}

// Delete removes the stored secret for a profile. Deleting a non-existent
// profile is not an error.
func Delete(name string) error {
	c, err := wincred.GetGenericCredential(targetName(name))
	if err != nil {
		return nil // already absent
	}
	return c.Delete()
}
