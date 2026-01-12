// Custom Quick Entry for "Fashion Size Preset"
// Modern sizes input (chips) + everything editable in the short form

frappe.provide('frappe.ui.form');

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

        // If opened with existing doc (rare), prefill from doc.sizes
        const existing = (this.dialog.doc && this.dialog.doc.sizes || '').trim();
        if (existing) {
            me._sizes = existing.split(',').map(s => s.trim()).filter(Boolean);
        }
        render();
        setTimeout(() => $input.trigger('focus'), 50);
    }

    insert() {
        // Validate sizes before saving
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
        // Write to the real DocField so Frappe validation passes (sizes is reqd in DocType)
        this.dialog.doc.sizes = sizes;
        return super.insert();
    }
};

