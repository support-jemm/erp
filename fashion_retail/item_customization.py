import frappe
from frappe.model.naming import make_autoname

def autoname_item(doc, method):
	"""
	Auto-generates Item Code and Name based on Fashion Retail rules.
	"""
	# Only apply if not already named (or force overwrite if needed, but safe to check)
	if doc.name and not doc.name.startswith("New Item"):
		return

	# Requirements: Item Group, Brand, Manufacturer Part No (which we map to 'manufacturer_part_no' or custom field)
	# Assuming standard fields: item_group, brand. MPN might be standard 'manufacturer_part_no'.
	
	if not doc.brand or not doc.manufacturer_part_no:
		# Fallback to standard behavior if missing key fields to avoid blocking creation
		return

	# Helper to sanitize
	def clean(val):
		return str(val).strip().replace(" ", "-").replace("/", "-").upper()

	brand = clean(doc.brand)
	mpn = clean(doc.manufacturer_part_no)
	
	# 1. Template naming
	if not doc.variant_of:
		# Pattern: {Brand}-{MPN}
		new_item_code = f"{brand}-{mpn}"
		new_item_name = f"{doc.item_group} {doc.brand}, {doc.manufacturer_part_no}"
		
		doc.item_code = new_item_code
		doc.item_name = new_item_name
		doc.name = new_item_code
	
	# 2. Variant naming
	else:
		# Pattern: {Brand}-{MPN}-{Color}-{Size}
		# We need to extract Color and Size from attributes
		color = ""
		size = ""
		
		# Attributes is a list of objects {attribute: "Color", attribute_value: "Red"}
		for attr in doc.attributes:
			if attr.attribute.lower() == "color":
				color = clean(attr.attribute_value)
			elif attr.attribute.lower() == "size":
				size = clean(attr.attribute_value)
		
		if color and size:
			new_item_code = f"{brand}-{mpn}-{color}-{size}"
			new_item_name = f"{doc.item_group} {doc.brand}, {doc.manufacturer_part_no}, {attribute_value_map(doc, 'Color')}, {attribute_value_map(doc, 'Size')}"
			
			doc.item_code = new_item_code
			doc.item_name = new_item_name
			doc.name = new_item_code

def attribute_value_map(doc, attr_name):
	for attr in doc.attributes:
		if attr.attribute.lower() == attr_name.lower():
			return attr.attribute_value
	return ""

def generate_barcode(doc, method):
	"""
	Generates an EAN-13 barcode if the barcodes table is empty.
	Uses a sequential counter to create unique numeric barcodes.
	"""
	if not doc.barcodes:
		if doc.item_code:
			# Generate a 12-digit numeric code (EAN-13 uses 12 + 1 check digit)
			# Using a simple sequential approach based on existing item count
			existing_count = frappe.db.count("Item") or 0
			# Format: 200 (internal use prefix) + 9 digit sequence + check digit (calculated by system)
			numeric_code = f"200{str(existing_count + 1).zfill(9)}"
			
			# Calculate EAN-13 check digit
			check_digit = calculate_ean13_check_digit(numeric_code)
			full_barcode = numeric_code + str(check_digit)
			
			doc.append("barcodes", {
				"barcode": full_barcode,
				"barcode_type": "EAN"
			})

def calculate_ean13_check_digit(code_12):
	"""Calculate the EAN-13 check digit for a 12-digit code."""
	total = 0
	for i, digit in enumerate(code_12):
		if i % 2 == 0:
			total += int(digit)
		else:
			total += int(digit) * 3
	check = (10 - (total % 10)) % 10
	return check
