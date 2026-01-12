app_name = "fashion_retail"
app_title = "Fashion Retail"
app_publisher = "User"
app_description = "Fashion Retail Customizations"
app_email = "user@example.com"
app_license = "MIT"

# Includes in <head>
# ------------------

# Include JS globally
# - item_extension.js: legacy/custom buttons (e.g., size grid)
# - item_quick_entry.js: overrides Item Quick Entry form (multi-size creation + add to Purchase Invoice items)
app_include_js = [
	"/assets/fashion_retail/js/item_extension.js",
	"/assets/fashion_retail/js/item_quick_entry.js",
	"/assets/fashion_retail/js/fashion_size_preset_quick_entry.js",
]

# Document Events
# ---------------
doc_events = {
	"Item": {
		"autoname": "fashion_retail.item_customization.autoname_item",
		"before_save": "fashion_retail.item_customization.generate_barcode",
	}
}
