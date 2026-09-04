package update

import (
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"os"
	"path/filepath"
	"testing"

	"golang.org/x/crypto/blake2b"
)

func TestCompareVersions(t *testing.T) {
	cases := []struct {
		a, b string
		want int
	}{
		{"1.0.0", "1.0.0", 0},
		{"v1.0.1", "1.0.0", 1},
		{"1.10.0", "1.9.9", 1},
		{"0.1.5", "1.0.0", -1},
		{"1.0.0", "0.0.0-dev", 1},
		{"1.0.0-rc1", "1.0.0", 0},
	}
	for _, c := range cases {
		if got := CompareVersions(c.a, c.b); got != c.want {
			t.Errorf("CompareVersions(%q, %q) = %d, want %d", c.a, c.b, got, c.want)
		}
	}
}

func TestNewer(t *testing.T) {
	m := &Manifest{Version: "1.2.0", Notes: "notes", Platforms: map[string]Platform{PlatformKey: {URL: "https://x/setup.exe", Signature: "sig"}}}
	got, err := Newer(m, "1.1.9")
	if err != nil || got == nil || got.Version != "1.2.0" || got.URL != "https://x/setup.exe" {
		t.Fatalf("expected an update, got %+v, %v", got, err)
	}
	got, err = Newer(m, "1.2.0")
	if err != nil || got != nil {
		t.Fatalf("expected no update when current, got %+v, %v", got, err)
	}
	if _, err := Newer(&Manifest{Version: "9.0.0"}, "1.0.0"); err == nil {
		t.Fatal("expected an error when the manifest has no Windows build")
	}
}

// minisignFixture builds a key pair plus a signature in minisign's wire
// format so Verify can be tested without any external tool.
func minisignFixture(t *testing.T, data []byte, prehashed bool) (pubFile string, sigFile string, badSig string) {
	t.Helper()
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	keyID := []byte{1, 2, 3, 4, 5, 6, 7, 8}
	pubBlock := append(append([]byte("Ed"), keyID...), pub...)
	pubText := "untrusted comment: minisign public key\n" + base64.StdEncoding.EncodeToString(pubBlock) + "\n"

	message := data
	alg := "Ed"
	if prehashed {
		sum := blake2b.Sum512(data)
		message = sum[:]
		alg = "ED"
	}
	sig := ed25519.Sign(priv, message)
	sigBlock := append(append([]byte(alg), keyID...), sig...)
	sigText := "untrusted comment: signature from test key\n" + base64.StdEncoding.EncodeToString(sigBlock) + "\ntrusted comment: t\nAAAA\n"

	other := ed25519.Sign(priv, []byte("something else"))
	badBlock := append(append([]byte(alg), keyID...), other...)
	badText := base64.StdEncoding.EncodeToString(badBlock)
	// The app stores the public key as base64 of the .pub file text, as Tauri does.
	return base64.StdEncoding.EncodeToString([]byte(pubText)), sigText, badText
}

func TestVerifyBothMinisignModes(t *testing.T) {
	path := filepath.Join(t.TempDir(), "setup.exe")
	data := []byte("installer bytes")
	if err := os.WriteFile(path, data, 0o644); err != nil {
		t.Fatal(err)
	}
	for _, prehashed := range []bool{false, true} {
		pub, sig, bad := minisignFixture(t, data, prehashed)
		if err := Verify(path, sig, pub); err != nil {
			t.Fatalf("prehashed=%v: valid signature rejected: %v", prehashed, err)
		}
		if err := Verify(path, bad, pub); err == nil {
			t.Fatalf("prehashed=%v: wrong signature accepted", prehashed)
		}
		// A signature wrapped in base64 of the whole .sig text (as latest.json carries it).
		wrapped := base64.StdEncoding.EncodeToString([]byte(sig))
		if err := Verify(path, wrapped, pub); err != nil {
			t.Fatalf("prehashed=%v: wrapped signature rejected: %v", prehashed, err)
		}
	}
	// A different key id is refused before any crypto.
	pub, _, _ := minisignFixture(t, data, true)
	_, sig2, _ := minisignFixture(t, data, true)
	if err := Verify(path, sig2, pub); err == nil {
		t.Fatal("signature from another key accepted")
	}
}
