package m365

// Friendly names for common license SKU part numbers. Unknown SKUs pass through
// unchanged so nothing is hidden.
var skuNames = map[string]string{
	"ENTERPRISEPACK":        "Office 365 E3",
	"ENTERPRISEPREMIUM":     "Office 365 E5",
	"STANDARDPACK":          "Office 365 E1",
	"SPE_E3":                "Microsoft 365 E3",
	"SPE_E5":                "Microsoft 365 E5",
	"SPE_F1":                "Microsoft 365 F3",
	"O365_BUSINESS_PREMIUM": "Microsoft 365 Business Standard",
	"O365_BUSINESS_ESSENTIALS": "Microsoft 365 Business Basic",
	"SPB":                   "Microsoft 365 Business Premium",
	"EXCHANGESTANDARD":      "Exchange Online (Plan 1)",
	"EXCHANGEENTERPRISE":    "Exchange Online (Plan 2)",
	"POWER_BI_PRO":          "Power BI Pro",
	"PROJECTPROFESSIONAL":   "Project Plan 3",
	"VISIOCLIENT":           "Visio Plan 2",
	"FLOW_FREE":             "Power Automate (Free)",
	"AAD_PREMIUM":           "Entra ID P1",
	"AAD_PREMIUM_P2":        "Entra ID P2",
	"EMS":                   "Enterprise Mobility + Security E3",
	"EMSPREMIUM":            "Enterprise Mobility + Security E5",
}

// FriendlySku maps a skuPartNumber to a readable product name, or returns the
// raw value if it isn't recognised.
func FriendlySku(sku string) string {
	if name, ok := skuNames[sku]; ok {
		return name
	}
	return sku
}
