(function(){
  'use strict';

  const app = window.LaBelle = window.LaBelle || {};
  const LS_KEY = 'lb_account_v1';

  function session(){
    return app.storage.readJson(LS_KEY, null);
  }
  function setSession(data){
    if(data && data.token) app.storage.writeJson(LS_KEY, data);
    else app.storage.remove(LS_KEY);
  }

  function show(view){
    app.dom.byId('accountLogin')?.classList.toggle('is-hidden', view !== 'login');
    app.dom.byId('accountView')?.classList.toggle('is-hidden', view !== 'account');
  }

  function setError(text){
    const el = app.dom.byId('accountError');
    if(el) el.textContent = text || '';
  }

  function fmtDate(iso){
    const d = new Date(iso);
    if(Number.isNaN(d.getTime())) return app.dom.escapeHtml(iso || '');
    return d.toLocaleString(app.i18n.getLanguage() === 'kk' ? 'kk-KZ' : 'ru-RU');
  }

  function statusLabel(status){
    return app.i18n.t(`status.${status || 'new'}`);
  }

  function renderAccount(data){
    const nameEl = app.dom.byId('accountName');
    if(nameEl) nameEl.textContent = data.name ? data.name : app.i18n.t('account.title');

    const stats = app.dom.byId('accountStats');
    if(stats){
      stats.innerHTML = [
        {label:app.i18n.t('account.points'), value:app.dom.rub(data.points || 0)},
        {label:app.i18n.t('account.cashback'), value:`${data.earn_percent != null ? data.earn_percent : 0}%`},
        {label:app.i18n.t('account.ordersCount'), value:data.orders_count || (data.orders ? data.orders.length : 0)},
        {label:app.i18n.t('account.totalSpent'), value:`${app.dom.rub(data.total_spent || 0)} ₸`}
      ].map(card => `<div class="account-stat"><span>${app.dom.escapeHtml(card.label)}</span><strong>${app.dom.escapeHtml(String(card.value))}</strong></div>`).join('');
    }

    const list = app.dom.byId('accountOrders');
    if(list){
      const orders = data.orders || [];
      if(!orders.length){
        list.innerHTML = `<div class="empty-state empty-state--compact">${app.i18n.t('account.noOrders')}</div>`;
      }else{
        list.innerHTML = orders.map(order => {
          const items = (order.items || []).map(it => `${app.dom.escapeHtml(it.name)}${it.description ? ` · ${app.dom.escapeHtml(it.description)}` : ''} × ${Number(it.quantity || 1)}`).join('<br>');
          const bonus = order.points_redeemed > 0 ? `<div class="account-order-bonus">${app.i18n.t('loyalty.orderPoints')}: −${app.dom.rub(order.points_redeemed)} ₸</div>` : '';
          return `
            <div class="account-order">
              <div class="account-order-head">
                <span class="account-order-id">${app.dom.escapeHtml(order.order_id)}</span>
                <span class="account-order-status">${app.dom.escapeHtml(statusLabel(order.status))}</span>
              </div>
              <div class="account-order-date">${fmtDate(order.timestamp)}</div>
              <div class="account-order-items">${items}</div>
              ${bonus}
              <div class="account-order-total">${app.dom.rub(order.total)} ₸</div>
            </div>`;
        }).join('');
      }
    }
    show('account');
  }

  async function loadAccount(){
    const s = session();
    if(!s || !s.token){ show('login'); return; }
    try{
      const data = await app.api.get({action:'account', token:s.token});
      if(data && data.ok){ renderAccount(data); return; }
    }catch(err){ console.warn('Account load failed:', err); }
    // Токен недействителен/истёк — на вход.
    setSession(null);
    show('login');
  }

  async function login(){
    const phone = (app.dom.byId('accPhone')?.value || '').trim();
    const orderId = (app.dom.byId('accOrderId')?.value || '').trim();
    setError('');
    if(!phone || !orderId){ setError(app.i18n.t('account.errEmpty')); return; }
    const button = app.dom.byId('accountLoginBtn');
    if(button) button.disabled = true;
    let data;
    try{
      data = await app.api.post({action:'account_login', phone, order_id:orderId});
    }catch(err){
      data = {ok:false, error:'network'};
    }
    if(button) button.disabled = false;
    if(data && data.ok){
      setSession({token:data.token, phone:data.phone});
      loadAccount();
    }else{
      const key = data && data.error === 'rate_limited' ? 'account.errRate' : 'account.errNotFound';
      setError(app.i18n.t(key));
    }
  }

  function logout(){
    setSession(null);
    setError('');
    const phone = app.dom.byId('accPhone');
    const order = app.dom.byId('accOrderId');
    if(phone) phone.value = '';
    if(order) order.value = '';
    show('login');
  }

  function initYear(){
    const year = app.dom.byId('yearSpan');
    if(year) year.textContent = new Date().getFullYear();
  }

  document.addEventListener('DOMContentLoaded', () => {
    app.i18n.init();
    app.ui.bindNavigation();
    initYear();
    app.dom.byId('accountLoginBtn')?.addEventListener('click', login);
    app.dom.byId('accountLogoutBtn')?.addEventListener('click', logout);
    app.dom.byId('accOrderId')?.addEventListener('keydown', event => {
      if(event.key === 'Enter') login();
    });
    loadAccount();
  });

  document.addEventListener('lb:language-changed', () => {
    if(!app.dom.byId('accountView')?.classList.contains('is-hidden')) loadAccount();
  });
})();
