package adtypes

import "strconv"

// UACFlag is a single bit in the AD userAccountControl attribute.
type UACFlag struct {
	Bit  int    `json:"bit"`
	Name string `json:"name"`
}

// uacFlags lists the userAccountControl bits we decode, in ascending bit order.
// Reference: MS-ADTS userAccountControl. The high-value ones for query/export
// are ACCOUNTDISABLE, LOCKOUT, DONT_EXPIRE_PASSWORD and PASSWORD_EXPIRED.
var uacFlags = []UACFlag{
	{0x00000001, "SCRIPT"},
	{0x00000002, "ACCOUNTDISABLE"},
	{0x00000008, "HOMEDIR_REQUIRED"},
	{0x00000010, "LOCKOUT"},
	{0x00000020, "PASSWD_NOTREQD"},
	{0x00000040, "PASSWD_CANT_CHANGE"},
	{0x00000080, "ENCRYPTED_TEXT_PWD_ALLOWED"},
	{0x00000100, "TEMP_DUPLICATE_ACCOUNT"},
	{0x00000200, "NORMAL_ACCOUNT"},
	{0x00000800, "INTERDOMAIN_TRUST_ACCOUNT"},
	{0x00001000, "WORKSTATION_TRUST_ACCOUNT"},
	{0x00002000, "SERVER_TRUST_ACCOUNT"},
	{0x00010000, "DONT_EXPIRE_PASSWORD"},
	{0x00020000, "MNS_LOGON_ACCOUNT"},
	{0x00040000, "SMARTCARD_REQUIRED"},
	{0x00080000, "TRUSTED_FOR_DELEGATION"},
	{0x00100000, "NOT_DELEGATED"},
	{0x00200000, "USE_DES_KEY_ONLY"},
	{0x00400000, "DONT_REQ_PREAUTH"},
	{0x00800000, "PASSWORD_EXPIRED"},
	{0x01000000, "TRUSTED_TO_AUTH_FOR_DELEGATION"},
	{0x04000000, "PARTIAL_SECRETS_ACCOUNT"},
}

// DecodeUAC returns the set names for every bit present in the value.
func DecodeUAC(value int) []string {
	names := make([]string, 0, 4)
	for _, f := range uacFlags {
		if value&f.Bit != 0 {
			names = append(names, f.Name)
		}
	}
	return names
}

// ParseUAC parses a userAccountControl value supplied as a string and decodes
// it. ok is false if the string is not an integer.
func ParseUAC(s string) (names []string, ok bool) {
	v, err := strconv.Atoi(s)
	if err != nil {
		return nil, false
	}
	return DecodeUAC(v), true
}

// Common derived booleans, exposed as helpers because they back computed grid
// columns ("Disabled", "Locked", "Password never expires").

func IsDisabled(uac int) bool          { return uac&0x00000002 != 0 }
func IsLockedOut(uac int) bool         { return uac&0x00000010 != 0 }
func PasswordNeverExpires(uac int) bool { return uac&0x00010000 != 0 }
func PasswordExpired(uac int) bool     { return uac&0x00800000 != 0 }
func IsNormalAccount(uac int) bool     { return uac&0x00000200 != 0 }
