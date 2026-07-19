(function(){
  'use strict';

  const app = window.LaBelle = window.LaBelle || {};

  // Состояние — на текущую сессию (не persist): баланс не сохраняем, поэтому и
  // списание не восстанавливаем — иначе после перезагрузки скидка баллами
  // висела бы без видимого баланса. Списание задаётся только после «Проверить».
  let balance = null;        // известный баланс (после проверки) | null
  let earnPercent = null;    // процент кэшбэка с сервера | null
  let redeem = 0;            // сколько баллов списываем

  function getRedeem(){ return redeem; }

  // Итоговая скидка баллами для суммы после промокода. Сервер всё равно
  // пересчитает по реальному балансу — это лишь для отображения.
  function pointsDiscountFor(afterPromo){
    if(!redeem || balance == null) return 0;
    const cap = Math.min(Math.max(0, afterPromo), balance);
    return Math.max(0, Math.min(redeem, cap));
  }

  function phoneValue(){
    return (app.dom.byId('c_phone')?.value || '').trim();
  }

  function setInfo(html){
    const el = app.dom.byId('loyaltyInfo');
    if(el) el.innerHTML = html || '';
  }

  function maxRedeemable(){
    const afterPromo = app.cart.getCartSubtotal() - app.cart.getCartPromoDiscount();
    return Math.max(0, Math.min(balance || 0, afterPromo));
  }

  function renderInfo(){
    if(balance == null){
      setInfo('');
      return;
    }
    if(balance <= 0){
      setInfo(`<div class="loyalty-line">${app.dom.escapeHtml(app.i18n.t('loyalty.none'))}</div>`);
      return;
    }
    const percentNote = earnPercent != null
      ? ` · ${app.i18n.t('loyalty.cashback', {percent:earnPercent})}`
      : '';
    if(redeem > 0){
      setInfo(
        `<div class="loyalty-line">${app.i18n.t('loyalty.applied', {points:app.dom.rub(pointsDiscountFor(app.cart.getCartSubtotal() - app.cart.getCartPromoDiscount()))})}` +
        ` <button type="button" class="loyalty-remove" id="loyaltyRemoveBtn">${app.dom.escapeHtml(app.i18n.t('promo.remove'))}</button></div>`
      );
    }else{
      const max = maxRedeemable();
      setInfo(
        `<div class="loyalty-line">${app.i18n.t('loyalty.available', {points:app.dom.rub(balance)})}${percentNote}</div>` +
        `<div class="loyalty-redeem">` +
        `<input id="loyaltyAmount" type="number" min="0" step="100" max="${max}" value="${max}" />` +
        `<button type="button" class="btn-secondary" id="applyLoyaltyBtn">${app.dom.escapeHtml(app.i18n.t('loyalty.apply'))}</button>` +
        `</div>`
      );
    }
  }

  async function checkBalance(){
    const phone = phoneValue();
    if(!phone){ setInfo(`<div class="loyalty-line loyalty-line--muted">${app.dom.escapeHtml(app.i18n.t('loyalty.needPhone'))}</div>`); return; }
    setInfo(`<div class="loyalty-line loyalty-line--muted">${app.dom.escapeHtml(app.i18n.t('loyalty.checking'))}</div>`);
    let res;
    try{ res = await app.api.get({action:'loyalty_balance', phone}); }
    catch(err){ res = {ok:false}; }
    if(res && res.skipped){ setInfo(`<div class="loyalty-line loyalty-line--muted">${app.dom.escapeHtml(app.i18n.t('loyalty.unavailable'))}</div>`); return; }
    if(res && res.ok){
      balance = Number(res.points) || 0;
      earnPercent = res.earn_percent != null ? Number(res.earn_percent) : null;
      if(redeem > balance) redeem = balance;
      renderInfo();
      app.cart.displayCartItems();
    }else{
      setInfo(`<div class="loyalty-line loyalty-line--muted">${app.dom.escapeHtml(app.i18n.t('loyalty.unavailable'))}</div>`);
    }
  }

  function applyRedeem(){
    const input = app.dom.byId('loyaltyAmount');
    const requested = Math.max(0, Math.round(Number(input?.value) || 0));
    redeem = Math.min(requested, maxRedeemable());
    renderInfo();
    app.cart.displayCartItems();
  }

  function clear(){
    redeem = 0;
    renderInfo();
    if(app.cart) app.cart.displayCartItems();
  }

  function bind(){
    const box = app.dom.byId('loyaltyBox');
    if(!box || box.dataset.bound === 'true') return;
    box.dataset.bound = 'true';
    // Делегируем: содержимое loyaltyInfo перерисовывается.
    box.addEventListener('click', event => {
      const target = event.target;
      if(!(target instanceof Element)) return;
      if(target.closest('#checkLoyaltyBtn')) checkBalance();
      else if(target.closest('#applyLoyaltyBtn')) applyRedeem();
      else if(target.closest('#loyaltyRemoveBtn')) clear();
    });
  }

  function init(){
    if(!app.dom.byId('loyaltyBox')) return;
    bind();
    renderInfo();
  }

  app.loyalty = {init, checkBalance, clear, getRedeem, pointsDiscountFor, renderInfo};
})();
