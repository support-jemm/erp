// Fashion Retail Custom Quick Entry for Item
// Overrides the default Item Quick Entry form

frappe.provide('frappe.ui.form');

// Register custom Quick Entry for Item DocType
frappe.ui.form.ItemQuickEntryForm = class ItemQuickEntryForm extends frappe.ui.form.QuickEntryForm {
    constructor(doctype, after_insert, init_callback, doc, force) {
        super(doctype, after_insert, init_callback, doc, force);
        this.skip_redirect_on_error = true;
        this._sizes_all = [];
        this._sizes_selected = new Set();
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
            if (sizes) me.dialog.set_value('custom_sizes', sizes);
            me._rebuild_size_grid_from_sizes_string();
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
                    me._rebuild_size_grid_from_sizes_string();
                }
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
                reqd: 1,
                description: 'Наприклад: Чорний, Червоний'
            },
            {
                label: __('Name'),
                fieldname: 'generated_name',
                fieldtype: 'Data',
                read_only: 1,
                description: __('Auto-generated: Category, Brand, Article, Color, Size')
            },
            {
                label: __('Size Preset'),
                fieldname: 'size_preset',
                fieldtype: 'Select',
                options: '\n'
            },
            {
                label: __('Sizes List (advanced)'),
                fieldname: 'custom_sizes',
                fieldtype: 'Data',
                description: __('Optional. Comma separated list used to build the size grid. Example: 36, 38, 40, 42')
            },
            {
                label: __('Sizes Grid (Сітка розмірів)'),
                fieldname: 'sizes_grid',
                fieldtype: 'HTML',
                // NOTE: HTML fields don't have a value; making them reqd triggers "Missing Values Required".
                // We validate size selection in insert().
                reqd: 0
            },
            {
                fieldtype: 'Section Break',
                label: __('Preview')
            },
            {
                label: __('Items Count'),
                fieldname: 'items_count',
                fieldtype: 'Int',
                read_only: 1,
                default: 0
            },
            {
                label: __('Generated Names'),
                fieldname: 'names_preview',
                fieldtype: 'Small Text',
                read_only: 1
            },
            {
                label: __('Barcode'),
                fieldname: 'barcode_preview',
                fieldtype: 'Data',
                read_only: 1,
                default: __('Will be generated automatically on Save')
            }
        ];
    }

    update_count() {
        let count = Array.from(this._sizes_selected).length;
        this.dialog.set_value('items_count', count);
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

        // Keep selection where possible
        const next_selected = new Set();
        sizes.forEach(sz => {
            if (this._sizes_selected.has(sz)) next_selected.add(sz);
        });
        this._sizes_selected = next_selected;

        // If there are sizes but nothing selected yet, auto-select all (more convenient)
        if (sizes.length && this._sizes_selected.size === 0) {
            sizes.forEach(sz => this._sizes_selected.add(sz));
        }

        this._render_size_grid();
        this.update_count();
        this._update_names_preview();
    }

    _render_size_grid() {
        const wrapper = this.dialog.fields_dict.sizes_grid.$wrapper;
        wrapper.empty();

        const sizes = this._sizes_all || [];
        if (!sizes.length) {
            wrapper.append(
                `<div class="text-muted">${this._escape_html(__('Choose a preset or enter sizes list to build the grid.'))}</div>`
            );
            return;
        }

        const pills = sizes.map(sz => {
            const active = this._sizes_selected.has(sz) ? 'active' : '';
            return `
                <button type="button"
                    class="btn btn-default btn-xs fashion-size-pill ${active}"
                    data-size="${this._escape_html(sz)}"
                    style="margin: 0 6px 6px 0;"
                >${this._escape_html(sz)}</button>
            `;
        }).join('');

        wrapper.append(`
            <div style="margin-bottom: 8px;">
                <div class="text-muted" style="margin-bottom: 6px;">${this._escape_html(__('Click sizes to toggle selection.'))}</div>
                <div>${pills}</div>
            </div>
            <div style="margin-top: 8px;">
                <button type="button" class="btn btn-xs btn-secondary fashion-size-select-all">${this._escape_html(__('Select All'))}</button>
                <button type="button" class="btn btn-xs btn-secondary fashion-size-clear" style="margin-left: 6px;">${this._escape_html(__('Clear'))}</button>
            </div>
        `);

        const me = this;
        wrapper.find('.fashion-size-pill').on('click', function () {
            const sz = $(this).data('size');
            if (!sz) return;
            if (me._sizes_selected.has(sz)) me._sizes_selected.delete(sz);
            else me._sizes_selected.add(sz);

            $(this).toggleClass('active', me._sizes_selected.has(sz));
            me.update_count();
            me._update_names_preview();
        });

        wrapper.find('.fashion-size-select-all').on('click', function () {
            me._sizes_selected = new Set(me._sizes_all || []);
            me._render_size_grid();
            me.update_count();
            me._update_names_preview();
        });

        wrapper.find('.fashion-size-clear').on('click', function () {
            me._sizes_selected = new Set();
            me._render_size_grid();
            me.update_count();
            me._update_names_preview();
        });
    }

    _update_names_preview() {
        const item_group = (this.dialog.get_value('item_group') || '').trim();
        const brand = (this.dialog.get_value('brand') || '').trim();
        const article = (this.dialog.get_value('item_code') || '').trim();
        const color = (this.dialog.get_value('custom_color') || '').trim();

        const sizes = Array.from(this._sizes_selected);
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

        // Multi-line preview for all (or many) sizes
        const lines = sizes.slice(0, 12).map(make_name);

        let preview = lines.join('\n');
        if (sizes.length > 12) preview += `\n… +${sizes.length - 12} more`;

        this.dialog.set_value('names_preview', preview);
    }

    _should_add_to_purchase_invoice() {
        return (typeof cur_frm !== 'undefined'
            && cur_frm
            && cur_frm.doc
            && cur_frm.doc.doctype === 'Purchase Invoice'
            && cur_frm.fields_dict
            && cur_frm.fields_dict.items);
    }

    _add_items_to_purchase_invoice(items) {
        if (!this._should_add_to_purchase_invoice()) return;
        if (!Array.isArray(items) || !items.length) return;

        // First item goes into the field that triggered quick entry (handled via update_calling_link / after_insert)
        const rest = items.slice(1);
        rest.forEach(item => {
            const row = cur_frm.add_child('items');
            frappe.model.set_value(row.doctype, row.name, 'item_code', item.item_code);
            frappe.model.set_value(row.doctype, row.name, 'qty', 1);
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

            let sizes_selected = Array.from(me._sizes_selected).filter(Boolean);
            if (!sizes_selected.length) {
                // Fallback: if user typed sizes but didn't click pills (change/input events might not fire),
                // treat the typed list as selected.
                const sizes_field = me.dialog.fields_dict && me.dialog.fields_dict.custom_sizes;
                const sizes_string =
                    (sizes_field && sizes_field.get_value && sizes_field.get_value()) ||
                    me.dialog.get_value('custom_sizes') ||
                    '';
                const parsed = me._parse_sizes_string(sizes_string);
                if (parsed.length) {
                    me._sizes_selected = new Set(parsed);
                    me._sizes_all = parsed;
                    me._render_size_grid();
                    me.update_count();
                    me._update_names_preview();
                    sizes_selected = parsed;
                }
            }

            if (!sizes_selected.length) {
                frappe.msgprint({
                    title: __('Missing Sizes'),
                    indicator: 'red',
                    message: __('Please select at least one size in the grid.')
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
                    sizes: sizes_selected.join(', ')
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

                        me._add_items_to_purchase_invoice(items);
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
