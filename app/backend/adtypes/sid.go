package adtypes

import (
	"encoding/binary"
	"fmt"
	"strings"
)

// SIDToString converts a binary SECURITY_IDENTIFIER (objectSid / the trustee of
// an ACE) into its canonical string form, e.g. "S-1-5-21-...-1001".
//
// Layout (little-endian sub-authorities, big-endian identifier authority):
//
//	byte 0      Revision
//	byte 1      SubAuthorityCount (N)
//	bytes 2-7   IdentifierAuthority (48-bit, big-endian)
//	bytes 8..   N * uint32 sub-authorities (little-endian)
func SIDToString(b []byte) (string, error) {
	if len(b) < 8 {
		return "", fmt.Errorf("sid too short: %d bytes", len(b))
	}
	revision := b[0]
	subCount := int(b[1])
	if len(b) < 8+subCount*4 {
		return "", fmt.Errorf("sid truncated: have %d bytes, need %d", len(b), 8+subCount*4)
	}

	// 48-bit identifier authority, big-endian across bytes 2..7.
	var authority uint64
	for i := 2; i < 8; i++ {
		authority = authority<<8 | uint64(b[i])
	}

	var sb strings.Builder
	fmt.Fprintf(&sb, "S-%d-%d", revision, authority)
	for i := 0; i < subCount; i++ {
		off := 8 + i*4
		sub := binary.LittleEndian.Uint32(b[off : off+4])
		fmt.Fprintf(&sb, "-%d", sub)
	}
	return sb.String(), nil
}

// wellKnownSIDs maps a few common SIDs to friendly names so ACL views are
// readable even before we resolve trustees against the directory.
var wellKnownSIDs = map[string]string{
	"S-1-1-0":      "Everyone",
	"S-1-3-0":      "Creator Owner",
	"S-1-5-7":      "Anonymous",
	"S-1-5-11":     "Authenticated Users",
	"S-1-5-18":     "Local System",
	"S-1-5-32-544": "Administrators",
	"S-1-5-32-545": "Users",
	"S-1-5-32-546": "Guests",
}

// FriendlySID returns a well-known display name for a SID string, or the SID
// itself if it is not a recognised constant.
func FriendlySID(sid string) string {
	if name, ok := wellKnownSIDs[sid]; ok {
		return name
	}
	return sid
}
