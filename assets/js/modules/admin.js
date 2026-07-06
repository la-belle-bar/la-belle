(function(){
  'use strict';

  const app = window.LaBelle = window.LaBelle || {};
  const statuses = ['new','awaiting_payment','paid','processing','completed','cancelled'];

  const state = {
    activeTab:'orders',
    orders:[],
    products:[],
    orderFilters:{search:'', status:''},
    productFilters:{search:'', brand:'', availability:''}
  };

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

  function setTab(tab){
    state.activeTab = tab;
    app.dom.all('[data-admin-tab]').forEach(button => {
      button.classList.toggle('is-active', button.dataset.adminTab === tab);
    });
    app.dom.byId('ordersPanel')?.classList.toggle('is-hidden', tab !== 'orders');
    app.dom.byId('productsPanel')?.classList.toggle('is-hidden', tab !== 'products');
  }

  function showShell(){
    app.dom.byId('adminLogin')?.classList.add('is-hidden');
    app.dom.byId('adminShell')?.classList.remove('is-hidden');
    renderStatusOptions(app.dom.byId('adminOrderStatusFilter'), true);
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
          <td>${esc(customer.name || '-')}<br><span class="admin-muted">${esc(customer.phone || '-')}</span></td>
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
      showLogin();
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
  });
})();
