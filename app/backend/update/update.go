// Package update checks GitHub Releases for a newer AD Query, downloads the
// signed installer and hands off to it. The manifest is the same latest.json
// shape the Tauri updater uses, so one release workflow style serves both
// apps; signatures are minisign (Ed25519) and are verified before anything
// runs.
package update

import (
	"bytes"
	"context"
	"crypto/ed25519"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/blake2b"
)

// Manifest is latest.json as published next to a release.
type Manifest struct {
	Version   string              `json:"version"`
	Notes     string              `json:"notes"`
	PubDate   string              `json:"pub_date"`
	Platforms map[string]Platform `json:"platforms"`
}

// Platform is one downloadable artifact in the manifest.
type Platform struct {
	URL       string `json:"url"`
	Signature string `json:"signature"`
}

// Available describes a newer release the app can install.
type Available struct {
	Version   string `json:"version"`
	Current   string `json:"current"`
	Notes     string `json:"notes"`
	URL       string `json:"url"`
	Signature string `json:"signature"`
}

// PlatformKey names this build in the manifest.
const PlatformKey = "windows-x86_64"

// Check fetches the manifest and reports a newer version, or nil when the
// running build is current. Network failures and a missing manifest are
// returned as errors; callers decide how quiet to be.
func Check(ctx context.Context, manifestURL, current string) (*Available, error) {
	ctx, cancel := context.WithTimeout(ctx, 10*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, manifestURL, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "AD-Query-Updater/"+current)
	req.Header.Set("Accept", "application/json")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("update manifest: HTTP %d", resp.StatusCode)
	}
	var manifest Manifest
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&manifest); err != nil {
		return nil, fmt.Errorf("update manifest: %w", err)
	}
	return Newer(&manifest, current)
}

// Newer compares a manifest against the running version.
func Newer(manifest *Manifest, current string) (*Available, error) {
	platform, ok := manifest.Platforms[PlatformKey]
	if !ok || platform.URL == "" {
		return nil, errors.New("update manifest has no Windows build")
	}
	if CompareVersions(manifest.Version, current) <= 0 {
		return nil, nil
	}
	return &Available{
		Version:   strings.TrimPrefix(manifest.Version, "v"),
		Current:   strings.TrimPrefix(current, "v"),
		Notes:     manifest.Notes,
		URL:       platform.URL,
		Signature: platform.Signature,
	}, nil
}

// CompareVersions orders dotted versions numerically ("1.10.0" > "1.9.2"),
// ignoring a leading "v" and anything after a hyphen. Development builds
// ("0.0.0-dev") therefore sort below every release.
func CompareVersions(a, b string) int {
	pa := versionParts(a)
	pb := versionParts(b)
	for i := 0; i < 3; i++ {
		if pa[i] != pb[i] {
			if pa[i] > pb[i] {
				return 1
			}
			return -1
		}
	}
	return 0
}

func versionParts(v string) [3]int {
	v = strings.TrimPrefix(strings.TrimSpace(v), "v")
	if i := strings.IndexAny(v, "-+"); i >= 0 {
		v = v[:i]
	}
	var out [3]int
	for i, part := range strings.SplitN(v, ".", 3) {
		n, err := strconv.Atoi(part)
		if err == nil {
			out[i] = n
		}
	}
	return out
}

// Download fetches the installer into a temp file and reports progress as
// (received, total) bytes; total is -1 when the server does not say.
func Download(ctx context.Context, url string, progress func(received, total int64)) (string, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", err
	}
	req.Header.Set("User-Agent", "AD-Query-Updater")
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		return "", err
	}
	defer resp.Body.Close()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("download: HTTP %d", resp.StatusCode)
	}
	dir := filepath.Join(os.TempDir(), "ad-query-update")
	if err := os.MkdirAll(dir, 0o755); err != nil {
		return "", err
	}
	file, err := os.CreateTemp(dir, "ADQuery-*-setup.exe")
	if err != nil {
		return "", err
	}
	path := file.Name()
	var received int64
	buf := make([]byte, 256*1024)
	for {
		n, readErr := resp.Body.Read(buf)
		if n > 0 {
			if _, err := file.Write(buf[:n]); err != nil {
				file.Close()
				os.Remove(path)
				return "", err
			}
			received += int64(n)
			if progress != nil {
				progress(received, resp.ContentLength)
			}
		}
		if readErr == io.EOF {
			break
		}
		if readErr != nil {
			file.Close()
			os.Remove(path)
			return "", readErr
		}
	}
	if err := file.Close(); err != nil {
		os.Remove(path)
		return "", err
	}
	return path, nil
}

// Verify checks a minisign signature over the file against the public key.
// `signature` is the text of the .sig file (comment lines and base64) or its
// bare base64; `publicKey` is the base64 of the .pub file text, which is how
// the key is stored in the app.
func Verify(path, signature, publicKey string) error {
	pub, keyID, err := parsePublicKey(publicKey)
	if err != nil {
		return err
	}
	sigBytes, err := decodeSignedBlock(signature)
	if err != nil {
		return fmt.Errorf("signature: %w", err)
	}
	if len(sigBytes) != 2+8+ed25519.SignatureSize {
		return errors.New("signature: unexpected length")
	}
	alg := string(sigBytes[:2])
	if !bytes.Equal(sigBytes[2:10], keyID) {
		return errors.New("signature was made with a different key")
	}
	sig := sigBytes[10:]
	data, err := os.ReadFile(path)
	if err != nil {
		return err
	}
	var message []byte
	switch alg {
	case "Ed":
		message = data
	case "ED":
		sum := blake2b.Sum512(data)
		message = sum[:]
	default:
		return fmt.Errorf("signature: unknown algorithm %q", alg)
	}
	if !ed25519.Verify(pub, message, sig) {
		return errors.New("signature does not match the downloaded file")
	}
	return nil
}

// parsePublicKey returns the Ed25519 key and the 8-byte key id.
func parsePublicKey(encoded string) (ed25519.PublicKey, []byte, error) {
	raw, err := decodeSignedBlock(encoded)
	if err != nil {
		return nil, nil, fmt.Errorf("public key: %w", err)
	}
	if len(raw) != 2+8+ed25519.PublicKeySize {
		return nil, nil, errors.New("public key: unexpected length")
	}
	if string(raw[:2]) != "Ed" {
		return nil, nil, errors.New("public key: not an Ed25519 minisign key")
	}
	return ed25519.PublicKey(raw[10:]), raw[2:10], nil
}

// decodeSignedBlock accepts a minisign file body (comment lines plus a base64
// line), a bare base64 line, or base64 of either, and returns the binary block.
func decodeSignedBlock(text string) ([]byte, error) {
	text = strings.TrimSpace(text)
	if text == "" {
		return nil, errors.New("empty")
	}
	if !strings.Contains(text, "\n") && !strings.HasPrefix(text, "untrusted comment") {
		if decoded, err := base64.StdEncoding.DecodeString(text); err == nil {
			// Either the binary block itself or the base64 of a whole file.
			if len(decoded) == 42 || len(decoded) == 74 {
				return decoded, nil
			}
			if strings.HasPrefix(string(decoded), "untrusted comment") {
				text = string(decoded)
			}
		}
	}
	for _, line := range strings.Split(text, "\n") {
		line = strings.TrimSpace(line)
		if line == "" || strings.HasPrefix(line, "untrusted comment") || strings.HasPrefix(line, "trusted comment") {
			continue
		}
		decoded, err := base64.StdEncoding.DecodeString(line)
		if err != nil {
			return nil, err
		}
		if len(decoded) == 42 || len(decoded) == 74 {
			return decoded, nil
		}
	}
	return nil, errors.New("no key or signature block found")
}

// Install starts the installer silently and returns; the caller should quit
// so the running executable can be replaced. The installer relaunches the
// app when it finishes.
func Install(path string) error {
	cmd := exec.Command(path, "/S")
	cmd.Dir = filepath.Dir(path)
	return cmd.Start()
}
