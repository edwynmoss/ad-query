// Package adtypes converts raw Active Directory / LDAP attribute values into
// friendly Go types: Windows FILETIME timestamps, userAccountControl bit
// flags, and binary SIDs. These are pure functions with no I/O so they can be
// unit-tested without a directory.
package adtypes

import (
	"strconv"
	"time"
)

// filetimeEpochOffset is the number of 100-nanosecond intervals between the
// Windows FILETIME epoch (1601-01-01 UTC) and the Unix epoch (1970-01-01 UTC).
const filetimeEpochOffset int64 = 116444736000000000

// filetimeNever and its max-int variant are the sentinel values AD uses to mean
// "no value" / "never" for attributes like accountExpires and lastLogon.
const filetimeNever int64 = 9223372036854775807 // 0x7FFFFFFFFFFFFFFF

// FileTimeToTime converts a Windows FILETIME (100-ns ticks since 1601-01-01 UTC)
// to a time.Time in UTC. It returns ok=false for the sentinel "never" values
// (0 and 0x7FFFFFFFFFFFFFFF), which callers should render as "Never".
func FileTimeToTime(ft int64) (t time.Time, ok bool) {
	if ft <= 0 || ft == filetimeNever {
		return time.Time{}, false
	}
	unixNanos := (ft - filetimeEpochOffset) * 100
	return time.Unix(0, unixNanos).UTC(), true
}

// ParseFileTime parses a FILETIME supplied as a string (the form LDAP returns
// for attributes such as lastLogonTimestamp and pwdLastSet) and converts it.
func ParseFileTime(s string) (t time.Time, ok bool) {
	ft, err := strconv.ParseInt(s, 10, 64)
	if err != nil {
		return time.Time{}, false
	}
	return FileTimeToTime(ft)
}

// IsNeverFileTime reports whether a FILETIME value is one of AD's "never"
// sentinels.
func IsNeverFileTime(ft int64) bool {
	return ft <= 0 || ft == filetimeNever
}
