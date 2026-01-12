frappe.ui.form.on('Item', {
    refresh: function (frm) {
        if (frm.doc.has_variants && !frm.doc.variant_of) {
            frm.add_custom_button(__('Create Size Grid'), function () {
                show_variant_grid_dialog(frm);
            });
        }
    }
});

function show_variant_grid_dialog(frm) {
    let d = new frappe.ui.Dialog({
        title: 'Create Size Grid',
        fields: [
            {
                label: 'Color',
                fieldname: 'color',
                fieldtype: 'Data',
                reqd: 1,
                description: 'Enter color name (e.g. Red, Blue, Black)'
            },
            {
                label: 'Size Preset',
                fieldname: 'size_preset',
                fieldtype: 'Select',
                options: [
                    '',
                    'Turkey (36-42)',
                    'Standard (S-XL)',
                    'Jeans (28-36)'
                ],
                onchange: function () {
                    let preset = d.get_value('size_preset');
                    let sizes = '';
                    if (preset === 'Turkey (36-42)') {
                        sizes = '36, 38, 40, 42';
                    } else if (preset === 'Standard (S-XL)') {
                        sizes = 'S, M, L, XL';
                    } else if (preset === 'Jeans (28-36)') {
                        sizes = '28, 29, 30, 31, 32, 33, 34, 36';
                    }
                    d.set_value('sizes', sizes);
                }
            },
            {
                label: 'Sizes (Comma separated)',
                fieldname: 'sizes',
                fieldtype: 'Data',
                reqd: 1,
                description: 'e.g. 36, 38, 40, 42'
            }
        ],
        primary_action_label: 'Create Variants',
        primary_action: function (values) {

            frappe.call({
                method: 'fashion_retail.api.create_variants_from_grid',
                args: {
                    template_item: frm.doc.name,
                    variants_json: JSON.stringify(values)
                },
                freeze: true,
                freeze_message: __('Creating Variants...'),
                callback: function (r) {
                    if (!r.exc) {
                        frappe.msgprint(r.message.message);
                        d.hide();
                        frm.reload_doc();
                    }
                }
            });
        }
    });

    d.show();
}
