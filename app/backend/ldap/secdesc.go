package ldap

import (
	"fmt"

	goldap "github.com/go-ldap/ldap/v3"
)

// sdFlagsControlOID is LDAP_SERVER_SD_FLAGS_OID. It lets a search specify which
// parts of nTSecurityDescriptor to return (owner/group/DACL/SACL).
const sdFlagsControlOID = "1.2.840.113556.1.4.801"

// SD flag bits.
const (
	SDOwner = 0x1
	SDGroup = 0x2
	SDDACL  = 0x4
	SDSACL  = 0x8
)

// FetchSecurityDescriptor reads the raw nTSecurityDescriptor for one object,
// using the SD-flags control so we can request owner+group+DACL without the
// SACL (which would require SeSecurityPrivilege). flags defaults to
// owner+group+DACL when zero. Returns the raw self-relative descriptor bytes;
// parse with adtypes.ParseSecurityDescriptor.
func (c *Conn) FetchSecurityDescriptor(dn string, flags int) ([]byte, error) {
	if c == nil || c.conn == nil {
		return nil, fmt.Errorf("not connected")
	}
	if flags <= 0 {
		flags = SDOwner | SDGroup | SDDACL
	}
	if flags > 0xff {
		return nil, fmt.Errorf("sd flags out of supported range: %d", flags)
	}

	// Control value is BER: SEQUENCE { INTEGER flags }. For our small flag set
	// the integer is one byte, so the encoding is 30 03 02 01 <flags>.
	ctrlValue := string([]byte{0x30, 0x03, 0x02, 0x01, byte(flags)})
	ctrl := goldap.NewControlString(sdFlagsControlOID, true, ctrlValue)

	req := goldap.NewSearchRequest(
		dn,
		goldap.ScopeBaseObject,
		goldap.NeverDerefAliases,
		0, 0, false,
		"(objectClass=*)",
		[]string{"nTSecurityDescriptor"},
		[]goldap.Control{ctrl},
	)
	res, err := c.conn.Search(req)
	if err != nil {
		return nil, fmt.Errorf("fetch security descriptor for %q: %w", dn, err)
	}
	if len(res.Entries) == 0 {
		return nil, fmt.Errorf("object %q not found", dn)
	}
	raw := res.Entries[0].GetRawAttributeValue("nTSecurityDescriptor")
	if len(raw) == 0 {
		return nil, fmt.Errorf("no nTSecurityDescriptor returned (directory may not be Active Directory, or access was denied)")
	}
	return raw, nil
}
