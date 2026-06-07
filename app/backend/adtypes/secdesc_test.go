package adtypes

import (
	"encoding/binary"
	"testing"
)

// buildFixtureSD constructs a self-relative security descriptor with:
//   owner = S-1-5-32-544 (Administrators)
//   group = S-1-5-18     (Local System)
//   DACL  = [ Allow Administrators GENERIC_ALL,
//             Allow(object) Authenticated-Users Control-Access w/ ObjectType GUID ]
func buildFixtureSD() []byte {
	admins := []byte{0x01, 0x02, 0, 0, 0, 0, 0, 0x05, 0x20, 0, 0, 0, 0x20, 0x02, 0, 0} // S-1-5-32-544
	system := []byte{0x01, 0x01, 0, 0, 0, 0, 0, 0x05, 0x12, 0, 0, 0}                    // S-1-5-18
	authUsers := []byte{0x01, 0x01, 0, 0, 0, 0, 0, 0x05, 0x0b, 0, 0, 0}                 // S-1-5-11
	// GUID 00299570-246d-11d0-a768-00aa006e0529 in little-endian mixed form.
	guid := []byte{0x70, 0x95, 0x29, 0x00, 0x6d, 0x24, 0xd0, 0x11, 0xa7, 0x68, 0x00, 0xaa, 0x00, 0x6e, 0x05, 0x29}

	// ACE 1: ACCESS_ALLOWED, mask GENERIC_ALL (0x10000000)
	ace1 := []byte{0x00, 0x00, 0x18, 0x00, 0x00, 0x00, 0x00, 0x10}
	ace1 = append(ace1, admins...) // total 24

	// ACE 2: ACCESS_ALLOWED_OBJECT, mask Control access (0x100), ObjectType present
	ace2 := []byte{0x05, 0x00, 0x28, 0x00, 0x00, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00}
	ace2 = append(ace2, guid...)
	ace2 = append(ace2, authUsers...) // total 40

	aclHeader := make([]byte, 8)
	aclHeader[0] = 0x02
	binary.LittleEndian.PutUint16(aclHeader[2:4], uint16(8+len(ace1)+len(ace2)))
	binary.LittleEndian.PutUint16(aclHeader[4:6], 2)
	dacl := append(aclHeader, append(ace1, ace2...)...)

	header := make([]byte, 20)
	header[0] = 0x01
	binary.LittleEndian.PutUint16(header[2:4], 0x8004) // SE_DACL_PRESENT | SE_SELF_RELATIVE
	ownerOff := 20
	groupOff := ownerOff + len(admins)
	daclOff := groupOff + len(system)
	binary.LittleEndian.PutUint32(header[4:8], uint32(ownerOff))
	binary.LittleEndian.PutUint32(header[8:12], uint32(groupOff))
	binary.LittleEndian.PutUint32(header[16:20], uint32(daclOff))

	sd := append(header, admins...)
	sd = append(sd, system...)
	sd = append(sd, dacl...)
	return sd
}

func TestParseSecurityDescriptor(t *testing.T) {
	sd, err := ParseSecurityDescriptor(buildFixtureSD())
	if err != nil {
		t.Fatalf("parse: %v", err)
	}
	if sd.Owner != "Administrators" {
		t.Errorf("owner = %q, want Administrators", sd.Owner)
	}
	if sd.Group != "Local System" {
		t.Errorf("group = %q, want Local System", sd.Group)
	}
	if len(sd.DACL) != 2 {
		t.Fatalf("expected 2 ACEs, got %d", len(sd.DACL))
	}

	a0 := sd.DACL[0]
	if !a0.Allow || a0.Type != "Allow" || a0.SID != "S-1-5-32-544" || a0.Trustee != "Administrators" {
		t.Errorf("ACE0 wrong: %+v", a0)
	}
	if a0.Mask != 0x10000000 || !contains(a0.Rights, "Generic all") {
		t.Errorf("ACE0 rights wrong: %+v", a0)
	}

	a1 := sd.DACL[1]
	if !a1.Allow || a1.Type != "Allow (object)" || a1.SID != "S-1-5-11" || a1.Trustee != "Authenticated Users" {
		t.Errorf("ACE1 wrong: %+v", a1)
	}
	if a1.ObjectType != "00299570-246d-11d0-a768-00aa006e0529" {
		t.Errorf("ACE1 ObjectType = %q", a1.ObjectType)
	}
	if !contains(a1.Rights, "Control access") {
		t.Errorf("ACE1 rights = %v", a1.Rights)
	}
}

func TestDecodeAccessMask(t *testing.T) {
	// READ_CONTROL | Read property
	got := DecodeAccessMask(0x00020010)
	if !contains(got, "Read control") || !contains(got, "Read property") {
		t.Errorf("decode mask = %v", got)
	}
}

func TestGUIDToString(t *testing.T) {
	guid := []byte{0x70, 0x95, 0x29, 0x00, 0x6d, 0x24, 0xd0, 0x11, 0xa7, 0x68, 0x00, 0xaa, 0x00, 0x6e, 0x05, 0x29}
	if got := GUIDToString(guid); got != "00299570-246d-11d0-a768-00aa006e0529" {
		t.Errorf("GUIDToString = %q", got)
	}
}

func TestParseSecurityDescriptorShort(t *testing.T) {
	if _, err := ParseSecurityDescriptor([]byte{0x01, 0x00}); err == nil {
		t.Errorf("expected error for short SD")
	}
}
