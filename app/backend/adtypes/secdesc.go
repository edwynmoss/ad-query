package adtypes

import (
	"encoding/binary"
	"fmt"
)

// SecurityDescriptor is a parsed self-relative Windows SECURITY_DESCRIPTOR, as
// stored in the AD nTSecurityDescriptor attribute. We surface the owner/group
// and the DACL (discretionary ACL) — the access-control entries an admin wants
// to audit. The SACL is not parsed (it requires SeSecurityPrivilege to read).
type SecurityDescriptor struct {
	Owner string `json:"owner"`
	Group string `json:"group"`
	DACL  []ACE  `json:"dacl"`
}

// ACE is one access-control entry.
type ACE struct {
	Type       string   `json:"type"`       // friendly type name
	Allow      bool     `json:"allow"`      // true = allow, false = deny
	Flags      uint8    `json:"flags"`      // inheritance flags
	Mask       uint32   `json:"mask"`       // raw access mask
	Rights     []string `json:"rights"`     // decoded access-mask rights
	SID        string   `json:"sid"`        // trustee SID
	Trustee    string   `json:"trustee"`    // friendly trustee (well-known name or SID)
	ObjectType string   `json:"objectType"` // object-type GUID (object ACEs only)
}

const (
	aceAccessAllowed       = 0x00
	aceAccessDenied        = 0x01
	aceAccessAllowedObject = 0x05
	aceAccessDeniedObject  = 0x06
)

var aceTypeNames = map[byte]string{
	aceAccessAllowed:       "Allow",
	aceAccessDenied:        "Deny",
	aceAccessAllowedObject: "Allow (object)",
	aceAccessDeniedObject:  "Deny (object)",
}

// ParseSecurityDescriptor parses a self-relative security descriptor.
func ParseSecurityDescriptor(b []byte) (*SecurityDescriptor, error) {
	if len(b) < 20 {
		return nil, fmt.Errorf("security descriptor too short: %d bytes", len(b))
	}
	// Header: Revision(1) Sbz1(1) Control(2) OffsetOwner(4) OffsetGroup(4)
	//         OffsetSacl(4) OffsetDacl(4) — all offsets little-endian.
	offOwner := binary.LittleEndian.Uint32(b[4:8])
	offGroup := binary.LittleEndian.Uint32(b[8:12])
	offDacl := binary.LittleEndian.Uint32(b[16:20])

	sd := &SecurityDescriptor{}
	if offOwner != 0 && int(offOwner) < len(b) {
		if s, err := SIDToString(b[offOwner:]); err == nil {
			sd.Owner = FriendlySID(s)
		}
	}
	if offGroup != 0 && int(offGroup) < len(b) {
		if s, err := SIDToString(b[offGroup:]); err == nil {
			sd.Group = FriendlySID(s)
		}
	}
	if offDacl != 0 && int(offDacl) < len(b) {
		aces, err := parseACL(b[offDacl:])
		if err != nil {
			return nil, fmt.Errorf("parse DACL: %w", err)
		}
		sd.DACL = aces
	}
	return sd, nil
}

// parseACL parses an ACL structure (header + ACEs) starting at acl[0].
func parseACL(acl []byte) ([]ACE, error) {
	if len(acl) < 8 {
		return nil, fmt.Errorf("ACL too short")
	}
	// AclRevision(1) Sbz1(1) AclSize(2) AceCount(2) Sbz2(2)
	aceCount := int(binary.LittleEndian.Uint16(acl[4:6]))
	out := make([]ACE, 0, aceCount)

	off := 8
	for i := 0; i < aceCount; i++ {
		if off+4 > len(acl) {
			return nil, fmt.Errorf("ACE %d header out of range", i)
		}
		aceType := acl[off]
		aceFlags := acl[off+1]
		aceSize := int(binary.LittleEndian.Uint16(acl[off+2 : off+4]))
		if aceSize < 4 || off+aceSize > len(acl) {
			return nil, fmt.Errorf("ACE %d size invalid (%d)", i, aceSize)
		}
		ace, err := parseACE(aceType, aceFlags, acl[off+4:off+aceSize])
		if err != nil {
			return nil, fmt.Errorf("ACE %d: %w", i, err)
		}
		out = append(out, ace)
		off += aceSize
	}
	return out, nil
}

// parseACE parses one ACE body (everything after the 4-byte ACE header).
func parseACE(aceType, aceFlags byte, body []byte) (ACE, error) {
	ace := ACE{
		Type:  aceTypeNames[aceType],
		Allow: aceType == aceAccessAllowed || aceType == aceAccessAllowedObject,
		Flags: aceFlags,
	}
	if ace.Type == "" {
		ace.Type = fmt.Sprintf("Type 0x%02x", aceType)
	}
	if len(body) < 4 {
		return ace, fmt.Errorf("ACE body too short")
	}
	ace.Mask = binary.LittleEndian.Uint32(body[0:4])
	ace.Rights = DecodeAccessMask(ace.Mask)

	rest := body[4:]
	isObject := aceType == aceAccessAllowedObject || aceType == aceAccessDeniedObject
	if isObject {
		if len(rest) < 4 {
			return ace, fmt.Errorf("object ACE missing flags")
		}
		objFlags := binary.LittleEndian.Uint32(rest[0:4])
		rest = rest[4:]
		if objFlags&0x1 != 0 { // ACE_OBJECT_TYPE_PRESENT
			if len(rest) < 16 {
				return ace, fmt.Errorf("object ACE missing ObjectType GUID")
			}
			ace.ObjectType = GUIDToString(rest[0:16])
			rest = rest[16:]
		}
		if objFlags&0x2 != 0 { // ACE_INHERITED_OBJECT_TYPE_PRESENT
			if len(rest) < 16 {
				return ace, fmt.Errorf("object ACE missing InheritedObjectType GUID")
			}
			rest = rest[16:]
		}
	}

	sid, err := SIDToString(rest)
	if err != nil {
		return ace, fmt.Errorf("ACE SID: %w", err)
	}
	ace.SID = sid
	ace.Trustee = FriendlySID(sid)
	return ace, nil
}

// accessRights maps AD/standard access-mask bits to friendly names.
var accessRights = []struct {
	Bit  uint32
	Name string
}{
	{0x00000001, "Create child"},
	{0x00000002, "Delete child"},
	{0x00000004, "List contents"},
	{0x00000008, "Write self"},
	{0x00000010, "Read property"},
	{0x00000020, "Write property"},
	{0x00000040, "Delete tree"},
	{0x00000080, "List object"},
	{0x00000100, "Control access"},
	{0x00010000, "Delete"},
	{0x00020000, "Read control"},
	{0x00040000, "Write DAC"},
	{0x00080000, "Write owner"},
	{0x00100000, "Synchronize"},
	{0x10000000, "Generic all"},
	{0x20000000, "Generic execute"},
	{0x40000000, "Generic write"},
	{0x80000000, "Generic read"},
}

// DecodeAccessMask returns friendly names for every right set in mask.
func DecodeAccessMask(mask uint32) []string {
	out := make([]string, 0, 4)
	for _, r := range accessRights {
		if mask&r.Bit != 0 {
			out = append(out, r.Name)
		}
	}
	return out
}

// GUIDToString formats a 16-byte little-endian GUID (Data1/2/3 little-endian,
// Data4 big-endian) as the canonical 8-4-4-4-12 string.
func GUIDToString(b []byte) string {
	if len(b) < 16 {
		return ""
	}
	d1 := binary.LittleEndian.Uint32(b[0:4])
	d2 := binary.LittleEndian.Uint16(b[4:6])
	d3 := binary.LittleEndian.Uint16(b[6:8])
	return fmt.Sprintf("%08x-%04x-%04x-%02x%02x-%02x%02x%02x%02x%02x%02x",
		d1, d2, d3, b[8], b[9], b[10], b[11], b[12], b[13], b[14], b[15])
}
