(function(){
  'use strict';

  const app = window.LaBelle = window.LaBelle || {};
  const statuses = ['new','awaiting_payment','paid','processing','completed','cancelled'];
  const SS_ROLE_KEY = 'lb_admin_role_v1';
  const OWNER_ONLY_TABS = ['analytics','log','settings'];
  const PANELS = {orders:'ordersPanel', products:'productsPanel', sets:'setsPanel', reviews:'reviewsPanel', customers:'customersPanel', analytics:'analyticsPanel', log:'logPanel', settings:'settingsPanel'};

  const state = {
    activeTab:'orders',
    role:'',
    orders:[],
    products:[],
    sets:[],
    setsConfigured:true,
    reviews:[],
    customers:[],
    log:[],
    orderFilters:{search:'', status:''},
    productFilters:{search:'', brand:'', availability:''}
  };

  function getRole(){
    try{ return sessionStorage.getItem(SS_ROLE_KEY) || ''; }catch(_){ return ''; }
  }

  function setRole(role){
    state.role = role || '';
    try{
      if(role) sessionStorage.setItem(SS_ROLE_KEY, role);
      else sessionStorage.removeItem(SS_ROLE_KEY);
    }catch(_){}
  }

  function isOwner(){ return state.role === 'owner'; }

  // «Вход» здесь — только UX. Реальная проверка ключа происходит в Apps Script
  // на каждом запросе; без верного ключа сервер не отдаст и не примет ничего.
  function isAuthenticated(){
    return Boolean(app.api.getAdminToken());
  }

  function esc(value){
    return app.dom.escapeHtml(value ?? '');
  }

  function formatDate(iso){
    const date = new Date(iso);
    if(Number.isNaN(date.getTime())) return esc(iso || '-');
    return date.toLocaleString(app.i18n.getLanguage() === 'kk' ? 'kk-KZ' : 'ru-RU');
  }

  function setNotice(message, tone = 'muted'){
    const notice = app.dom.byId('adminProductNotice');
    if(!notice) return;
    notice.textContent = message || '';
    notice.dataset.tone = tone;
  }

  function setOrderNotice(message, tone = 'muted'){
    const notice = app.dom.byId('adminOrderNotice');
    if(!notice) return;
    notice.textContent = message || '';
    notice.dataset.tone = tone;
  }

  function renderStatusOptions(select, includeAll){
    if(!select) return;
    const current = select.value;
    select.innerHTML = `${includeAll ? `<option value="">${app.i18n.t('filters.all')}</option>` : ''}${
      statuses.map(status => `<option value="${status}">${app.i18n.t(`status.${status}`)}</option>`).join('')
    }`;
    if(statuses.includes(current) || (includeAll && current === '')) select.value = current;
  }

  function renderSummary(){
    const el = app.dom.byId('adminSummary');
    if(!el) return;
    const totalOrders = state.orders.length;
    const awaiting = state.orders.filter(order => order.status === 'awaiting_payment').length;
    const totalRevenue = state.orders.reduce((sum, order) => sum + Number(order.total || 0), 0);
    const availableProducts = state.products.filter(product => product.available).length;
    el.innerHTML = `
      <div class="admin-stat"><span>${app.i18n.t('admin.orders')}</span><strong>${totalOrders}</strong></div>
      <div class="admin-stat"><span>${app.i18n.t('status.awaiting_payment')}</span><strong>${awaiting}</strong></div>
      <div class="admin-stat"><span>${app.i18n.t('admin.total')}</span><strong>${app.dom.rub(totalRevenue)} ₸</strong></div>
      <div class="admin-stat"><span>${app.i18n.t('filters.available')}</span><strong>${availableProducts}</strong></div>
    `;
  }

  function applyRole(){
    const owner = isOwner();
    OWNER_ONLY_TABS.forEach(tab => {
      app.dom.all(`[data-admin-tab="${tab}"]`).forEach(button => button.classList.toggle('is-hidden', !owner));
    });
    // Менеджер не должен зависнуть на owner-вкладке.
    if(!owner && OWNER_ONLY_TABS.includes(state.activeTab)) state.activeTab = 'orders';
    const roleLabel = app.dom.byId('adminRoleLabel');
    if(roleLabel) roleLabel.textContent = state.role ? app.i18n.t(`admin.role.${state.role}`) : '';
  }

  function setTab(tab){
    if(OWNER_ONLY_TABS.includes(tab) && !isOwner()) return;
    state.activeTab = tab;
    app.dom.all('[data-admin-tab]').forEach(button => {
      button.classList.toggle('is-active', button.dataset.adminTab === tab);
    });
    Object.entries(PANELS).forEach(([name, id]) => {
      app.dom.byId(id)?.classList.toggle('is-hidden', name !== tab);
    });
    if(tab === 'sets' && !state.sets.length) loadSets();
    if(tab === 'reviews' && !state.reviews.length) loadReviewsAdmin();
    if(tab === 'customers' && !state.customers.length) loadCustomers();
    if(tab === 'analytics') renderAnalytics();
    if(tab === 'log') loadLog();
    if(tab === 'settings') loadSettings();
  }

  async function loadSettings(){
    const input = app.dom.byId('settingsEarnPercent');
    try{
      const data = await app.api.get({action:'settings', token:app.api.getAdminToken()});
      if(data.ok && input) input.value = data.earn_percent;
    }catch(err){ console.warn('Settings load failed:', err); }
  }

  async function saveSettings(){
    const input = app.dom.byId('settingsEarnPercent');
    const notice = app.dom.byId('adminSettingsNotice');
    if(notice){ notice.textContent = ''; notice.dataset.tone = 'muted'; }
    try{
      const data = await app.api.post({action:'update_settings', token:app.api.getAdminToken(), earn_percent:Number(input?.value)});
      if(!data.ok) throw new Error(data.error || 'save_failed');
      if(input) input.value = data.earn_percent;
      if(notice){ notice.textContent = app.i18n.t('admin.settingsSaved'); notice.dataset.tone = 'ok'; }
    }catch(err){
      console.warn('Settings save failed:', err);
      if(notice){ notice.textContent = app.i18n.t('admin.saveFailed'); notice.dataset.tone = 'danger'; }
    }
  }

  async function ensureRole(){
    let role = getRole();
    if(!role){
      try{
        const result = await app.api.get({action:'verify', token:app.api.getAdminToken()});
        if(result.ok) role = result.role || 'owner';
      }catch(_){}
    }
    setRole(role);
  }

  async function showShell(){
    app.dom.byId('adminLogin')?.classList.add('is-hidden');
    app.dom.byId('adminShell')?.classList.remove('is-hidden');
    renderStatusOptions(app.dom.byId('adminOrderStatusFilter'), true);
    await ensureRole();
    applyRole();
    setTab(state.activeTab);
    loadAdminData();
  }

  function showLogin(){
    app.dom.byId('adminShell')?.classList.add('is-hidden');
    app.dom.byId('adminLogin')?.classList.remove('is-hidden');
  }

  function orderMatches(order){
    const query = state.orderFilters.search.trim().toLowerCase();
    if(state.orderFilters.status && order.status !== state.orderFilters.status) return false;
    if(!query) return true;
    const hay = [
      order.id,
      order.customer?.name,
      order.customer?.phone,
      order.customer?.city,
      order.customer?.street,
      ...(order.items || []).flatMap(item => [item.name, item.brand, item.description])
    ].join(' ').toLowerCase();
    return hay.includes(query);
  }

  function renderStatusSelect(order){
    return `
      <select class="order-status-select" data-order-status="${esc(order.id)}">
        ${statuses.map(status => `
          <option value="${status}" ${order.status === status ? 'selected' : ''}>${app.i18n.t(`status.${status}`)}</option>
        `).join('')}
      </select>
    `;
  }

  function renderOrderItems(order){
    return (order.items || []).map(item => {
      const description = item.description ? `, ${esc(item.description)}` : '';
      return `${esc(item.name)}${description} x ${Number(item.quantity || 1)}`;
    }).join('<br>');
  }

  function renderOrders(){
    const body = app.dom.byId('ordersTableBody');
    if(!body) return;
    const orders = state.orders.filter(orderMatches);
    if(!orders.length){
      body.innerHTML = `<tr><td colspan="9">${app.i18n.t('admin.noOrders')}</td></tr>`;
      return;
    }
    body.innerHTML = orders.map(order => {
      const customer = order.customer || {};
      const address = [customer.city, customer.street, customer.house, customer.flat].filter(Boolean).map(esc).join(', ');
      return `
        <tr>
          <td><strong>${esc(order.id)}</strong></td>
          <td>${formatDate(order.createdAt)}</td>
          <td>${esc(customer.name || '-')}<br><span class="admin-muted">${esc(customer.phone || '-')}</span>${customer.email ? `<br><span class="admin-muted">${esc(customer.email)}</span>` : ''}</td>
          <td>${address || '-'}</td>
          <td>${renderOrderItems(order) || '-'}</td>
          <td>${app.dom.rub(order.total || 0)} ₸</td>
          <td>${renderStatusSelect(order)}</td>
          <td>${esc(order.payment?.method || '-')}<br><span class="admin-muted">${esc(order.payment?.status || '')}</span></td>
          <td>${esc(order.source || 'local')}</td>
        </tr>
      `;
    }).join('');
  }

  function productMatches(product){
    const query = state.productFilters.search.trim().toLowerCase();
    if(state.productFilters.brand && product.brand !== state.productFilters.brand) return false;
    if(state.productFilters.availability === 'available' && !product.available) return false;
    if(state.productFilters.availability === 'unavailable' && product.available) return false;
    if(!query) return true;
    const hay = [
      product.brand,
      product.name,
      product.description,
      product.fullDescription,
      product.season,
      product.gender,
      product.occasion,
      product.notes?.top,
      product.notes?.heart,
      product.notes?.base
    ].join(' ').toLowerCase();
    return hay.includes(query);
  }

  function renderProductBrandOptions(){
    const select = app.dom.byId('adminProductBrandFilter');
    if(!select) return;
    const current = select.value;
    const brands = Array.from(new Set(state.products.map(product => product.brand).filter(Boolean))).sort((a,b) => a.localeCompare(b, 'ru'));
    select.innerHTML = `<option value="">${app.i18n.t('filters.allBrands')}</option>${
      brands.map(brand => `<option value="${esc(brand)}">${esc(brand)}</option>`).join('')
    }`;
    if(brands.includes(current)) select.value = current;
  }

  function formatPrices(product){
    const entries = Object.entries(product.volumes || {});
    if(!entries.length) return '-';
    return entries.map(([volume, price]) => `${volume}мл: ${app.dom.rub(price)} ₸`).join('<br>');
  }

  function renderProducts(){
    const body = app.dom.byId('productsTableBody');
    if(!body) return;
    const products = state.products.filter(productMatches);
    if(!products.length){
      body.innerHTML = `<tr><td colspan="8">${app.i18n.t('admin.noProducts')}</td></tr>`;
      return;
    }
    body.innerHTML = products.map(product => `
      <tr>
        <td>
          <strong>${esc(product.name)}</strong><br>
          <span class="admin-muted">${esc(product.brand)}</span>
        </td>
        <td>${esc(product.season || '-')}</td>
        <td>${esc(product.gender || '-')}</td>
        <td>${esc(product.occasion || '-')}</td>
        <td>${product.stockQty == null ? '-' : esc(product.stockQty)}</td>
        <td>${formatPrices(product)}</td>
        <td><span class="admin-badge ${product.available ? 'admin-badge--ok' : 'admin-badge--danger'}">${app.i18n.t(product.available ? 'filters.available' : 'filters.unavailable')}</span></td>
        <td><button class="btn-secondary" type="button" data-edit-product="${esc(product.key)}">${app.i18n.t('admin.edit')}</button></td>
      </tr>
    `).join('');
  }

  async function loadOrders(){
    try{
      state.orders = await app.orders.loadOrders();
    }catch(err){
      console.warn('Orders load failed:', err);
      state.orders = app.orders.getOrders();
    }
    renderOrders();
    renderSummary();
  }

  async function loadProducts(){
    try{
      state.products = await app.products.loadProducts();
      buildCatalogMatch();
      renderProductBrandOptions();
      renderProducts();
      renderSummary();
      if(state.sets.length) renderSets();
    }catch(err){
      console.warn('Products load failed:', err);
      setNotice(`${app.i18n.t('admin.loadError')}: ${err.message}`, 'danger');
    }
  }

  async function loadAdminData(){
    await Promise.all([loadOrders(), loadProducts()]);
    if(state.activeTab === 'analytics') renderAnalytics();
  }

  /* ── Готовые сеты ────────────────────────────────────────────────────── */

  const SET_INACTIVE = ['false','0','no','нет','off','неактивен','disabled'];
  // Состав редактируемого сета: строки в том виде, в каком они лягут в лист.
  let setDraftItems = [];
  // Индекс каталога — повторяет серверный matchKey_, чтобы админка показывала
  // ровно то, что потом найдёт сервер.
  let catalogMatch = new Map();

  function setSetNotice(message, tone = 'muted'){
    const notice = app.dom.byId('adminSetNotice');
    if(!notice) return;
    notice.textContent = message || '';
    notice.dataset.tone = tone;
  }

  function toInt(value){
    const digits = String(value ?? '').replace(/[^\d]/g, '');
    return digits ? parseInt(digits, 10) : 0;
  }

  function splitList(value){
    return String(value ?? '')
      .split(/[,;\n]/)
      .map(part => part.trim())
      .filter(Boolean);
  }

  function matchKey(value){
    return String(value ?? '')
      .toLowerCase()
      .replace(/[«»"'`’]/g, '')
      .replace(/[—–\-|/]+/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function buildCatalogMatch(){
    catalogMatch = new Map();
    state.products.forEach(product => {
      const put = key => {
        if(key && !catalogMatch.has(key)) catalogMatch.set(key, product);
      };
      if(product.key.startsWith('sku:')) put(matchKey(product.key.slice(4)));
      put(matchKey(`${product.brand} ${product.name}`));
      put(matchKey(product.name));
    });
  }

  function productLabel(product){
    return `${product.brand} ${product.name}`.trim();
  }

  function resolveSetItem(raw){
    return catalogMatch.get(matchKey(raw)) || null;
  }

  function isSetRowActive(row){
    const raw = String(row.active ?? '').trim().toLowerCase();
    return raw === '' ? true : !SET_INACTIVE.includes(raw);
  }

  async function loadSets(){
    try{
      const data = await app.api.get({action:'sets_admin', token:app.api.getAdminToken()});
      state.sets = data.ok && Array.isArray(data.rows) ? data.rows : [];
      state.setsConfigured = data.configured !== false;
      setSetNotice(state.setsConfigured ? '' : app.i18n.t('admin.setsNotConfigured'), 'warning');
    }catch(err){
      console.warn('Sets load failed:', err);
      setSetNotice(`${app.i18n.t('admin.loadError')}: ${err.message}`, 'danger');
    }
    renderSets();
  }

  // Цена сета может быть не задана — тогда её считает сервер по каталогу.
  function setPriceLabel(row){
    const price = toInt(row.price);
    if(price) return `${app.dom.rub(price)} ₸`;
    const discount = toInt(row.discount_percent);
    return discount
      ? app.i18n.t('admin.setPriceAutoDiscount', {percent:discount})
      : app.i18n.t('admin.setPriceAuto');
  }

  function renderSets(){
    const body = app.dom.byId('setsTableBody');
    if(!body) return;
    if(!state.sets.length){
      body.innerHTML = `<tr><td colspan="7">${app.i18n.t('admin.noSets')}</td></tr>`;
      return;
    }
    body.innerHTML = state.sets.map(row => {
      const setId = String(row.set_id ?? '').trim();
      const items = splitList(row.items);
      // Пока каталог не загрузился, сверять состав не с чем — не пугаем красным.
      const unknown = state.products.length ? items.filter(item => !resolveSetItem(item)).length : 0;
      const active = isSetRowActive(row);
      const stock = String(row.stock_qty ?? '').trim();
      return `
        <tr>
          <td>
            <strong>${esc(row.name || setId)}</strong><br>
            <span class="admin-muted">${esc(setId)}</span>
          </td>
          <td>
            ${items.length ? esc(items.join(', ')) : '-'}
            ${unknown ? `<br><span class="admin-badge admin-badge--danger">${app.i18n.t('admin.setUnknownItems', {count:unknown})}</span>` : ''}
          </td>
          <td>${row.volume ? `${esc(row.volume)}мл` : '-'}</td>
          <td>${setPriceLabel(row)}</td>
          <td>${stock === '' ? '-' : esc(stock)}</td>
          <td><span class="admin-badge ${active ? 'admin-badge--ok' : 'admin-badge--muted'}">${app.i18n.t(active ? 'admin.setShown' : 'admin.setHidden')}</span></td>
          <td><button class="btn-secondary" type="button" data-edit-set="${esc(setId)}">${app.i18n.t('admin.edit')}</button></td>
        </tr>
      `;
    }).join('');
  }

  /* ── Редактор сета ───────────────────────────────────────────────────── */

  function findSetRow(setId){
    return state.sets.find(row => String(row.set_id ?? '').trim() === setId) || null;
  }

  function fillSetVolumeOptions(current){
    const select = app.dom.byId('setFieldVolume');
    if(!select) return;
    const volumes = Array.from(new Set(state.products.flatMap(product => Object.keys(product.volumes || {}))))
      .sort((a, b) => Number(a) - Number(b));
    // Объём уже сохранённого сета оставляем в списке, даже если в каталоге
    // такого больше нет — иначе сохранение молча его сотрёт.
    const value = String(current || '');
    if(value && !volumes.includes(value)) volumes.push(value);
    select.innerHTML = `<option value="">—</option>${
      volumes.map(volume => `<option value="${esc(volume)}">${esc(volume)}мл</option>`).join('')
    }`;
    select.value = value;
  }

  function currentSetVolume(){
    return app.dom.byId('setFieldVolume')?.value || '';
  }

  // Каталожная сумма состава при выбранном объёме — то же, что посчитает сервер.
  function catalogTotalForDraft(){
    const volume = currentSetVolume();
    if(!volume || !setDraftItems.length) return 0;
    let total = 0;
    for(const raw of setDraftItems){
      const product = resolveSetItem(raw);
      const price = product?.volumes?.[volume];
      if(!price) return 0;
      total += price;
    }
    return total;
  }

  function renderSetPricePreview(){
    const preview = app.dom.byId('setPricePreview');
    if(!preview) return;
    const total = catalogTotalForDraft();
    if(!total){
      preview.textContent = app.i18n.t('admin.setPriceNoCatalog');
      preview.dataset.tone = 'muted';
      return;
    }
    const manual = toInt(app.dom.byId('setFieldPrice')?.value);
    const discount = Math.max(0, Math.min(90, toInt(app.dom.byId('setFieldDiscount')?.value)));
    const computed = discount ? Math.round(total * (100 - discount) / 100) : total;
    preview.textContent = app.i18n.t('admin.setPricePreview', {
      total:app.dom.rub(total),
      price:app.dom.rub(manual || computed)
    });
    preview.dataset.tone = 'muted';
  }

  function renderSetPicker(){
    const chips = app.dom.byId('setPickerChips');
    const list = app.dom.byId('setPickerList');
    if(!chips || !list) return;

    chips.innerHTML = setDraftItems.length
      ? setDraftItems.map((item, index) => {
          const known = Boolean(resolveSetItem(item));
          return `<span class="set-picker-chip${known ? '' : ' is-unknown'}">
            ${esc(item)}
            <button type="button" data-set-item-remove="${index}" aria-label="${esc(app.i18n.t('cart.remove'))}">×</button>
          </span>`;
        }).join('')
      : `<span class="admin-muted">${esc(app.i18n.t('admin.setPickEmpty'))}</span>`;

    const query = (app.dom.byId('setPickerSearch')?.value || '').trim().toLowerCase();
    const volume = currentSetVolume();
    const picked = new Set(setDraftItems.map(matchKey));
    const matches = state.products.filter(product => {
      if(volume && !product.volumes?.[volume]) return false;
      if(!query) return true;
      return `${product.brand} ${product.name}`.toLowerCase().includes(query);
    }).slice(0, 60);

    list.innerHTML = matches.length
      ? matches.map(product => {
          const label = productLabel(product);
          const isPicked = picked.has(matchKey(label));
          const price = volume ? product.volumes?.[volume] : null;
          const note = price
            ? `${app.dom.rub(price)} ₸`
            : app.i18n.t(product.available ? 'admin.setNoVolumePrice' : 'filters.unavailable');
          return `<button class="set-picker-item${isPicked ? ' is-picked' : ''}" type="button" data-set-item-add="${esc(label)}">
            <span>${esc(label)}</span>
            <span class="admin-muted">${esc(note)}</span>
          </button>`;
        }).join('')
      : `<div class="admin-muted">${esc(app.i18n.t('catalog.empty'))}</div>`;

    renderSetPricePreview();
  }

  function toggleSetItem(label){
    const key = matchKey(label);
    const index = setDraftItems.findIndex(item => matchKey(item) === key);
    if(index > -1) setDraftItems.splice(index, 1);
    else setDraftItems.push(label);
    renderSetPicker();
  }

  function openSetEditor(setId){
    const row = setId ? findSetRow(setId) : null;
    buildCatalogMatch();
    app.dom.byId('editSetId').value = row ? String(row.set_id ?? '').trim() : '';
    fillSetVolumeOptions(row?.volume);
    app.dom.all('[data-set-field]').forEach(input => {
      if(input.dataset.setField === 'volume') return;
      input.value = row ? String(row[input.dataset.setField] ?? '') : '';
    });
    const activeSelect = app.dom.byId('setFieldActive');
    if(activeSelect) activeSelect.value = row && !isSetRowActive(row) ? 'нет' : '';
    // Код сета — ключ строки в листе и ссылка из заказов: у готового сета не меняем.
    const codeInput = app.dom.byId('setFieldCode');
    if(codeInput) codeInput.readOnly = Boolean(row);
    const title = app.dom.byId('setEditorTitle');
    if(title) title.textContent = app.i18n.t(row ? 'admin.setEditor' : 'admin.setEditorNew');
    setDraftItems = row ? splitList(row.items) : [];
    const search = app.dom.byId('setPickerSearch');
    if(search) search.value = '';
    renderSetPicker();
    setSetNotice('');
    app.ui.openModal('setEditorModal');
  }

  function closeSetEditor(){
    app.ui.closeModal('setEditorModal');
  }

  function collectSetForm(){
    const values = {};
    app.dom.all('[data-set-field]').forEach(input => {
      values[input.dataset.setField] = String(input.value ?? '').trim();
    });
    values.items = setDraftItems.join(', ');
    return values;
  }

  async function saveSetEditor(){
    if(!state.setsConfigured){
      setSetNotice(app.i18n.t('admin.setsNotConfigured'), 'danger');
      return;
    }
    const values = collectSetForm();
    const setId = String(values.set_id || '').trim();
    const editing = String(app.dom.byId('editSetId')?.value || '').trim();
    if(!setId){ setSetNotice(app.i18n.t('admin.setCodeRequired'), 'danger'); return; }
    if(!values.name){ setSetNotice(app.i18n.t('admin.setNameRequired'), 'danger'); return; }
    if(!setDraftItems.length){ setSetNotice(app.i18n.t('admin.setItemsRequired'), 'danger'); return; }
    if(!editing && findSetRow(setId)){ setSetNotice(app.i18n.t('admin.setCodeTaken'), 'danger'); return; }
    if(!toInt(values.price) && !catalogTotalForDraft()){
      setSetNotice(app.i18n.t('admin.setPriceRequired'), 'danger');
      return;
    }

    try{
      const result = await app.api.post({
        action:'upsert_set',
        token:app.api.getAdminToken(),
        set_id:setId,
        sheet_set:values
      });
      if(!result || result.ok === false) throw new Error(result?.error || 'save_failed');
      closeSetEditor();
      await loadSets();
      const skipped = Array.isArray(result.skipped) ? result.skipped : [];
      if(skipped.length){
        setSetNotice(app.i18n.t('admin.setSkippedColumns', {columns:skipped.join(', ')}), 'warning');
      }else{
        setSetNotice(app.i18n.t(result.created ? 'admin.setCreated' : 'admin.setSaved'));
      }
    }catch(err){
      console.warn('Set save failed:', err);
      setSetNotice(`${app.i18n.t('admin.saveFailed')}: ${err.message}`, 'danger');
    }
  }

  /* ── Отзывы (модерация) ──────────────────────────────────────────────── */

  function reviewStatusLabel(status){
    return app.i18n.t(`admin.reviewStatus.${status}`) || status;
  }

  function renderReviews(){
    const body = app.dom.byId('reviewsTableBody');
    if(!body) return;
    if(!state.reviews.length){
      body.innerHTML = `<tr><td colspan="5">${app.i18n.t('admin.noReviews')}</td></tr>`;
      return;
    }
    body.innerHTML = state.reviews.map(review => `
      <tr>
        <td>${formatDate(review.timestamp)}</td>
        <td>${esc(review.name || '-')}<br><span class="admin-muted">${esc(review.product_key)}</span></td>
        <td>${'★'.repeat(Math.max(0, Math.min(5, review.rating)))}<br><span class="review-cell-text">${esc(review.text)}</span></td>
        <td><span class="admin-badge admin-badge--${review.status === 'approved' ? 'ok' : review.status === 'rejected' ? 'danger' : 'muted'}">${esc(reviewStatusLabel(review.status))}</span></td>
        <td>
          <div class="admin-inline-actions">
            <button class="btn-secondary" type="button" data-review-action="approved" data-review-id="${esc(review.review_id)}" ${review.status === 'approved' ? 'disabled' : ''}>${app.i18n.t('admin.approve')}</button>
            <button class="btn-secondary" type="button" data-review-action="rejected" data-review-id="${esc(review.review_id)}" ${review.status === 'rejected' ? 'disabled' : ''}>${app.i18n.t('admin.reject')}</button>
          </div>
        </td>
      </tr>
    `).join('');
  }

  async function loadReviewsAdmin(){
    const notice = app.dom.byId('adminReviewNotice');
    try{
      const data = await app.api.get({action:'reviews_admin', token:app.api.getAdminToken()});
      state.reviews = data.ok && Array.isArray(data.rows) ? data.rows : [];
      if(notice) notice.textContent = '';
    }catch(err){
      console.warn('Reviews load failed:', err);
      if(notice){ notice.textContent = `${app.i18n.t('admin.loadError')}: ${err.message}`; notice.dataset.tone = 'danger'; }
    }
    renderReviews();
  }

  async function moderateReview(reviewId, status){
    const notice = app.dom.byId('adminReviewNotice');
    if(notice){ notice.textContent = ''; notice.dataset.tone = 'muted'; }
    try{
      const res = await app.api.post({action:'moderate_review', token:app.api.getAdminToken(), review_id:reviewId, status});
      if(!res.ok) throw new Error(res.error || 'moderate_failed');
      const review = state.reviews.find(item => item.review_id === reviewId);
      if(review) review.status = status;
      renderReviews();
    }catch(err){
      console.warn('Moderate review failed:', err);
      if(notice){ notice.textContent = app.i18n.t('admin.moderateFailed'); notice.dataset.tone = 'danger'; }
    }
  }

  /* ── Клиенты (база лояльности) ───────────────────────────────────────── */

  function renderCustomers(){
    const body = app.dom.byId('customersTableBody');
    if(!body) return;
    if(!state.customers.length){
      body.innerHTML = `<tr><td colspan="5">${app.i18n.t('admin.noCustomers')}</td></tr>`;
      return;
    }
    body.innerHTML = state.customers.map(c => `
      <tr>
        <td>${esc(c.name || '-')}</td>
        <td>${esc(c.phone || '-')}</td>
        <td>${app.dom.rub(c.points || 0)}</td>
        <td>${app.dom.rub(c.total_spent || 0)} ₸<br><span class="admin-muted">${c.orders_count || 0}</span></td>
        <td>${c.last_order ? formatDate(c.last_order) : '-'}</td>
      </tr>
    `).join('');
  }

  async function loadCustomers(){
    const notice = app.dom.byId('adminCustomerNotice');
    try{
      const data = await app.api.get({action:'customers_admin', token:app.api.getAdminToken()});
      state.customers = data.ok && Array.isArray(data.rows) ? data.rows : [];
      if(notice) notice.textContent = '';
    }catch(err){
      console.warn('Customers load failed:', err);
      if(notice){ notice.textContent = `${app.i18n.t('admin.loadError')}: ${err.message}`; notice.dataset.tone = 'danger'; }
    }
    renderCustomers();
  }

  /* ── Аналитика (считаем из уже загруженных заказов) ──────────────────── */

  // Строка заказа считается сетом по type ('custom-set' или 'ready-set') либо
  // (для старых заказов без type) по названию кастомного сета в обоих языках.
  const SET_NAMES = ['кастомный сет','жеке сет'];
  const SET_TYPES = ['custom-set','ready-set'];
  function isSetItem(item){
    if(SET_TYPES.includes(item.type)) return true;
    return SET_NAMES.includes(String(item.name || '').trim().toLowerCase());
  }

  function topBars(counter){
    const top = Array.from(counter.entries()).sort((a,b) => b[1] - a[1]).slice(0, 8);
    const max = top.length ? top[0][1] : 1;
    return top.length
      ? top.map(([name, count]) => `
          <div class="analytics-bar">
            <div class="analytics-bar-head"><span>${esc(name)}</span><span>${count}</span></div>
            <div class="analytics-bar-track"><div class="analytics-bar-fill" style="width:${Math.round(count / max * 100)}%"></div></div>
          </div>`).join('')
      : `<div class="empty-state empty-state--compact">${app.i18n.t('admin.noOrders')}</div>`;
  }

  function renderAnalytics(){
    const cardsEl = app.dom.byId('analyticsCards');
    const topEl = app.dom.byId('analyticsTop');
    const topSetsEl = app.dom.byId('analyticsTopSets');
    if(!cardsEl || !topEl) return;
    const orders = state.orders;
    const paidStatuses = ['paid','completed'];
    const paid = orders.filter(order => paidStatuses.includes(order.status));
    const revenue = paid.reduce((sum, order) => sum + Number(order.total || 0), 0);
    const avgCheck = paid.length ? Math.round(revenue / paid.length) : 0;
    const conversion = orders.length ? Math.round((paid.length / orders.length) * 100) : 0;

    // Разделяем позиции: поштучные ароматы и сеты.
    const singleCounter = new Map();   // brand · name -> шт
    const inSetCounter = new Map();     // name -> сколько раз встречается в сетах
    let setLines = 0;
    orders.forEach(order => (order.items || []).forEach(item => {
      const qty = Number(item.quantity || 1);
      if(isSetItem(item)){
        setLines += qty;
        // Состав сета лежит в description: названия ароматов через запятую.
        String(item.description || '').split(',').map(part => part.trim()).filter(Boolean).forEach(name => {
          inSetCounter.set(name, (inSetCounter.get(name) || 0) + qty);
        });
      }else{
        const name = `${item.brand ? item.brand + ' · ' : ''}${item.name || ''}`.trim();
        if(name) singleCounter.set(name, (singleCounter.get(name) || 0) + qty);
      }
    }));
    const singleUnits = Array.from(singleCounter.values()).reduce((a, b) => a + b, 0);

    cardsEl.innerHTML = [
      {label:app.i18n.t('analytics.revenue'), value:`${app.dom.rub(revenue)} ₸`, sub:app.i18n.t('analytics.revenueSub')},
      {label:app.i18n.t('analytics.avgCheck'), value:`${app.dom.rub(avgCheck)} ₸`, sub:app.i18n.t('analytics.paidCount', {count:paid.length})},
      {label:app.i18n.t('analytics.conversion'), value:`${conversion}%`, sub:app.i18n.t('analytics.conversionSub')},
      {label:app.i18n.t('analytics.orders'), value:orders.length, sub:app.i18n.t('analytics.ordersSub')},
      {label:app.i18n.t('analytics.singleUnits'), value:singleUnits, sub:app.i18n.t('analytics.singleUnitsSub')},
      {label:app.i18n.t('analytics.setLines'), value:setLines, sub:app.i18n.t('analytics.setLinesSub')}
    ].map(card => `<div class="admin-stat"><span>${card.label}</span><strong>${card.value}</strong><span class="admin-muted">${card.sub}</span></div>`).join('');

    topEl.innerHTML = topBars(singleCounter);
    if(topSetsEl) topSetsEl.innerHTML = topBars(inSetCounter);
  }

  /* ── Журнал изменений (owner) ────────────────────────────────────────── */

  function logActionLabel(action){
    return app.i18n.t(`admin.logAction.${action}`) || action;
  }

  function renderLog(){
    const body = app.dom.byId('logTableBody');
    if(!body) return;
    if(!state.log.length){
      body.innerHTML = `<tr><td colspan="4">${app.i18n.t('admin.noLog')}</td></tr>`;
      return;
    }
    body.innerHTML = state.log.map(entry => `
      <tr>
        <td>${formatDate(entry.timestamp)}</td>
        <td><span class="admin-badge">${esc(entry.actor_role || '-')}</span></td>
        <td>${esc(logActionLabel(entry.action))}</td>
        <td>${esc(entry.target || '')}${entry.details ? `<br><span class="admin-muted">${esc(entry.details)}</span>` : ''}</td>
      </tr>
    `).join('');
  }

  async function loadLog(){
    const notice = app.dom.byId('adminLogNotice');
    try{
      const data = await app.api.get({action:'log', token:app.api.getAdminToken()});
      state.log = data.ok && Array.isArray(data.rows) ? data.rows : [];
      if(notice) notice.textContent = '';
    }catch(err){
      console.warn('Log load failed:', err);
      if(notice){ notice.textContent = `${app.i18n.t('admin.loadError')}: ${err.message}`; notice.dataset.tone = 'danger'; }
    }
    renderLog();
  }

  function findProduct(productKey){
    return state.products.find(product => product.key === productKey);
  }

  function setProductField(field, value){
    const input = document.querySelector(`[data-product-field="${field}"]`);
    if(input) input.value = value ?? '';
  }

  function openProductEditor(productKey){
    const product = findProduct(productKey);
    if(!product) return;
    app.dom.byId('editProductKey').value = product.key;
    [
      'brand','name','category','season','gender','occasion','longevity','sillage',
      'description','fullDescription','imageUrl'
    ].forEach(field => setProductField(field, product[field]));
    setProductField('stockQty', product.stockQty == null ? '' : product.stockQty);
    app.dom.all('[data-product-note]').forEach(input => {
      input.value = product.notes?.[input.dataset.productNote] || '';
    });
    app.dom.all('[data-product-volume]').forEach(input => {
      input.value = product.volumes?.[input.dataset.productVolume] || '';
    });
    app.ui.openModal('productEditorModal');
  }

  function closeProductEditor(){
    app.ui.closeModal('productEditorModal');
  }

  function collectProductForm(){
    const values = {};
    app.dom.all('[data-product-field]').forEach(input => {
      values[input.dataset.productField] = input.value;
    });
    const notes = {};
    app.dom.all('[data-product-note]').forEach(input => {
      notes[input.dataset.productNote] = input.value;
    });
    const volumes = {};
    app.dom.all('[data-product-volume]').forEach(input => {
      volumes[input.dataset.productVolume] = input.value;
    });
    values.notes = notes;
    values.volumes = volumes;
    values.stockQty = values.stockQty === '' ? null : Number(values.stockQty);
    return values;
  }

  async function saveProductEditor(){
    const productKey = app.dom.byId('editProductKey')?.value;
    if(!productKey) return;
    const values = collectProductForm();
    let result = null;
    try{
      result = await app.products.saveProductUpdate(productKey, values);
      setNotice(result.remote?.skipped ? app.i18n.t('admin.localOnly') : app.i18n.t('admin.remoteSaved'));
    }catch(err){
      console.warn('Product remote sync failed:', err);
      setNotice(`${app.i18n.t('admin.localOnly')} ${err.message || ''}`.trim(), 'warning');
    }
    await loadProducts();
    closeProductEditor();
  }

  async function resetProductOverride(){
    const productKey = app.dom.byId('editProductKey')?.value;
    if(!productKey) return;
    app.products.clearProductOverride(productKey);
    await loadProducts();
    closeProductEditor();
    setNotice('');
  }

  async function handleLogin(){
    const button = app.dom.byId('adminLoginBtn');
    const error = app.dom.byId('adminLoginError');
    const token = (app.dom.byId('adminPassword')?.value || '').trim();
    if(error) error.textContent = '';
    if(!token) return;
    if(button) button.disabled = true;
    try{
      const result = await app.api.get({action:'verify', token});
      if(result.ok){
        app.api.setAdminToken(token);
        setRole(result.role || 'owner');
        const input = app.dom.byId('adminPassword');
        if(input) input.value = '';
        showShell();
      }else if(error){
        error.textContent = app.i18n.t('admin.wrongPassword');
      }
    }catch(err){
      console.warn('Admin login failed:', err);
      if(error) error.textContent = app.i18n.t('admin.loginFailed');
    }finally{
      if(button) button.disabled = false;
    }
  }

  function bindEvents(){
    app.dom.byId('adminLoginBtn')?.addEventListener('click', handleLogin);
    app.dom.byId('adminPassword')?.addEventListener('keydown', event => {
      if(event.key === 'Enter') handleLogin();
    });
    app.dom.byId('adminLogoutBtn')?.addEventListener('click', () => {
      app.api.setAdminToken('');
      setRole('');
      state.reviews = [];
      state.log = [];
      state.sets = [];
      showLogin();
    });
    app.dom.byId('refreshReviewsBtn')?.addEventListener('click', loadReviewsAdmin);
    app.dom.byId('refreshCustomersBtn')?.addEventListener('click', loadCustomers);
    app.dom.byId('refreshLogBtn')?.addEventListener('click', loadLog);
    app.dom.byId('saveSettingsBtn')?.addEventListener('click', saveSettings);
    app.dom.byId('reviewsTableBody')?.addEventListener('click', event => {
      const button = app.dom.closestFromEvent(event, '[data-review-action]');
      if(!button || button.disabled) return;
      moderateReview(button.dataset.reviewId, button.dataset.reviewAction);
    });
    app.dom.all('[data-admin-tab]').forEach(button => {
      button.addEventListener('click', () => setTab(button.dataset.adminTab));
    });
    app.dom.byId('adminOrderSearch')?.addEventListener('input', event => {
      state.orderFilters.search = event.target.value;
      renderOrders();
    });
    app.dom.byId('adminOrderStatusFilter')?.addEventListener('change', event => {
      state.orderFilters.status = event.target.value;
      renderOrders();
    });
    app.dom.byId('adminProductSearch')?.addEventListener('input', event => {
      state.productFilters.search = event.target.value;
      renderProducts();
    });
    app.dom.byId('adminProductBrandFilter')?.addEventListener('change', event => {
      state.productFilters.brand = event.target.value;
      renderProducts();
    });
    app.dom.byId('adminProductAvailabilityFilter')?.addEventListener('change', event => {
      state.productFilters.availability = event.target.value;
      renderProducts();
    });
    app.dom.byId('refreshOrdersBtn')?.addEventListener('click', loadOrders);
    app.dom.byId('refreshProductsBtn')?.addEventListener('click', loadProducts);
    app.dom.byId('ordersTableBody')?.addEventListener('change', async event => {
      const select = app.dom.closestFromEvent(event, '[data-order-status]');
      if(!select) return;
      setOrderNotice('');
      try{
        const {remote} = await app.orders.updateOrderStatus(select.dataset.orderStatus, select.value);
        if(!remote.ok && !remote.skipped) setOrderNotice(app.i18n.t('admin.statusSyncFailed'), 'warning');
        else if(remote.certs && remote.certs.length) setOrderNotice(app.i18n.t('admin.certsIssued', {codes:remote.certs.join(', ')}), 'muted');
      }catch(err){
        console.warn('Order status update failed:', err);
        setOrderNotice(app.i18n.t('admin.statusSyncFailed'), 'warning');
      }
      loadOrders();
    });
    app.dom.byId('productsTableBody')?.addEventListener('click', event => {
      const button = app.dom.closestFromEvent(event, '[data-edit-product]');
      if(!button) return;
      openProductEditor(button.dataset.editProduct);
    });
    app.dom.byId('refreshSetsBtn')?.addEventListener('click', loadSets);
    app.dom.byId('createSetBtn')?.addEventListener('click', () => openSetEditor(''));
    app.dom.byId('setsTableBody')?.addEventListener('click', event => {
      const button = app.dom.closestFromEvent(event, '[data-edit-set]');
      if(!button) return;
      openSetEditor(button.dataset.editSet);
    });
    app.dom.byId('setPickerSearch')?.addEventListener('input', renderSetPicker);
    app.dom.byId('setFieldVolume')?.addEventListener('change', renderSetPicker);
    app.dom.byId('setFieldPrice')?.addEventListener('input', renderSetPricePreview);
    app.dom.byId('setFieldDiscount')?.addEventListener('input', renderSetPricePreview);
    app.dom.byId('setPickerList')?.addEventListener('click', event => {
      const button = app.dom.closestFromEvent(event, '[data-set-item-add]');
      if(!button) return;
      toggleSetItem(button.dataset.setItemAdd);
    });
    app.dom.byId('setPickerChips')?.addEventListener('click', event => {
      const button = app.dom.closestFromEvent(event, '[data-set-item-remove]');
      if(!button) return;
      setDraftItems.splice(Number(button.dataset.setItemRemove), 1);
      renderSetPicker();
    });
    app.dom.byId('closeSetEditorBtn')?.addEventListener('click', closeSetEditor);
    app.dom.byId('cancelSetEditBtn')?.addEventListener('click', closeSetEditor);
    app.dom.byId('setEditorForm')?.addEventListener('submit', event => {
      event.preventDefault();
      saveSetEditor();
    });
    app.dom.byId('closeProductEditorBtn')?.addEventListener('click', closeProductEditor);
    app.dom.byId('cancelProductEditBtn')?.addEventListener('click', closeProductEditor);
    app.dom.byId('resetProductOverrideBtn')?.addEventListener('click', resetProductOverride);
    app.dom.byId('productEditorForm')?.addEventListener('submit', event => {
      event.preventDefault();
      saveProductEditor();
    });
  }

  document.addEventListener('DOMContentLoaded', () => {
    app.i18n.init();
    app.ui.bindNavigation();
    bindEvents();
    if(isAuthenticated()) showShell();
    else showLogin();
  });

  document.addEventListener('lb:language-changed', () => {
    renderStatusOptions(app.dom.byId('adminOrderStatusFilter'), true);
    renderOrders();
    renderProducts();
    renderSummary();
    renderSets();
    renderReviews();
    renderCustomers();
    renderAnalytics();
    renderLog();
    applyRole();
  });
})();
