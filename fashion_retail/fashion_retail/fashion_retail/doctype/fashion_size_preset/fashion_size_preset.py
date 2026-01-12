import frappe
from frappe.model.document import Document


class FashionSizePreset(Document):
	def validate(self):
		# ListView requires a real DocField as title_field; store the preset name here.
		# "name" itself isn't a DocField.
		if not self.preset_name:
			self.preset_name = self.name

		# Ensure only one default preset per Brand
		if self.brand and int(self.is_default_for_brand or 0) == 1:
			frappe.db.sql(
				"""
				UPDATE `tabFashion Size Preset`
				SET is_default_for_brand = 0
				WHERE brand = %s AND name != %s
				""",
				(self.brand, self.name),
			)

