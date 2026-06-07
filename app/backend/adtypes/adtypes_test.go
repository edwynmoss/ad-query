package adtypes

import (
	"testing"
	"time"
)

func TestFileTimeToTime(t *testing.T) {
	// The epoch offset itself maps exactly to the Unix epoch.
	got, ok := FileTimeToTime(filetimeEpochOffset)
	if !ok {
		t.Fatalf("expected ok for epoch offset")
	}
	if !got.Equal(time.Unix(0, 0).UTC()) {
		t.Errorf("epoch: got %v, want 1970-01-01T00:00:00Z", got)
	}

	// One second past the Unix epoch.
	got, ok = FileTimeToTime(filetimeEpochOffset + 10_000_000)
	if !ok || !got.Equal(time.Date(1970, 1, 1, 0, 0, 1, 0, time.UTC)) {
		t.Errorf("epoch+1s: got %v ok=%v", got, ok)
	}

	// Sentinels mean "never".
	for _, never := range []int64{0, -1, filetimeNever} {
		if _, ok := FileTimeToTime(never); ok {
			t.Errorf("FileTimeToTime(%d) should be ok=false", never)
		}
	}
}

func TestParseFileTime(t *testing.T) {
	if _, ok := ParseFileTime("not-a-number"); ok {
		t.Errorf("expected ok=false for non-numeric input")
	}
	if _, ok := ParseFileTime("133516992000000000"); !ok {
		t.Errorf("expected ok=true for a valid filetime string")
	}
}

func TestDecodeUAC(t *testing.T) {
	// 514 = NORMAL_ACCOUNT (0x200) | ACCOUNTDISABLE (0x2)
	names := DecodeUAC(514)
	if !contains(names, "ACCOUNTDISABLE") || !contains(names, "NORMAL_ACCOUNT") {
		t.Errorf("514 decoded to %v", names)
	}
	if !IsDisabled(514) {
		t.Errorf("514 should be disabled")
	}
	if PasswordNeverExpires(514) {
		t.Errorf("514 should not have DONT_EXPIRE_PASSWORD")
	}

	// 66048 = NORMAL_ACCOUNT (0x200) | DONT_EXPIRE_PASSWORD (0x10000)
	if !PasswordNeverExpires(66048) || IsDisabled(66048) {
		t.Errorf("66048 flags wrong: disabled=%v neverExpires=%v", IsDisabled(66048), PasswordNeverExpires(66048))
	}
}

func TestSIDToString(t *testing.T) {
	// S-1-5-32-544 (BUILTIN\Administrators)
	b := []byte{
		0x01,                                     // revision
		0x02,                                     // sub-authority count
		0x00, 0x00, 0x00, 0x00, 0x00, 0x05,       // authority = 5 (big-endian)
		0x20, 0x00, 0x00, 0x00,                   // 32 (little-endian)
		0x20, 0x02, 0x00, 0x00,                   // 544 (little-endian)
	}
	got, err := SIDToString(b)
	if err != nil {
		t.Fatalf("unexpected error: %v", err)
	}
	if got != "S-1-5-32-544" {
		t.Errorf("got %q, want S-1-5-32-544", got)
	}
	if FriendlySID(got) != "Administrators" {
		t.Errorf("FriendlySID(%q) = %q", got, FriendlySID(got))
	}

	if _, err := SIDToString([]byte{0x01, 0x02}); err == nil {
		t.Errorf("expected error for truncated SID")
	}
}

func contains(s []string, v string) bool {
	for _, x := range s {
		if x == v {
			return true
		}
	}
	return false
}
