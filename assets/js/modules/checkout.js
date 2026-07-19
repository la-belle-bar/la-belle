(function(){
  'use strict';

  const app = window.LaBelle = window.LaBelle || {};
  const LS_CHECKOUT_KEY = 'lb_checkout_v1';
  const CHECKOUT_FIELD_IDS = ['c_name','c_phone','c_email','c_city','c_street','c_house','c_flat','c_comment'];

  let stateRef = null;
  let isSubmitting = false;
  let lastSuccessfulOrder = null;

  function getCheckout(){
    const get = id => (app.dom.byId(id)?.value || '').trim();
    return {
      name:get('c_name'),
      phone:get('c_phone'),
      email:get('c_email'),
      city:get('c_city'),
      street:get('c_street'),
      house:get('c_house'),
      flat:get('c_flat'),
      comment:get('c_comment')
    };
  }

  function saveCheckout(){
    app.storage.writeJson(LS_CHECKOUT_KEY, getCheckout());
  }

  function loadCheckout(){
    const data = app.storage.readJson(LS_CHECKOUT_KEY, {});
    CHECKOUT_FIELD_IDS.forEach(id => {
      const key = id.replace('c_', '');
      const el = app.dom.byId(id);
      if(el && typeof data[key] === 'string') el.value = data[key];
    });
  }

  function clearCheckout(){
    app.storage.remove(LS_CHECKOUT_KEY);
    CHECKOUT_FIELD_IDS.forEach(id => {
      const el = app.dom.byId(id);
      if(el) el.value = '';
    });
  }

  function bindCheckoutPersistence(){
    loadCheckout();
    CHECKOUT_FIELD_IDS.forEach(id => {
      const el = app.dom.byId(id);
      if(el) el.addEventListener('input', saveCheckout);
    });
  }

  function validate(){
    const cart = app.cart.getItems();
    if(!cart.length){ alert(app.i18n.t('checkout.emptyCart')); return false; }
    const checkout = getCheckout();
    if(!checkout.phone){ alert(app.i18n.t('checkout.phoneRequired')); return false; }
    if(!checkout.city || !checkout.street || !checkout.house){ alert(app.i18n.t('checkout.addressRequired')); return false; }
    return true;
  }

  function buildWhatsAppMessage(order){
    const lines = [
      'ЗАКАЗ ПАРФЮМЕРИИ',
      '',
      `Заказ: ${order.id}`,
      `Дата: ${new Date(order.createdAt).toLocaleString('ru-RU')}`,
      `Имя: ${order.customer.name || '-'}`,
      `Телефон: ${order.customer.phone || '-'}`,
      `Оплата: ${order.payment.method}`,
      '',
      'Товары:'
    ];
    order.items.forEach(item => {
      lines.push(`${item.index}. ${item.name}`);
      lines.push(`${item.brand}`);
      lines.push(`${item.description}`);
      lines.push(`${item.quantity} шт. x ${app.dom.rub(item.price)} ₸ = ${app.dom.rub(item.total)} ₸`);
      lines.push('');
    });
    if(order.discount > 0 || order.pointsRedeemed > 0){
      lines.push(`Подытог: ${app.dom.rub(order.subtotal)} ₸`);
      if(order.discount > 0) lines.push(`Скидка${order.promoCode ? ` (${order.promoCode})` : ''}: -${app.dom.rub(order.discount)} ₸`);
      if(order.pointsRedeemed > 0) lines.push(`Бонусы: -${app.dom.rub(order.pointsRedeemed)} ₸`);
    }
    lines.push(`ИТОГО: ${app.dom.rub(order.total)} ₸`);
    return lines.join('\n');
  }

  function openWhatsAppForOrder(order){
    const phone = app.config.whatsappPhone || '';
    const message = buildWhatsAppMessage(order);
    const url = phone
      ? `https://wa.me/${phone}?text=${encodeURIComponent(message)}`
      : `https://api.whatsapp.com/send?text=${encodeURIComponent(message)}`;
    window.open(url, '_blank');
  }

  function createOrderFromCart(){
    const payment = app.payments.getPaymentInfo();
    const promo = app.promo ? app.promo.get() : null;
    const subtotal = app.cart.getCartSubtotal();
    const promoDiscount = app.cart.getCartPromoDiscount();
    const pointsDiscount = app.cart.getCartPointsDiscount();
    const redeemPoints = app.loyalty ? app.loyalty.getRedeem() : 0;
    return app.orders.buildOrder({
      customer:getCheckout(),
      items:app.cart.getItems(),
      subtotal,
      discount:promoDiscount,
      pointsRedeemed:pointsDiscount,
      redeemPoints,
      promoCode:promo ? promo.code : '',
      total:app.cart.getCartTotal(),
      payment
    });
  }

  function formatDate(iso){
    const locale = app.i18n.getLanguage() === 'kk' ? 'kk-KZ' : 'ru-RU';
    return new Date(iso).toLocaleString(locale);
  }

  function paymentLabel(method){
    if(method === 'kaspi') return app.i18n.t('payments.kaspi');
    return app.i18n.t('payments.cash');
  }

  function statusLabel(status){
    return app.i18n.t(`status.${status || 'new'}`);
  }

  function setSubmitting(next){
    isSubmitting = next;
    const btn = app.dom.byId('submitOrderBtn');
    if(!btn) return;
    btn.disabled = next;
    btn.textContent = app.i18n.t(next ? 'checkout.saving' : 'checkout.submit');
  }

  function renderOrderItems(order){
    return order.items.map(item => `
      <div class="order-success-item">
        <div>
          <strong>${app.dom.escapeHtml(item.index)}. ${app.dom.escapeHtml(item.name)}</strong>
          <span>${app.dom.escapeHtml(item.brand)} · ${app.dom.escapeHtml(item.description)}</span>
        </div>
        <div>${item.quantity} × ${app.dom.rub(item.price)} ₸</div>
      </div>
    `).join('');
  }

  function getKaspiBlock(order){
    const kaspi = app.payments.getKaspiConfig();
    const hasPaymentTarget = app.payments.hasKaspiPaymentTarget();
    const qr = kaspi.qrImageUrl
      ? `<img class="order-kaspi-qr" src="${app.dom.escapeHtml(kaspi.qrImageUrl)}" alt="Kaspi QR" />`
      : '';
    const link = kaspi.paymentUrl && kaspi.paymentUrl !== '#'
      ? `<a class="btn-primary" href="${app.dom.escapeHtml(kaspi.paymentUrl)}" target="_blank" rel="noopener">${app.i18n.t('payments.kaspiLink')}</a>`
      : '';
    const fallback = hasPaymentTarget
      ? ''
      : `<p class="order-payment-muted">${app.i18n.t('payments.noKaspiLink')}</p>`;

    return `
      <aside class="order-payment-card order-payment-card--kaspi">
        <p class="eyebrow">${app.i18n.t('payments.paymentDetails')}</p>
        <h3>${app.i18n.t('payments.kaspiAwaitingTitle')}</h3>
        <p>${app.i18n.t('payments.kaspiAfterOrder', {
          orderId: order.id,
          total: `${app.dom.rub(order.total)} ₸`
        })}</p>
        <div class="order-reference">
          <span>${app.i18n.t('checkout.orderNumber')}</span>
          <strong>${app.dom.escapeHtml(order.id)}</strong>
        </div>
        ${qr}
        ${link}
        ${fallback}
      </aside>
    `;
  }

  function getDefaultPaymentBlock(order){
    return `
      <aside class="order-payment-card">
        <p class="eyebrow">${app.i18n.t('payments.paymentDetails')}</p>
        <h3>${paymentLabel(order.payment.method)}</h3>
        <p>${app.i18n.t('payments.cashInstruction')}</p>
      </aside>
    `;
  }

  function ensureOrderSuccessModal(){
    if(app.dom.byId('orderSuccessModal')) return;
    document.body.insertAdjacentHTML('beforeend', `
      <div id="orderSuccessModal" class="modal" role="dialog" aria-modal="true" aria-labelledby="orderSuccessTitle">
        <div class="modal-content order-success-modal">
          <div class="modal-header">
            <h2 class="modal-title" id="orderSuccessTitle">${app.i18n.t('checkout.successTitle')}</h2>
            <button class="close" id="closeOrderSuccessBtn" type="button" aria-label="${app.i18n.t('common.close')}">&times;</button>
          </div>
          <div class="modal-body" id="orderSuccessBody"></div>
        </div>
      </div>
    `);

    app.dom.byId('closeOrderSuccessBtn')?.addEventListener('click', () => app.ui.closeModal('orderSuccessModal'));
    app.dom.byId('orderSuccessModal')?.addEventListener('click', event => {
      const action = app.dom.closestFromEvent(event, '[data-order-success-action]');
      if(!action) return;
      if(action.dataset.orderSuccessAction === 'close') app.ui.closeModal('orderSuccessModal');
      if(action.dataset.orderSuccessAction === 'whatsapp' && lastSuccessfulOrder) openWhatsAppForOrder(lastSuccessfulOrder);
    });
  }

  function showOrderSuccess(order, meta = {}){
    lastSuccessfulOrder = order;
    ensureOrderSuccessModal();
    const title = app.dom.byId('orderSuccessTitle');
    const closeBtn = app.dom.byId('closeOrderSuccessBtn');
    if(title) title.textContent = app.i18n.t('checkout.successTitle');
    if(closeBtn) closeBtn.setAttribute('aria-label', app.i18n.t('common.close'));
    const body = app.dom.byId('orderSuccessBody');
    if(!body) return;
    const notifyWarning = meta.notificationDelivered === false
      ? `<div class="order-warning">${app.i18n.t('checkout.notifyWarning')}</div>`
      : '';
    body.innerHTML = `
      <div class="order-success">
        <section class="order-success-main">
          <p class="eyebrow">${app.i18n.t('checkout.successEyebrow')}</p>
          <h3>${app.i18n.t('checkout.successHeading')}</h3>
          <p>${app.i18n.t('checkout.successCopy')}</p>
          ${notifyWarning}
          <div class="order-summary-grid">
            <div>
              <span>${app.i18n.t('checkout.orderNumber')}</span>
              <strong>${app.dom.escapeHtml(order.id)}</strong>
            </div>
            <div>
              <span>${app.i18n.t('checkout.orderDate')}</span>
              <strong>${formatDate(order.createdAt)}</strong>
            </div>
            <div>
              <span>${app.i18n.t('checkout.orderStatus')}</span>
              <strong>${statusLabel(order.status)}</strong>
            </div>
            ${order.discount > 0 ? `
            <div>
              <span>${app.i18n.t('checkout.orderDiscount')}${order.promoCode ? ` · ${app.dom.escapeHtml(order.promoCode)}` : ''}</span>
              <strong>−${app.dom.rub(order.discount)} ₸</strong>
            </div>` : ''}
            ${order.pointsRedeemed > 0 ? `
            <div>
              <span>${app.i18n.t('loyalty.orderPoints')}</span>
              <strong>−${app.dom.rub(order.pointsRedeemed)} ₸</strong>
            </div>` : ''}
            <div>
              <span>${app.i18n.t('checkout.orderTotal')}</span>
              <strong>${app.dom.rub(order.total)} ₸</strong>
            </div>
          </div>
          <div class="order-success-items">
            <h4>${app.i18n.t('checkout.orderItems')}</h4>
            ${renderOrderItems(order)}
          </div>
        </section>
        ${order.payment.method === 'kaspi' ? getKaspiBlock(order) : getDefaultPaymentBlock(order)}
      </div>
      <div class="order-success-actions">
        <button class="btn-secondary btn-wa" type="button" data-order-success-action="whatsapp">${app.i18n.t('checkout.contactManager')}</button>
        <button class="btn-primary" type="button" data-order-success-action="close">${app.i18n.t('checkout.closeSuccess')}</button>
      </div>
    `;
    app.ui.openModal('orderSuccessModal');
  }

  async function submitOrder(){
    if(isSubmitting) return;
    if(!validate()) return;
    setSubmitting(true);
    const order = createOrderFromCart();
    let sheetResult = {ok:false};
    try{
      app.orders.saveOrder(order);
      // Заказ уходит одним запросом в Apps Script: тот пишет в приватную
      // таблицу и сам отправляет уведомление в Telegram (токен — на сервере).
      try{ sheetResult = await app.orders.sendToSheet(order); }catch(err){ console.warn('Order submit to API failed:', err); }
      app.cart.clearCart();
      clearCheckout();
      app.cart.displayCartItems();
      app.payments.syncPaymentUi();
      app.cart.closeCart();
      showOrderSuccess(order, {
        notificationDelivered: Boolean(sheetResult?.ok)
      });
    }catch(err){
      console.error('Order submit failed:', err);
      alert(app.i18n.t('checkout.submitFailed'));
    }finally{
      setSubmitting(false);
    }
  }

  function sendWhatsApp(){
    if(!validate()) return;
    openWhatsAppForOrder(createOrderFromCart());
  }

  function init(state){
    stateRef = state;
    app.payments.init();
    app.dom.byId('submitOrderBtn')?.addEventListener('click', submitOrder);
    app.dom.byId('sendWhatsAppBtn')?.addEventListener('click', sendWhatsApp);
  }

  app.checkout = {init, bindCheckoutPersistence, getCheckout, submitOrder};
})();
