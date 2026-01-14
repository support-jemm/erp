// Fashion Retail Custom Quick Entry for Item
// Overrides the default Item Quick Entry form

frappe.provide('frappe.ui.form');

// Register custom Quick Entry for Item DocType
frappe.ui.form.ItemQuickEntryForm = class ItemQuickEntryForm extends frappe.ui.form.QuickEntryForm {
    constructor(doctype, after_insert, init_callback, doc, force) {
        super(doctype, after_insert, init_callback, doc, force);
        this.skip_redirect_on_error = true;
        this._sizes_all = [];
        this._size_qty = {};
    }

    render_dialog() {
        // Replace default mandatory Item fields with our custom quick-create fields
        this.mandatory = this.get_variant_fields();
        super.render_dialog();

        let me = this;

        // Keep preview up-to-date
        ['item_code', 'item_group', 'brand', 'custom_color'].forEach((fieldname) => {
            const df = me.dialog.fields_dict[fieldname];
            if (df && df.$input) {
                df.$input.on('change', function () {
                    me._update_names_preview();
                });
            }
        });

        // Load presets from server and wire handlers
        this._preset_map = {};
        this._load_size_presets();
        // In some flows (especially when opened from Link field), values are set after render.
        // Re-load presets shortly after to ensure Brand-based presets appear.
        setTimeout(() => this._load_size_presets(), 200);
        setTimeout(() => this._load_size_presets(), 1000);

        // Preset change handler
        this.dialog.fields_dict.size_preset.$input.on('change', function () {
            let preset = me.dialog.get_value('size_preset');
            let sizes = me._preset_map && me._preset_map[preset];
            if (sizes) {
                me.dialog.set_value('custom_sizes', sizes);
            }
            // Wait for value propagation before rebuild
            setTimeout(() => me._rebuild_size_grid_from_sizes_string(), 0);
        });

        // Update grid on sizes list change
        this.dialog.fields_dict.custom_sizes.$input.on('change', function () {
            me._rebuild_size_grid_from_sizes_string();
        });

        // Brand change => auto-select default preset for brand
        const brand_field = this.dialog.fields_dict.brand;
        if (brand_field && brand_field.$input) {
            brand_field.$input.on('change', function () {
                me._load_size_presets();
            });
            // Also hook into field onchange (covers programmatic set_value)
            brand_field.df.onchange = function () {
                me._load_size_presets();
            };
        }

        // Build initial grid (empty)
        this._rebuild_size_grid_from_sizes_string();
        // Some defaults may be applied after dialog render; ensure we rebuild once more.
        setTimeout(() => this._rebuild_size_grid_from_sizes_string(), 50);
    }

    _load_size_presets() {
        const me = this;
        const brand = (me.dialog.get_value('brand') || '').trim();
        frappe.call({
            method: 'fashion_retail.api.get_size_presets',
            args: { brand },
            freeze: false,
            callback: function (r) {
                const presets = (r && r.message && r.message.presets) || [];
                const def = r && r.message && r.message.default;

                me._preset_map = {};
                const names = presets
                    .map(p => {
                        me._preset_map[p.name] = p.sizes || '';
                        return p.name;
                    })
                    .filter(Boolean);

                const options = [''].concat(names).join('\n');
                // set_df_property is the most reliable way to re-render Select options in Dialog
                me.dialog.set_df_property('size_preset', 'options', options);
                const field = me.dialog.fields_dict.size_preset;
                field && field.refresh && field.refresh();

                if (def && me._preset_map[def]) {
                    me.dialog.set_value('size_preset', def);
                    me.dialog.set_value('custom_sizes', me._preset_map[def]);
                    // Ensure sizes are visible immediately after auto-select
                    setTimeout(() => me._rebuild_size_grid_from_sizes_string(), 0);
                }
                // If a preset is already selected, rebuild to refresh grid
                setTimeout(() => me._rebuild_size_grid_from_sizes_string(), 0);
            },
            error: function (err) {
                console.error('Failed to load size presets', err);
                frappe.show_alert({ message: __('Failed to load size presets'), indicator: 'red' });
            }
        });
    }

    get_variant_fields() {
        return [
            {
                label: __('Item Code (Артикул)'),
                fieldname: 'item_code',
                fieldtype: 'Data',
                reqd: 1
            },
            {
                label: __('Item Group (Категорія)'),
                fieldname: 'item_group',
                fieldtype: 'Link',
                options: 'Item Group',
                reqd: 1
            },
            {
                label: __('Brand (Виробник)'),
                fieldname: 'brand',
                fieldtype: 'Link',
                options: 'Brand'
            },
            {
                fieldtype: 'Column Break'
            },
            {
                label: __('Color (Колір)'),
                fieldname: 'custom_color',
                fieldtype: 'Data',
                reqd: 1
            },
            {
                label: __('Name'),
                fieldname: 'generated_name',
                fieldtype: 'Data',
                read_only: 1
            },
            {
                fieldtype: 'Section Break',
                label: __('Sizes')
            },
            {
                label: __('Size Preset'),
                fieldname: 'size_preset',
                fieldtype: 'Select',
                options: '\n'
            },
            {
                label: __('Custom Sizes'),
                fieldname: 'custom_sizes',
                fieldtype: 'Data',
                hidden: 1
            },
            {
                label: __('Sizes'),
                fieldname: 'sizes_grid',
                fieldtype: 'HTML',
                // NOTE: HTML fields don't have a value; making them reqd triggers "Missing Values Required".
                // We validate size selection in insert().
                reqd: 0
            }
        ];
    }

    _sizes_with_qty() {
        return (this._sizes_all || []).filter(sz => {
            const qty = Number(this._size_qty[sz] || 0);
            return qty > 0;
        });
    }

    _parse_sizes_string(sizes_string) {
        return (sizes_string || '')
            .split(',')
            .map(s => (s || '').trim())
            .filter(Boolean);
    }

    _escape_html(s) {
        return frappe.utils.escape_html(s || '');
    }

    _rebuild_size_grid_from_sizes_string() {
        const sizes_field = this.dialog.fields_dict && this.dialog.fields_dict.custom_sizes;
        const sizes_string =
            (sizes_field && sizes_field.get_value && sizes_field.get_value()) ||
            this.dialog.get_value('custom_sizes') ||
            '';
        const sizes = this._parse_sizes_string(sizes_string);
        this._sizes_all = sizes;

        // Keep qty where possible, initialize new sizes with qty = 1
        const next_qty = {};
        sizes.forEach(sz => {
            if (this._size_qty.hasOwnProperty(sz)) {
                next_qty[sz] = this._size_qty[sz];
            } else {
                next_qty[sz] = 1;
            }
        });
        this._size_qty = next_qty;

        this._render_size_grid();
        this._update_names_preview();
    }

    _render_size_grid() {
        const wrapper = this.dialog.fields_dict.sizes_grid.$wrapper;
        wrapper.empty();

        const sizes = this._sizes_all || [];
        if (!sizes.length) {
            wrapper.append(`<div>${this._escape_html(__('No sizes available.'))}</div>`);
            return;
        }

        const rows = sizes.map(sz => {
            const qty = this._size_qty[sz] ?? 0;
            return `
                <div class="fashion-size-row" data-size="${this._escape_html(sz)}" style="display:flex; align-items:center; gap:12px; margin-bottom:8px;">
                    <div style="width:120px; font-weight:600;">${this._escape_html(sz)}</div>
                    <input type="number" min="0" step="1" class="form-control fashion-size-qty" style="width:140px;" value="${qty}">
                </div>
            `;
        }).join('');

        wrapper.append(`
            <div style="margin-bottom: 8px;">
                ${rows}
            </div>
            <div style="margin-top: 6px;">
                <button type="button" class="btn btn-xs btn-secondary fashion-size-fill-1">${this._escape_html(__('Set all to 1'))}</button>
                <button type="button" class="btn btn-xs btn-secondary fashion-size-clear" style="margin-left: 6px;">${this._escape_html(__('Clear'))}</button>
            </div>
        `);

        const me = this;
        wrapper.find('.fashion-size-qty').on('input', function () {
            const $row = $(this).closest('.fashion-size-row');
            const sz = $row.data('size');
            if (!sz) return;
            const v = Number($(this).val() || 0);
            me._size_qty[sz] = Math.max(0, isNaN(v) ? 0 : v);
            me._update_names_preview();
        });

        wrapper.find('.fashion-size-fill-1').on('click', function () {
            (me._sizes_all || []).forEach(sz => { me._size_qty[sz] = 1; });
            me._render_size_grid();
            me._update_names_preview();
        });

        wrapper.find('.fashion-size-clear').on('click', function () {
            (me._sizes_all || []).forEach(sz => { me._size_qty[sz] = 0; });
            me._render_size_grid();
            me._update_names_preview();
        });
    }

    _update_names_preview() {
        const item_group = (this.dialog.get_value('item_group') || '').trim();
        const brand = (this.dialog.get_value('brand') || '').trim();
        const article = (this.dialog.get_value('item_code') || '').trim();
        const color = (this.dialog.get_value('custom_color') || '').trim();

        const sizes = this._sizes_with_qty();
        const make_name = (size) => {
            let name = `${item_group}`;
            if (brand) name += ` ${brand}`;
            name += `, ${article}, ${color}, ${size}`;
            return name;
        };

        // Single "Name" field preview (shows first selected size)
        const first_size = sizes[0] || '';
        const generated_name = (first_size && item_group && article && color) ? make_name(first_size) : '';
        this.dialog.set_value('generated_name', generated_name);
    }

    _should_add_to_purchase_invoice() {
        return (typeof cur_frm !== 'undefined'
            && cur_frm
            && cur_frm.doc
            && cur_frm.doc.doctype === 'Purchase Invoice'
            && cur_frm.fields_dict
            && cur_frm.fields_dict.items);
    }

    _add_items_to_purchase_invoice(items, qty_map) {
        if (!this._should_add_to_purchase_invoice()) return;
        if (!Array.isArray(items) || !items.length) return;

        const size_qty = qty_map || {};

        const set_qty_for_item = (item_code, qty) => {
            const rows = (cur_frm.doc.items || []).filter(r => r.item_code === item_code);
            if (rows.length) {
                rows.forEach(r => {
                    frappe.model.set_value(r.doctype, r.name, 'qty', qty);
                });
                return true;
            }
            return false;
        };

        // First item goes into the field that triggered quick entry (handled via update_calling_link / after_insert)
        const first = items[0];
        const first_qty = Math.max(1, Number(size_qty[first.size] || 1));
        // Try immediately, then once more after link field updates
        set_qty_for_item(first.item_code, first_qty);
        setTimeout(() => set_qty_for_item(first.item_code, first_qty), 200);

        const rest = items.slice(1);
        rest.forEach(item => {
            const row = cur_frm.add_child('items');
            frappe.model.set_value(row.doctype, row.name, 'item_code', item.item_code);
            const qty = Math.max(1, Number(size_qty[item.size] || 1));
            frappe.model.set_value(row.doctype, row.name, 'qty', qty);
        });

        cur_frm.refresh_field('items');
    }

    _msgprint_created(items) {
        const rows = (items || []).map(it => `
            <tr>
                <td>${this._escape_html(it.item_code)}</td>
                <td>${this._escape_html(it.item_name)}</td>
                <td>${this._escape_html(it.barcode || '')}</td>
            </tr>
        `).join('');

        const html = `
            <div style="overflow:auto;">
                <table class="table table-bordered table-condensed">
                    <thead>
                        <tr>
                            <th>${this._escape_html(__('Item Code'))}</th>
                            <th>${this._escape_html(__('Name'))}</th>
                            <th>${this._escape_html(__('Barcode'))}</th>
                        </tr>
                    </thead>
                    <tbody>${rows}</tbody>
                </table>
            </div>
        `;

        frappe.msgprint({
            title: __('Items Created'),
            indicator: 'green',
            message: html
        });
    }

    insert() {
        let me = this;

        // IMPORTANT: QuickEntryForm doesn't catch promise rejections.
        // If we reject, the dialog gets stuck in "Saving..." state. Always resolve and reset dialog.working.
        return new Promise((resolve) => {
            let values = me.dialog.get_values();
            if (!values) {
                me.dialog.working = false;
                resolve(me.dialog.doc);
                return;
            }

            const qty_map = { ...(me._size_qty || {}) };
            let sizes_selected = (me._sizes_all || []).filter(sz => Number(qty_map[sz] || 0) > 0);
            if (!sizes_selected.length) {
                frappe.msgprint({
                    title: __('Missing Sizes'),
                    indicator: 'red',
                    message: __('Please enter quantity for at least one size.')
                });
                me.dialog.working = false;
                resolve(me.dialog.doc);
                return;
            }

            frappe.call({
                method: 'fashion_retail.api.create_fashion_items',
                args: {
                    item_code: values.item_code,
                    item_group: values.item_group,
                    brand: values.brand || '',
                    color: values.custom_color,
                    sizes: sizes_selected.join(', '),
                    sizes_qty: JSON.stringify(qty_map)
                },
                freeze: true,
                freeze_message: __('Creating Items...'),
                callback: function (r) {
                    const items = r && r.message && r.message.items;
                    const errors = r && r.message && r.message.errors;
                    if (Array.isArray(items) && items.length) {
                        frappe.show_alert({
                            message: __('Created {0} items', [items.length]),
                            indicator: 'green'
                        });

                        // Update the calling Link field (Purchase Invoice row, etc.)
                        if (frappe._from_link) {
                            frappe.ui.form.update_calling_link({
                                doctype: 'Item',
                                name: items[0].name,
                                item_name: items[0].item_name
                            });
                        } else if (me.after_insert) {
                            // fallback for non-link invocations
                            me.after_insert(items[0]);
                        }

                        me._add_items_to_purchase_invoice(items, qty_map);
                        me._msgprint_created(items);

                        me.dialog.hide();
                    } else {
                        let msg = __('No items were created. Please check size selection and try again.');
                        if (Array.isArray(errors) && errors.length) {
                            msg += '<br><br><b>' + me._escape_html(__('Server errors:')) + '</b><br>';
                            msg += '<pre style="white-space:pre-wrap;">' + me._escape_html(errors.join('\\n')) + '</pre>';
                        }
                        frappe.msgprint({
                            title: __('No Items Created'),
                            indicator: 'red',
                            message: msg
                        });
                    }
                },
                error: function () {
                    frappe.msgprint({
                        title: __('Failed'),
                        indicator: 'red',
                        message: __('Failed to create items. Check server logs.')
                    });
                },
                always: function () {
                    me.dialog.working = false;
                    resolve(me.dialog.doc);
                }
            });
        });
    }
};

// ---------------------------------------------------------------------------
// Custom Quick Entry for "Fashion Size Preset"
// NOTE: Defined here (instead of a separate file) because this file is already
// known to be loaded in your Desk, and we want this override to be reliable.
// ---------------------------------------------------------------------------

frappe.ui.form.FashionSizePresetQuickEntryForm = class FashionSizePresetQuickEntryForm extends frappe.ui.form.QuickEntryForm {
    constructor(doctype, after_insert, init_callback, doc, force) {
        super(doctype, after_insert, init_callback, doc, force);
        this.skip_redirect_on_error = true;
        this._sizes = [];
    }

    render_dialog() {
        this.mandatory = this.get_fields();
        super.render_dialog();
        this._init_sizes_editor();
    }

    get_fields() {
        return [
            {
                label: __('Preset Name'),
                fieldname: '__newname',
                fieldtype: 'Data',
                reqd: 1
            },
            {
                label: __('Brand'),
                fieldname: 'brand',
                fieldtype: 'Link',
                options: 'Brand'
            },
            {
                label: __('Default for this Brand'),
                fieldname: 'is_default_for_brand',
                fieldtype: 'Check',
                default: 0
            },
            {
                fieldtype: 'Column Break'
            },
            {
                label: __('Disabled'),
                fieldname: 'disabled',
                fieldtype: 'Check',
                default: 0
            },
            {
                fieldtype: 'Section Break',
                label: __('Sizes')
            },
            {
                fieldname: 'sizes_editor',
                fieldtype: 'HTML'
            }
        ];
    }

    _escape(s) {
        return frappe.utils.escape_html(s || '');
    }

    _init_sizes_editor() {
        const wrapper = this.dialog.fields_dict.sizes_editor.$wrapper;
        wrapper.empty();

        const html = `
            <div>
                <div class="text-muted" style="margin-bottom: 8px;">
                    ${this._escape(__('Type a size and press Enter. Example: XS, S, M, 36, 38, 40'))}
                </div>
                <div class="fashion-size-chips" style="margin-bottom: 8px;"></div>
                <input type="text" class="form-control fashion-size-input" placeholder="${this._escape(__('Add size…'))}" />
                <div class="text-muted" style="margin-top: 6px;">
                    ${this._escape(__('Tip: Backspace removes last size.'))}
                </div>
            </div>
        `;

        wrapper.append(html);

        const me = this;
        const $chips = wrapper.find('.fashion-size-chips');
        const $input = wrapper.find('.fashion-size-input');

        const render = () => {
            $chips.empty();
            me._sizes.forEach((sz, idx) => {
                $chips.append(`
                    <span class="badge badge-pill badge-secondary" style="margin: 0 6px 6px 0; padding: 6px 10px;">
                        ${me._escape(sz)}
                        <a href="#" data-idx="${idx}" style="margin-left: 8px; color: inherit; text-decoration: none;">×</a>
                    </span>
                `);
            });
        };

        $chips.on('click', 'a[data-idx]', function (e) {
            e.preventDefault();
            const idx = Number($(this).data('idx'));
            if (!Number.isFinite(idx)) return;
            me._sizes.splice(idx, 1);
            render();
        });

        $input.on('keydown', function (e) {
            if (e.key === 'Enter') {
                e.preventDefault();
                const v = ($input.val() || '').trim();
                if (v) {
                    if (!me._sizes.includes(v)) me._sizes.push(v);
                    $input.val('');
                    render();
                }
                return;
            }
            if (e.key === 'Backspace' && !($input.val() || '').length && me._sizes.length) {
                me._sizes.pop();
                render();
            }
        });

        // Prefill if editing
        const existing = (this.dialog.doc && this.dialog.doc.sizes || '').trim();
        if (existing) {
            me._sizes = existing.split(',').map(s => s.trim()).filter(Boolean);
        }
        render();
        setTimeout(() => $input.trigger('focus'), 50);
    }

    insert() {
        const sizes = (this._sizes || []).join(', ').trim();
        if (!sizes) {
            frappe.msgprint({
                title: __('Missing Sizes'),
                indicator: 'red',
                message: __('Please add at least one size.')
            });
            this.dialog.working = false;
            return Promise.resolve(this.dialog.doc);
        }
        this.dialog.doc.sizes = sizes;
        return super.insert();
    }
};

window.__fashion_retail_fashion_size_preset_qe_loaded = true;
