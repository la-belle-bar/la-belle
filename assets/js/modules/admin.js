(function(){
  'use strict';

  const app = window.LaBelle = window.LaBelle || {};
  const statuses = ['new','awaiting_payment','paid','processing','completed','cancelled'];
  const SS_ROLE_KEY = 'lb_admin_role_v1';
  const OWNER_ONLY_TABS = ['analytics','log','settings'];
  const PANELS = {orders:'ordersPanel', products:'productsPanel', reviews:'reviewsPanel', customers:'customersPanel', analytics:'analyticsPanel', log:'logPanel', settings:'settingsPanel'};

  const state = {
    activeTab:'orders',
    role:'',
    orders:[],
    products:[],
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
      renderProductBrandOptions();
      renderProducts();
      renderSummary();
    }catch(err){
      console.warn('Products load failed:', err);
      setNotice(`${app.i18n.t('admin.loadError')}: ${err.message}`, 'danger');
    }
  }

  async function loadAdminData(){
    await Promise.all([loadOrders(), loadProducts()]);
    if(state.activeTab === 'analytics') renderAnalytics();
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

  // Строка заказа считается сетом по type='custom-set' или (для старых заказов
  // без type) по названию кастомного сета в обоих языках.
  const SET_NAMES = ['кастомный сет','жеке сет'];
  function isSetItem(item){
    if(item.type === 'custom-set') return true;
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
    renderReviews();
    renderCustomers();
    renderAnalytics();
    renderLog();
    applyRole();
  });
})();
