'use strict';

// ── State ──────────────────────────────────────────────────────────────

const state = {
    view: 'main',
    data: null,
    isAdmin: false,
    dept: null,
    sub: null,
    gender: null,
    breadcrumb: [],
    page: 0,
    perPage: 8,
};

// Uniform list for the current page — avoids passing complex objects through onclick attrs
let _uniforms = [];

// Keyboard navigation state
let _focusIdx   = -1;
let _focusItems = [];
let _focusCol   = 0;     // 0 = card, 1+ = ▲/▼ button within the focused card
let _pendingKb  = null;  // focus to restore after a keyboard-driven reorder re-renders the list

// Whether the NUI currently holds cursor focus (admin views need it for typing)
let _cursorMode     = false;
// Whether the player manually enabled cursor via Alt (persists across player views)
let _cursorOverride = false;

const _adminViews = new Set(['admin','admin-depts','admin-dept-detail','admin-uniforms','admin-unif-sub']);

function setCursorMode(needs) {
    if (_cursorMode === needs) return;
    _cursorMode = needs;
    nuiFetch('setFocusMode', { cursor: needs });
}

// ── NUI bridge ────────────────────────────────────────────────────────

function nuiFetch(event, data) {
    return fetch(`https://EUP-Menu/${event}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data || {}),
    });
}

function nuiClose() {
    hidePanel();
    nuiFetch('closeMenu');
}

window.addEventListener('message', e => {
    const msg = e.data;
    if (!msg || !msg.action) return;

    if (msg.action === 'open') {
        state.data      = msg.data;
        state.isAdmin   = !!msg.isAdmin;
        _cursorMode     = false;   // reset so setCursorMode fires on first render
        _cursorOverride = false;
        navigate('main');
        showPanel();
    } else if (msg.action === 'close') {
        hidePanel();
    } else if (msg.action === 'dataUpdate') {
        state.data = msg.data;
        // Refresh sub/dept refs so stale objects don't break rendering
        if (state.dept) {
            state.dept = (state.data.departments || []).find(d => d.name === state.dept.name) || state.dept;
        }
        if (state.sub && state.dept) {
            state.sub = (state.dept.submenus || []).find(s => s.name === state.sub.name) || state.sub;
        }
        render();
    } else if (msg.action === 'notify') {
        showToast(msg.message);
    }
});

// ── Panel show/hide ───────────────────────────────────────────────────

function showPanel() {
    document.getElementById('overlay').classList.add('visible');
}

function hidePanel() {
    document.getElementById('overlay').classList.remove('visible');
    navigate('main');
}

// SetNuiFocusKeepInput(true) means JS receives keydown even in no-cursor mode,
// so this handler fires for ALL menu interactions.
document.addEventListener('keydown', e => {
    if (!document.getElementById('overlay').classList.contains('visible')) return;

    // Alt: toggle mouse cursor for player-facing views
    if (e.key === 'Alt') {
        e.preventDefault();
        if (!_adminViews.has(state.view)) {
            _cursorOverride = !_cursorOverride;
            setCursorMode(_cursorOverride);
        }
        return;
    }

    // Escape / Backspace: go back one level, or close at the root.
    // Skip when focus is inside a text field so typing isn't disrupted.
    if (e.key === 'Escape' || e.key === 'Backspace') {
        if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;
        e.preventDefault();
        if (state.breadcrumb.length > 0) goBack();
        else nuiClose();
        return;
    }

    if (e.target.tagName === 'INPUT' || e.target.tagName === 'SELECT' || e.target.tagName === 'TEXTAREA') return;

    if (e.key === 'ArrowDown') {
        e.preventDefault();
        kbFocus(_focusIdx < 0 ? 0 : _focusIdx + 1);
    } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        kbFocus(_focusIdx < 0 ? kbCards().length - 1 : _focusIdx - 1);
    } else if (e.key === 'Enter') {
        e.preventDefault();
        kbActivate();
    } else if (e.key === 'ArrowRight') {
        e.preventDefault();
        kbMoveCol(1);
    } else if (e.key === 'ArrowLeft') {
        e.preventDefault();
        // Step back out of the ▲/▼ buttons first; only go back a page from the card itself.
        if (kbMoveCol(-1)) return;
        if (state.breadcrumb.length > 0) goBack();
        else nuiClose();
    }
});

// ── Navigation ────────────────────────────────────────────────────────

function navigate(view, params) {
    state.view = view;
    state.page = 0;
    if (params) Object.assign(state, params);
    render();
}

function goBack() {
    if (state.breadcrumb.length === 0) return;
    const prev = state.breadcrumb.pop();
    state.view = prev.view;
    state.page = 0;
    if (prev.params) Object.assign(state, prev.params);
    render();
}

function navPush(label, thenView, thenParams) {
    state.breadcrumb.push({ label, view: state.view, params: snapState() });
    navigate(thenView, thenParams);
}

function snapState() {
    return { dept: state.dept, sub: state.sub, gender: state.gender };
}

// ── Render dispatcher ─────────────────────────────────────────────────

function render() {
    // Re-resolve dept/sub from latest data on every render so stale breadcrumb
    // restores (after a move/rename/delete) never survive into the next render.
    if (state.dept && state.data) {
        const fd = (state.data.departments || []).find(d => d.name === state.dept.name);
        if (fd) {
            state.dept = fd;
            if (state.sub) {
                const fs = (fd.submenus || []).find(s => s.name === state.sub.name);
                if (fs) state.sub = fs;
            }
        }
    }
    // Admin views always need cursor (text inputs). Player views use the
    // manual Alt override; entering admin clears the override so leaving
    // admin always returns to no-cursor mode.
    if (_adminViews.has(state.view)) {
        _cursorOverride = false;
        setCursorMode(true);
    } else {
        setCursorMode(_cursorOverride);
    }

    const views = {
        'main':               renderMain,
        'dept':               renderDept,
        'sub':                renderSub,
        'uniforms':           renderUniforms,
        'admin':              renderAdmin,
        'admin-depts':        renderAdminDepts,
        'admin-dept-detail':  renderAdminDeptDetail,
        'admin-uniforms':     renderAdminUniforms,
        'admin-unif-sub':     renderAdminUnifSub,
    };
    (views[state.view] || renderMain)();
    renderBreadcrumb();
    // Clear keyboard focus whenever the view changes
    _focusIdx = -1;
    _focusItems = [];
    _focusCol = 0;
    restoreKbFocus();
}

// ── Header / breadcrumb ───────────────────────────────────────────────

function setHeader(title, subtitle) {
    document.getElementById('panel-title').textContent   = title   || '';
    document.getElementById('panel-subtitle').textContent = subtitle || '';
}

function renderBreadcrumb() {
    const el  = document.getElementById('breadcrumb');
    const txt = document.getElementById('breadcrumb-text');
    if (state.breadcrumb.length === 0) {
        el.classList.remove('visible');
    } else {
        el.classList.add('visible');
        txt.textContent = state.breadcrumb.map(b => b.label).join(' › ');
    }
}

// ── List / pagination helpers ─────────────────────────────────────────

function paginate(items) {
    const total = items.length === 0 ? 1 : Math.ceil(items.length / state.perPage);
    const page  = Math.max(0, Math.min(state.page, total - 1));
    state.page  = page;
    const start = page * state.perPage;

    const footer = document.getElementById('list-footer');
    if (total > 1) {
        footer.style.display = '';
        document.getElementById('page-info').textContent = `Page ${page + 1} of ${total}`;
        document.getElementById('prev-btn').disabled = page === 0;
        document.getElementById('next-btn').disabled = page >= total - 1;
    } else {
        footer.style.display = 'none';
    }

    return items.slice(start, start + state.perPage);
}

function changePage(dir) {
    state.page += dir;
    render();
}

function setList(html) {
    document.getElementById('list').innerHTML = html || '<div class="empty-state">Nothing here.</div>';
}

// ── Escaping ──────────────────────────────────────────────────────────

// HTML-escape for text content
function esc(str) {
    return String(str || '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

// For embedding a value as a single-quoted JS string inside a double-quoted HTML attribute:
//   onclick="fn('${escS(val)}')"
function escS(str) {
    return String(str || '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/\r/g, '\\r')
        .replace(/\n/g, '\\n');
}

// ── Card builder ──────────────────────────────────────────────────────

function card({ name, meta, accent, admin, dashed, empty, arrow = true, onclick, actions, extra, kbKey }) {
    const cls = ['card',
        admin  ? 'card--admin'  : '',
        dashed ? 'card--dashed' : '',
        empty  ? 'card--empty'  : '',
    ].filter(Boolean).join(' ');

    const accentStyle = accent ? ` style="background:${accent}"` : '';
    let right = '';
    if (actions)        right = `<div class="card-actions">${actions}</div>`;
    else if (arrow)     right = `<span class="card-arrow">›</span>`;

    return `
<div class="${cls}"${onclick ? ` onclick="${onclick}"` : ''}${kbKey ? ` data-kb-key="${kbKey}"` : ''}>
    <div class="card-accent"${accentStyle}></div>
    <div class="card-body">
        <div class="card-name">${esc(name)}</div>
        ${meta ? `<div class="card-meta">${esc(meta)}</div>` : ''}
    </div>
    ${right}
</div>${extra ? '\n' + extra : ''}`;
}

// ── MAIN VIEW ─────────────────────────────────────────────────────────

function renderMain() {
    state.breadcrumb = [];
    state.dept = null;
    state.sub  = null;
    state.gender = null;
    setHeader('EUP Menu', 'Select a department');

    const depts = (state.data && state.data.departments) || [];
    const items = [];

    if (state.isAdmin) {
        items.push(card({
            name: 'Admin Panel',
            meta: 'Manage departments, sub-categories and uniforms',
            admin: true,
            onclick: "navPush('EUP Menu','admin')",
        }));
    }

    if (depts.length === 0) {
        setList(items.join('') + '<div class="empty-state">No departments available.</div>');
        document.getElementById('list-footer').style.display = 'none';
        return;
    }

    const slice = paginate(depts);
    slice.forEach(dept => {
        const n = (dept.submenus || []).length;
        items.push(card({
            name: dept.name,
            meta: dept.description || `${n} sub-categor${n === 1 ? 'y' : 'ies'}`,
            onclick: `selectDept('${escS(dept.name)}')`,
        }));
    });

    setList(items.join(''));
}

// ── DEPT VIEW ─────────────────────────────────────────────────────────

function selectDept(deptName) {
    const dept = (state.data.departments || []).find(d => d.name === deptName);
    if (!dept) return;
    state.breadcrumb.push({ label: 'EUP Menu', view: 'main', params: { dept: null, sub: null, gender: null } });
    navigate('dept', { dept, sub: null, gender: null });
}

function renderDept() {
    setHeader(state.dept.name, state.dept.description || 'Select a sub-category');
    const subs = state.dept.submenus || [];

    if (subs.length === 0) {
        setList('<div class="empty-state">No sub-categories.</div>');
        document.getElementById('list-footer').style.display = 'none';
        return;
    }

    const slice = paginate(subs);
    setList(slice.map(sub => {
        const n = (sub.uniforms || []).length;
        return card({
            name: sub.name,
            meta: sub.description || `${n} uniform${n === 1 ? '' : 's'}`,
            onclick: `selectSub('${escS(sub.name)}')`,
        });
    }).join(''));
}

// ── SUB VIEW ─────────────────────────────────────────────────────────

function selectSub(subName) {
    const sub = (state.dept.submenus || []).find(s => s.name === subName);
    if (!sub) return;
    state.breadcrumb.push({ label: state.dept.name, view: 'dept', params: { sub: null, gender: null } });
    navigate('sub', { sub, gender: null });
}

function renderSub() {
    const label = (state.dept.abbreviation || '') !== '' ? state.dept.abbreviation : state.dept.name;
    setHeader(`${label} › ${state.sub.name}`, state.sub.description || 'Select gender');

    const uniforms  = state.sub.uniforms || [];
    const hasMale   = uniforms.some(u => u.pedModel !== 'mp_f_freemode_01');
    const hasFemale = uniforms.some(u => u.pedModel === 'mp_f_freemode_01');

    if (!hasMale && !hasFemale) {
        setList(card({ name: 'No Uniforms', meta: 'This sub-category has no uniforms yet.', arrow: false, empty: true }));
        document.getElementById('list-footer').style.display = 'none';
        return;
    }

    // Skip gender picker if only one gender exists
    if (hasMale && !hasFemale) { navigate('uniforms', { gender: 'male' }); return; }
    if (!hasMale && hasFemale) { navigate('uniforms', { gender: 'female' }); return; }

    document.getElementById('list-footer').style.display = 'none';
    const items = [];
    if (hasMale)   items.push(card({ name: 'Male',   meta: uniforms.filter(u => u.pedModel !== 'mp_f_freemode_01').length + ' uniforms', onclick: "selectGender('male')" }));
    if (hasFemale) items.push(card({ name: 'Female', meta: uniforms.filter(u => u.pedModel === 'mp_f_freemode_01').length + ' uniforms', onclick: "selectGender('female')" }));
    setList(items.join(''));
}

function selectGender(gender) {
    state.breadcrumb.push({ label: state.sub.name, view: 'sub', params: { gender: null } });
    navigate('uniforms', { gender });
}

// ── UNIFORM LIST ──────────────────────────────────────────────────────

function renderUniforms() {
    const label  = (state.dept.abbreviation || '') !== '' ? state.dept.abbreviation : state.dept.name;
    const gLabel = state.gender === 'female' ? 'Female' : 'Male';
    setHeader(`${label} › ${state.sub.name}`, `${gLabel} uniforms`);

    const all = (state.sub.uniforms || []).filter(u =>
        state.gender === 'female' ? u.pedModel === 'mp_f_freemode_01' : u.pedModel !== 'mp_f_freemode_01'
    );

    if (all.length === 0) {
        setList('<div class="empty-state">No uniforms.</div>');
        document.getElementById('list-footer').style.display = 'none';
        return;
    }

    _uniforms = all; // store for index-based clicks
    const slice = paginate(all);
    setList(slice.map((u, i) => {
        const idx = state.page * state.perPage + i;
        return card({ name: u.name, arrow: false, onclick: `applyUniformAt(${idx})` });
    }).join(''));
}

function applyUniformAt(idx) {
    const u = _uniforms[idx];
    if (!u) return;
    nuiFetch('applyUniform', { uniform: u });
    showToast(`Uniform applied: ${u.name}`);
}

// ── ADMIN MAIN ────────────────────────────────────────────────────────

function renderAdmin() {
    setHeader('Admin Panel', 'Manage departments and uniforms');
    document.getElementById('list-footer').style.display = 'none';
    setList([
        card({ name: 'Manage Departments', meta: 'Create, edit, delete departments and sub-categories', onclick: "navPush('Admin Panel','admin-depts')" }),
        card({ name: 'Manage Uniforms',    meta: 'Save, rename, move, delete uniforms',                 onclick: "navPush('Admin Panel','admin-uniforms')" }),
    ].join(''));
}

// ── ADMIN: DEPARTMENTS LIST ───────────────────────────────────────────

function renderAdminDepts() {
    setHeader('Manage Departments', 'Select a department to manage');
    const depts = (state.data && state.data.departments) || [];

    let html = `
<div class="card card--dashed" style="cursor:default;">
    <div class="card-accent"></div>
    <div class="card-body" style="gap:0">
        <div class="input-row">
            <input id="new-dept-input" type="text" placeholder="New department name" maxlength="64"
                   onkeydown="if(event.key==='Enter')submitCreateDept()">
            <button onclick="submitCreateDept()">Create</button>
        </div>
    </div>
</div>`;

    if (depts.length === 0) {
        html += '<div class="empty-state">No departments yet.</div>';
        setList(html);
        document.getElementById('list-footer').style.display = 'none';
        return;
    }

    const slice = paginate(depts);
    slice.forEach((dept, i) => {
        const idx   = state.page * state.perPage + i;
        const nSubs = (dept.submenus || []).length;
        const nU    = (dept.submenus || []).reduce((n, s) => n + (s.uniforms || []).length, 0);
        html += card({
            name: dept.name,
            meta: `${dept.description || 'No description'} · ${nSubs} sub-categor${nSubs === 1 ? 'y' : 'ies'} · ${nU} uniforms`,
            onclick: `adminDeptDetail('${escS(dept.name)}')`,
            kbKey: safeId('admdept', dept.name),
            actions: orderBtns(d => `reorderDept('${escS(dept.name)}',${d})`, idx, depts.length)
                   + `<span class="card-arrow">›</span>`,
        });
    });

    setList(html);
}

function adminDeptDetail(deptName) {
    const dept = (state.data.departments || []).find(d => d.name === deptName);
    if (!dept) return;
    navPush('Manage Departments', 'admin-dept-detail', { dept });
}

// ── ADMIN: DEPT DETAIL (settings + sub-categories) ────────────────────

function renderAdminDeptDetail() {
    setHeader(state.dept.name, 'Department settings & sub-categories');
    const dept = state.dept;
    const subs = dept.submenus || [];
    const totalU = subs.reduce((n, s) => n + (s.uniforms || []).length, 0);
    const deptId = safeId('dept', dept.name);

    // ── Department settings cards
    let html = `<div class="list-section">Department Settings</div>`;

    // Edit Description card
    html += `
<div class="card" style="flex-direction:column;align-items:stretch;" id="${deptId}">
    <div style="display:flex;align-items:center;gap:14px" onclick="inlineDeptEdit('${escS(dept.name)}','desc','${escS(dept.description||'')}')">
        <div class="card-accent"></div>
        <div class="card-body">
            <div class="card-name">Edit Description</div>
            <div class="card-meta">${esc(dept.description || 'No description set')}</div>
        </div>
        <span class="card-arrow">›</span>
    </div>
    <div id="${deptId}-edit" style="display:none;padding:8px 0 4px 17px;"></div>
</div>`;

    // Edit Abbreviation card
    const abbvId = safeId('deptabbv', dept.name);
    html += `
<div class="card" style="flex-direction:column;align-items:stretch;" id="${abbvId}">
    <div style="display:flex;align-items:center;gap:14px" onclick="inlineDeptEdit('${escS(dept.name)}','abbv','${escS(dept.abbreviation||'')}')">
        <div class="card-accent"></div>
        <div class="card-body">
            <div class="card-name">Edit Abbreviation</div>
            <div class="card-meta">${esc(dept.abbreviation || 'No abbreviation set')}</div>
        </div>
        <span class="card-arrow">›</span>
    </div>
    <div id="${abbvId}-edit" style="display:none;padding:8px 0 4px 17px;"></div>
</div>`;

    // Delete Department card
    const delId = safeId('deptdel', dept.name);
    html += `
<div class="card card--admin" style="flex-direction:column;align-items:stretch;" id="${delId}">
    <div style="display:flex;align-items:center;gap:14px" onclick="inlineDeptDelDetail('${escS(dept.name)}',${totalU})">
        <div class="card-accent"></div>
        <div class="card-body">
            <div class="card-name">Delete Department</div>
            <div class="card-meta">Permanently deletes all ${totalU} uniform${totalU !== 1 ? 's' : ''}. No recovery.</div>
        </div>
        <span class="card-arrow" style="color:#8a2020">›</span>
    </div>
    <div id="${delId}-del" style="display:none;padding:8px 0 4px 17px;"></div>
</div>`;

    // ── Sub-Categories section
    html += `<div class="list-section" style="margin-top:6px;">Sub-Categories</div>`;

    html += `
<div class="card card--dashed" style="cursor:default;">
    <div class="card-accent"></div>
    <div class="card-body" style="gap:0">
        <div class="input-row">
            <input id="new-sub-input" type="text" placeholder="New sub-category name" maxlength="64"
                   onkeydown="if(event.key==='Enter')submitCreateSub()">
            <button onclick="submitCreateSub()">Create</button>
        </div>
    </div>
</div>`;

    if (subs.length === 0) {
        html += '<div class="empty-state">No sub-categories yet.</div>';
    } else {
        subs.forEach((sub, subIdx) => {
            const numU = (sub.uniforms || []).length;
            const subId = safeId('sub', dept.name + '|' + sub.name);
            const warn  = numU > 0
                ? `${numU} uniform(s) will move to Uncategorized.`
                : 'Delete this empty sub-category?';
            html += `
<div class="card" style="flex-direction:column;align-items:stretch;cursor:default;" id="${subId}" data-kb-key="${subId}">
    <div style="display:flex;align-items:center;gap:14px">
        <div class="card-accent"></div>
        <div class="card-body">
            <div class="card-name">${esc(sub.name)}</div>
            <div class="card-meta">${esc(sub.description || 'No description')} · ${numU} uniform${numU !== 1 ? 's' : ''}</div>
        </div>
        <div class="card-actions">
            ${orderBtns(d => `reorderSub('${escS(sub.name)}',${d})`, subIdx, subs.length)}
            <button class="action-btn" onclick="inlineSubEdit('${escS(sub.name)}','${escS(sub.description||'')}')">Edit Desc</button>
            <button class="action-btn danger" onclick="inlineSubDel('${escS(sub.name)}','${escS(warn)}')">Delete</button>
        </div>
    </div>
    <div id="${subId}-edit" style="display:none;padding:8px 0 4px 17px;"></div>
    <div id="${subId}-del"  style="display:none;padding:8px 0 4px 17px;"></div>
</div>`;
        });
    }

    setList(html);
    document.getElementById('list-footer').style.display = 'none';
}

function inlineDeptDelDetail(deptName, totalU) {
    closeInlineEdits();
    const id  = safeId('deptdel', deptName);
    const div = document.getElementById(id + '-del');
    div.innerHTML = `
<div class="confirm-row">
    <span class="warn-text">Deletes all ${totalU} uniform(s). No recovery.</span>
    <button onclick="nuiFetch('deleteDept',{dept:'${escS(deptName)}'})">Delete</button>
    <button class="cancel-btn" onclick="closeInlineEdits()">Cancel</button>
</div>`;
    div.style.display = '';
}

function submitCreateDept() {
    const el = document.getElementById('new-dept-input');
    const name = el.value.trim();
    if (!name) return;
    el.value = '';
    nuiFetch('createDept', { name });
}

function inlineDeptEdit(deptName, field, current) {
    closeInlineEdits();
    // In dept detail view, desc and abbv have separate card IDs
    const id  = field === 'abbv' ? safeId('deptabbv', deptName) : safeId('dept', deptName);
    const div = document.getElementById(id + '-edit');
    if (!div) return;
    div.innerHTML = `
<div class="input-row">
    <input id="${id}-ei" type="text" maxlength="${field === 'abbv' ? 16 : 128}"
           placeholder="${field === 'desc' ? 'Description' : 'Abbreviation'}" value="${esc(current)}">
    <button onclick="submitDeptEdit('${escS(deptName)}','${field}','${id}')">Save</button>
    <button class="cancel-btn" style="background:#1a1e2d;border:1px solid #2a2d3a;color:#8090b0;border-radius:7px;font-size:14px;padding:8px 12px;cursor:pointer;" onclick="closeInlineEdits()">✕</button>
</div>`;
    div.style.display = '';
    const inp = document.getElementById(id + '-ei');
    inp.focus();
    inp.onkeydown = e => { if (e.key === 'Enter') submitDeptEdit(deptName, field, id); if (e.key === 'Escape') closeInlineEdits(); };
}

function submitDeptEdit(deptName, field, id) {
    const val = (document.getElementById(id + '-ei') || {}).value || '';
    if (field === 'desc') nuiFetch('setDeptDesc', { dept: deptName, desc: val.trim() });
    else                  nuiFetch('setDeptAbbv', { dept: deptName, abbv: val.trim() });
    closeInlineEdits();
}


// (renderAdminSubs / renderAdminSubsSub removed — sub-categories are now managed inside renderAdminDeptDetail)

function submitCreateSub() {
    const el = document.getElementById('new-sub-input');
    const name = el.value.trim();
    if (!name) return;
    el.value = '';
    nuiFetch('createSub', { dept: state.dept.name, sub: name });
}

function inlineSubEdit(subName, current) {
    closeInlineEdits();
    const id  = safeId('sub', state.dept.name + '|' + subName);
    const div = document.getElementById(id + '-edit');
    div.innerHTML = `
<div class="input-row">
    <input id="${id}-ei" type="text" maxlength="128" placeholder="Description" value="${esc(current)}">
    <button onclick="submitSubEdit('${escS(subName)}','${id}')">Save</button>
    <button class="cancel-btn" style="background:#1a1e2d;border:1px solid #2a2d3a;color:#8090b0;border-radius:7px;font-size:14px;padding:8px 12px;cursor:pointer;" onclick="closeInlineEdits()">✕</button>
</div>`;
    div.style.display = '';
    const inp = document.getElementById(id + '-ei');
    inp.focus();
    inp.onkeydown = e => { if (e.key === 'Enter') submitSubEdit(subName, id); if (e.key === 'Escape') closeInlineEdits(); };
}

function submitSubEdit(subName, id) {
    const val = (document.getElementById(id + '-ei') || {}).value || '';
    nuiFetch('setSubDesc', { dept: state.dept.name, sub: subName, desc: val.trim() });
    closeInlineEdits();
}

function inlineSubDel(subName, warn) {
    closeInlineEdits();
    const id  = safeId('sub', state.dept.name + '|' + subName);
    const div = document.getElementById(id + '-del');
    div.innerHTML = `
<div class="confirm-row">
    <span class="warn-text">${esc(warn)}</span>
    <button onclick="nuiFetch('deleteSub',{dept:'${escS(state.dept.name)}',sub:'${escS(subName)}'})">Delete</button>
    <button class="cancel-btn" onclick="closeInlineEdits()">Cancel</button>
</div>`;
    div.style.display = '';
}

// ── ADMIN: UNIFORMS — pick dept ───────────────────────────────────────

function renderAdminUniforms() {
    setHeader('Manage Uniforms', 'Select a department');
    const depts = (state.data && state.data.departments) || [];
    const slice = paginate(depts);
    setList(slice.map(dept => card({
        name: dept.name,
        meta: (dept.submenus || []).length + ' sub-categories',
        onclick: `adminUnifDept('${escS(dept.name)}')`,
    })).join(''));
}

function adminUnifDept(deptName) {
    const dept = (state.data.departments || []).find(d => d.name === deptName);
    if (!dept) return;
    navPush('Manage Uniforms', 'admin-unif-sub', { dept, sub: null });
}

// ── ADMIN: UNIFORMS — pick sub ────────────────────────────────────────

function renderAdminUnifSub() {
    if (!state.sub) {
        setHeader(state.dept.name, 'Select a sub-category');
        const subs  = state.dept.submenus || [];
        const slice = paginate(subs);
        setList(slice.map(sub => card({
            name: sub.name,
            meta: (sub.uniforms || []).length + ' uniforms',
            onclick: `adminUnifPickSub('${escS(sub.name)}')`,
        })).join(''));
        return;
    }

    setHeader(`${state.dept.name} › ${state.sub.name}`, 'Manage uniforms');
    const uniforms = state.sub.uniforms || [];

    let html = `
<div class="card" style="cursor:pointer;border-color:#2a5ab0;" onclick="adminSaveOutfitUI()">
    <div class="card-accent" style="background:#2a5ab0;"></div>
    <div class="card-body">
        <div class="card-name" style="color:#7aa8e0;">+ Save Current Outfit</div>
        <div class="card-meta">Saves your current ped as a new uniform</div>
    </div>
</div>
<div id="save-outfit-form" style="display:none;">
    <div class="input-row" style="padding:4px 0;">
        <input id="save-outfit-name" type="text" placeholder="Uniform name" maxlength="64"
               onkeydown="if(event.key==='Enter')submitSaveOutfit();if(event.key==='Escape')closeSaveOutfitUI()">
        <button onclick="submitSaveOutfit()">Save</button>
        <button class="cancel-btn" style="background:#1a1e2d;border:1px solid #2a2d3a;color:#8090b0;border-radius:7px;font-size:14px;padding:8px 12px;cursor:pointer;" onclick="closeSaveOutfitUI()">✕</button>
    </div>
</div>`;

    if (uniforms.length === 0) {
        html += '<div class="empty-state">No uniforms in this sub-category.</div>';
        setList(html);
        document.getElementById('list-footer').style.display = 'none';
        return;
    }

    const slice = paginate(uniforms);
    slice.forEach((u, i) => {
        const idx    = state.page * state.perPage + i;
        const gender = u.pedModel === 'mp_f_freemode_01' ? 'Female' : 'Male';
        const id = safeId('unif', state.dept.name + '|' + state.sub.name + '|' + u.name);
        html += `
<div class="card" style="flex-direction:column;align-items:stretch;cursor:default;" id="${id}" data-kb-key="${id}">
    <div style="display:flex;align-items:center;gap:12px">
        <div class="card-accent"></div>
        <div class="card-body">
            <div class="card-name">${esc(u.name)}</div>
            <div class="card-meta">${gender}</div>
        </div>
        <div class="card-actions">
            ${orderBtns(d => `reorderUniform('${escS(u.name)}',${d})`, idx, uniforms.length)}
            <button class="action-btn" onclick="inlineUnifOverride('${escS(u.name)}')">Override</button>
            <button class="action-btn" onclick="inlineUnifRename('${escS(u.name)}')">Rename</button>
            <button class="action-btn" onclick="inlineUnifMove('${escS(u.name)}')">Move</button>
            <button class="action-btn danger" onclick="inlineUnifDel('${escS(u.name)}')">Delete</button>
        </div>
    </div>
    <div id="${id}-edit" style="display:none;padding:6px 0 2px 15px;"></div>
    <div id="${id}-del"  style="display:none;padding:6px 0 2px 15px;"></div>
</div>`;
    });

    setList(html);
}

function adminUnifPickSub(subName) {
    const sub = (state.dept.submenus || []).find(s => s.name === subName);
    if (!sub) return;
    navPush(state.dept.name, 'admin-unif-sub', { sub });
}

function adminSaveOutfitUI() {
    const form = document.getElementById('save-outfit-form');
    if (!form) return;
    form.style.display = form.style.display === 'none' ? '' : 'none';
    if (form.style.display !== 'none') {
        const inp = document.getElementById('save-outfit-name');
        if (inp) { inp.value = ''; inp.focus(); }
    }
}

function closeSaveOutfitUI() {
    const form = document.getElementById('save-outfit-form');
    if (form) form.style.display = 'none';
}

function submitSaveOutfit() {
    const inp = document.getElementById('save-outfit-name');
    const name = inp ? inp.value.trim() : '';
    if (!name) return;
    nuiFetch('saveUniform', { dept: state.dept.name, sub: state.sub.name, name });
    closeSaveOutfitUI();
    showToast('Saving uniform…');
}

function inlineUnifOverride(uName) {
    closeInlineEdits();
    const id  = safeId('unif', state.dept.name + '|' + state.sub.name + '|' + uName);
    const div = document.getElementById(id + '-del');
    div.innerHTML = `
<div class="confirm-row">
    <span class="warn-text">Override "${esc(uName)}" with your current outfit?</span>
    <button onclick="nuiFetch('overrideUniform',{dept:'${escS(state.dept.name)}',sub:'${escS(state.sub.name)}',uName:'${escS(uName)}'});closeInlineEdits();showToast('Overriding…')">Override</button>
    <button class="cancel-btn" onclick="closeInlineEdits()">Cancel</button>
</div>`;
    div.style.display = '';
}

function inlineUnifRename(uName) {
    closeInlineEdits();
    const id  = safeId('unif', state.dept.name + '|' + state.sub.name + '|' + uName);
    const div = document.getElementById(id + '-edit');
    div.innerHTML = `
<div class="input-row">
    <input id="${id}-ei" type="text" maxlength="64" placeholder="New name" value="${esc(uName)}">
    <button onclick="submitUnifRename('${escS(uName)}','${id}')">Rename</button>
    <button class="cancel-btn" style="background:#1a1e2d;border:1px solid #2a2d3a;color:#8090b0;border-radius:7px;font-size:14px;padding:8px 12px;cursor:pointer;" onclick="closeInlineEdits()">✕</button>
</div>`;
    div.style.display = '';
    const inp = document.getElementById(id + '-ei');
    inp.focus();
    inp.onkeydown = e => { if (e.key === 'Enter') submitUnifRename(uName, id); if (e.key === 'Escape') closeInlineEdits(); };
}

function submitUnifRename(uName, id) {
    const val = (document.getElementById(id + '-ei') || {}).value || '';
    const newName = val.trim();
    if (!newName) return;
    nuiFetch('renameUniform', { dept: state.dept.name, sub: state.sub.name, oldName: uName, newName });
    closeInlineEdits();
}

function inlineUnifMove(uName) {
    closeInlineEdits();
    const id  = safeId('unif', state.dept.name + '|' + state.sub.name + '|' + uName);
    const div = document.getElementById(id + '-edit');

    const depts = (state.data && state.data.departments) || [];
    let opts = '';
    depts.forEach(d => {
        (d.submenus || []).forEach(s => {
            if (d.name === state.dept.name && s.name === state.sub.name) return;
            opts += `<option value="${esc(d.name)}||${esc(s.name)}">${esc(d.name)} / ${esc(s.name)}</option>`;
        });
    });

    div.innerHTML = `
<div class="input-row" style="flex-wrap:wrap;">
    <select id="${id}-msel" style="flex:1;background:#131620;border:1px solid #252838;border-radius:6px;color:#dce2f5;font-size:13px;padding:7px 10px;outline:none;min-width:0;">${opts}</select>
    <button onclick="submitUnifMove('${escS(uName)}','${id}')">Move</button>
    <button class="cancel-btn" style="background:#1a1e2d;border:1px solid #2a2d3a;color:#8090b0;border-radius:7px;font-size:14px;padding:8px 12px;cursor:pointer;" onclick="closeInlineEdits()">✕</button>
</div>`;
    div.style.display = '';
}

function submitUnifMove(uName, id) {
    const sel = document.getElementById(id + '-msel');
    if (!sel) return;
    const [toDept, toSub] = sel.value.split('||');
    nuiFetch('moveUniform', { fromDept: state.dept.name, fromSub: state.sub.name, uName, toDept, toSub });
    closeInlineEdits();
    showToast('Moving uniform…');
}

function inlineUnifDel(uName) {
    closeInlineEdits();
    const id  = safeId('unif', state.dept.name + '|' + state.sub.name + '|' + uName);
    const div = document.getElementById(id + '-del');
    div.innerHTML = `
<div class="confirm-row">
    <span class="warn-text">Delete "${esc(uName)}"? Cannot be undone.</span>
    <button onclick="nuiFetch('deleteUniform',{dept:'${escS(state.dept.name)}',sub:'${escS(state.sub.name)}',uName:'${escS(uName)}'});closeInlineEdits()">Delete</button>
    <button class="cancel-btn" onclick="closeInlineEdits()">Cancel</button>
</div>`;
    div.style.display = '';
}

// ── Reordering ────────────────────────────────────────────────────────

// Builds ▲/▼ buttons. `call(dir)` returns the onclick JS for a direction
// (-1 = up, 1 = down). stopPropagation keeps the click from also
// triggering the card's own onclick.
function orderBtns(call, idx, total) {
    const btn = (dir, label, disabled) =>
        `<button class="action-btn order-btn" data-dir="${dir}" title="Move ${dir < 0 ? 'up' : 'down'}"${disabled ? ' disabled' : ''}
                 onclick="event.stopPropagation();rememberKbFocus(this);${call(dir)}">${label}</button>`;
    return btn(-1, '▲', idx === 0) + btn(1, '▼', idx >= total - 1);
}

// When an item crosses a page boundary, follow it to the neighbouring page.
function followReorder(idx, dir) {
    const target = idx + dir;
    state.page = Math.floor(target / state.perPage);
}

function reorderDept(deptName, dir) {
    const depts = (state.data && state.data.departments) || [];
    const idx = depts.findIndex(d => d.name === deptName);
    if (idx < 0) return;
    followReorder(idx, dir);
    nuiFetch('reorderDept', { dept: deptName, dir });
}

function reorderSub(subName, dir) {
    nuiFetch('reorderSub', { dept: state.dept.name, sub: subName, dir });
}

function reorderUniform(uName, dir) {
    const idx = (state.sub.uniforms || []).findIndex(u => u.name === uName);
    if (idx < 0) return;
    followReorder(idx, dir);
    nuiFetch('reorderUniform', { dept: state.dept.name, sub: state.sub.name, uName, dir });
}

// ── Shared helpers ────────────────────────────────────────────────────

function closeInlineEdits() {
    document.querySelectorAll('[id$="-edit"],[id$="-del"]').forEach(el => el.style.display = 'none');
}

function safeId(prefix, key) {
    // base64 encode to get a safe DOM id from any string
    return prefix + '-' + btoa(unescape(encodeURIComponent(key))).replace(/[^a-zA-Z0-9]/g, '_');
}

// ── Keyboard focus ────────────────────────────────────

// Up/Down moves between cards only. Right/Left steps into and out of the
// focused card's ▲/▼ buttons (column 0 = the card itself).

function kbCards() {
    return Array.from(document.querySelectorAll('#list .card[onclick]:not(.card--empty), #list .card[data-kb-key]'));
}

function kbOrderBtns(cardEl) {
    return cardEl ? Array.from(cardEl.querySelectorAll('.order-btn:not(:disabled)')) : [];
}

function kbFocus(idx) {
    _focusItems = kbCards();
    _focusCol = 0;
    if (_focusItems.length === 0) { _focusIdx = -1; return; }
    _focusIdx = ((idx % _focusItems.length) + _focusItems.length) % _focusItems.length;
    kbPaint();
}

// Returns true if the column changed (so Left at column 0 can fall through to "back").
function kbMoveCol(delta) {
    if (_focusIdx < 0) return false;
    const btns = kbOrderBtns(_focusItems[_focusIdx]);
    const col  = Math.max(0, Math.min(btns.length, _focusCol + delta));
    if (col === _focusCol) return false;
    _focusCol = col;
    kbPaint();
    return true;
}

function kbPaint() {
    document.querySelectorAll('#list .btn--focused').forEach(b => b.classList.remove('btn--focused'));
    _focusItems.forEach((el, i) => el.classList.toggle('card--focused', i === _focusIdx));
    const cardEl = _focusItems[_focusIdx];
    if (!cardEl) return;
    const btn = _focusCol > 0 ? kbOrderBtns(cardEl)[_focusCol - 1] : null;
    if (btn) btn.classList.add('btn--focused');
    cardEl.scrollIntoView({ block: 'nearest' });
}

function kbActivate() {
    const cardEl = _focusItems[_focusIdx];
    if (!cardEl) return;
    const btn = _focusCol > 0 ? kbOrderBtns(cardEl)[_focusCol - 1] : null;
    (btn || cardEl).click();
}

// Called when a ▲/▼ button is pressed. If it was pressed via the keyboard,
// keep focus on the same item and button after the list re-renders, so
// repeated Enter presses keep moving it.
function rememberKbFocus(btn) {
    if (_focusCol === 0) return;
    const cardEl = btn.closest('[data-kb-key]');
    if (cardEl) _pendingKb = { key: cardEl.dataset.kbKey, dir: btn.dataset.dir };
}

function restoreKbFocus() {
    if (!_pendingKb) return;
    const { key, dir } = _pendingKb;
    _pendingKb = null;
    _focusItems = kbCards();
    _focusIdx = _focusItems.findIndex(el => el.dataset.kbKey === key);
    _focusCol = 0;
    if (_focusIdx < 0) return;
    const btns = kbOrderBtns(_focusItems[_focusIdx]);
    if (btns.length) {
        // Stay on the same arrow if still enabled; otherwise the remaining one.
        const same = btns.findIndex(b => b.dataset.dir === dir);
        _focusCol = (same >= 0 ? same : 0) + 1;
    }
    kbPaint();
}

// ── Toast ─────────────────────────────────────────────────────────────

let _toastTimer = null;
function showToast(msg) {
    const el = document.getElementById('toast');
    el.textContent = msg;
    el.classList.add('show');
    clearTimeout(_toastTimer);
    _toastTimer = setTimeout(() => el.classList.remove('show'), 3000);
}
