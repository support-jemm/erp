import frappe
import json

def ensure_attribute_value_exists(attribute_name, value):
	"""Creates an attribute value if it doesn't exist."""
	if not frappe.db.exists("Item Attribute Value", {"parent": attribute_name, "attribute_value": value}):
		if frappe.db.exists("Item Attribute", attribute_name):
			attr_doc = frappe.get_doc("Item Attribute", attribute_name)
			abbr = value[:3].upper() if len(value) >= 3 else value.upper()
			existing_abbrs = [v.abbr for v in attr_doc.item_attribute_values if v.abbr]
			counter = 1
			original_abbr = abbr
			while abbr in existing_abbrs:
				abbr = f"{original_abbr}{counter}"
				counter += 1
			
			attr_doc.append("item_attribute_values", {
				"attribute_value": value,
				"abbr": abbr
			})
			attr_doc.save(ignore_permissions=True)
			frappe.db.commit()

def calculate_ean13_check_digit(code_12):
	"""Calculate the EAN-13 check digit for a 12-digit code."""
	total = 0
	for i, digit in enumerate(code_12):
		if i % 2 == 0:
			total += int(digit)
		else:
			total += int(digit) * 3
	return (10 - (total % 10)) % 10

def generate_ean13():
	"""Generate a unique EAN-13 barcode."""
	existing_count = frappe.db.count("Item") or 0
	numeric_code = f"200{str(existing_count + 1).zfill(9)}"
	check_digit = calculate_ean13_check_digit(numeric_code)
	return numeric_code + str(check_digit)

def _barcode_exists(barcode: str) -> bool:
	"""Best-effort uniqueness check for Item barcodes."""
	try:
		if frappe.db.exists("DocType", "Item Barcode"):
			return bool(frappe.db.exists("Item Barcode", {"barcode": barcode}))
	except Exception:
		# If table doesn't exist / check fails, don't block creation
		return False
	return False

def generate_unique_ean13(max_tries: int = 20):
	"""Generate an EAN-13 barcode and try to avoid duplicates."""
	for _ in range(max_tries):
		barcode = generate_ean13()
		if not _barcode_exists(barcode):
			return barcode
	# Fallback: return whatever we got last
	return generate_ean13()

def _default_stock_uom() -> str:
	# Common setups: "Nos" (standard) or "шт" (UA/RU localization)
	for candidate in ("шт", "Nos"):
		if frappe.db.exists("UOM", candidate):
			return candidate
	return "Nos"

@frappe.whitelist()
def create_fashion_items(item_code, item_group, brand, color, sizes):
	"""
	Creates multiple Items based on fashion retail workflow.
	Returns list of created item documents.
	"""
	sizes_list = [s.strip() for s in sizes.split(",") if s.strip()]
	
	if not sizes_list:
		frappe.throw("At least one size is required")
	
	# Ensure attribute values exist
	ensure_attribute_value_exists("Color", color)
	for size in sizes_list:
		ensure_attribute_value_exists("Size", size)
	
	created_items = []
	errors = []
	stock_uom = _default_stock_uom()
	
	for size in sizes_list:
		# Generate item name: Category, Brand, Article, Color, Size
		item_name = f"{item_group}"
		if brand:
			item_name += f" {brand}"
		item_name += f", {item_code}, {color}, {size}"
		
		# Generate unique item_code for variant
		# Keep unicode (colors/sizes) as-is; ERPNext Item Code supports it.
		variant_item_code = f"{item_code}-{color}-{size}".replace(" ", "-").replace("/", "-").upper()
		
		# Check if already exists
		if frappe.db.exists("Item", variant_item_code):
			# Return existing
			created_items.append(frappe.get_doc("Item", variant_item_code))
			continue
		
		# Create new Item
		item = frappe.new_doc("Item")
		item.item_code = variant_item_code
		item.item_name = item_name
		item.item_group = item_group
		item.brand = brand if brand else None
		item.stock_uom = stock_uom
		item.is_stock_item = 1
		
		# Generate EAN-13 barcode
		barcode = generate_unique_ean13()
		item.append("barcodes", {
			"barcode": barcode,
			"barcode_type": "EAN"
		})
		
		try:
			item.insert(ignore_permissions=True)
			created_items.append(item)
		except Exception as e:
			msg = f"{variant_item_code}: {str(e)}"
			errors.append(msg)
			frappe.log_error(f"Failed to create item {variant_item_code}", str(e))

	# Commit once at the end (we might have created multiple docs)
	try:
		frappe.db.commit()
	except Exception:
		pass
	
	# Return items in format suitable for adding to parent document
	return {
		"items": [
			{
				"name": item.name,
				"item_code": item.item_code,
				"item_name": item.item_name,
				"stock_uom": item.stock_uom,
				"barcode": item.barcodes[0].barcode if item.barcodes else None
			}
			for item in created_items
		],
		"count": len(created_items),
		"errors": errors
	}


@frappe.whitelist()
def get_size_presets(brand: str | None = None):
	"""
	Return size presets for Quick Entry.
	- Includes global presets (brand is empty) and brand-specific presets.
	- Returns default preset name for the brand if configured.
	"""
	brand = (brand or "").strip()

	# If DocType doesn't exist yet, fall back to legacy hardcoded presets
	if not frappe.db.exists("DocType", "Fashion Size Preset"):
		legacy = [
			{"name": "Turkey (36-42)", "sizes": "36, 38, 40, 42", "brand": "", "is_default_for_brand": 0},
			{"name": "Standard (S-XL)", "sizes": "S, M, L, XL", "brand": "", "is_default_for_brand": 0},
			{"name": "Jeans (28-36)", "sizes": "28, 29, 30, 31, 32, 33, 34, 36", "brand": "", "is_default_for_brand": 0},
		]
		return {"presets": legacy, "default": legacy[0]["name"] if legacy else None}

	filters = {"disabled": 0}
	fields = ["name", "brand", "is_default_for_brand", "sizes", "preset_name"]

	# If brand is not selected yet, return all presets (user can still pick one).
	if not brand:
		presets = frappe.get_all("Fashion Size Preset", filters=filters, fields=fields)
		return {"presets": presets, "default": None}

	brand_presets = frappe.get_all("Fashion Size Preset", filters={**filters, "brand": brand}, fields=fields)
	global_presets = frappe.get_all("Fashion Size Preset", filters={**filters, "brand": ["in", ["", None]]}, fields=fields)

	default_name = None
	for p in brand_presets:
		if int(p.get("is_default_for_brand") or 0) == 1:
			default_name = p.get("name")
			break
	if not default_name and brand_presets:
		default_name = brand_presets[0].get("name")

	presets = brand_presets + global_presets
	return {"presets": presets, "default": default_name}
