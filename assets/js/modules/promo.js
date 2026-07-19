(function(){
  'use strict';

  const app = window.LaBelle = window.LaBelle || {};
  const LS_PROMO_KEY = 'lb_promo_v1';

  // {code, type:'percent'|'fixed'|'cert', value, min_order} | null
  let applied = null;

  function load(){
    const data = app.storage.readJson(LS_PROMO_KEY, null);
    applied = data && data.code ? data : null;
  }

  function save(){
    if(applied) app.storage.writeJson(LS_PROMO_KEY, applied);
    else app.storage.remove(LS_PROMO_KEY);
  }

  function get(){ return applied; }

  // Скидку всегда пересчитываем от актуального подытога (корзина могла измениться).
  function discountFor(subtotal){
    if(!applied) return 0;
    if(applied.min_order && subtotal < applied.min_order) return 0;
    const raw = applied.type === 'percent'
      ? Math.round(subtotal * Number(applied.value) / 100)
      : Number(applied.value);
    return Math.max(0, Math.min(raw, subtotal));
  }

  function setMessage(text, tone){
    const el = app.dom.byId('promoMessage');
    if(!el) return;
    el.textContent = text || '';
    el.dataset.tone = text ? (tone || '') : '';
  }

  function errorMessage(res){
    if(res.error === 'min_order'){
      return app.i18n.t('promo.errMinOrder', {min:app.dom.rub(res.min_order || 0)});
    }
    const map = {
      empty:'promo.errEmpty',
      not_found:'promo.errNotFound',
      inactive:'promo.errInactive',
      expired:'promo.errExpired',
      used_up:'promo.errUsedUp',
      promo_not_configured:'promo.errUnavailable',
      bad_sheet:'promo.errUnavailable'
    };
    const key = map[res.error];
    return key ? app.i18n.t(key) : (res.message || app.i18n.t('promo.errInvalid'));
  }

  function renderCart(){
    const input = app.dom.byId('promoInput');
    const button = app.dom.byId('applyPromoBtn');
    if(!input || !button) return;
    if(applied){
      input.value = applied.code;
      input.disabled = true;
      button.dataset.mode = 'remove';
      button.textContent = app.i18n.t('promo.remove');
    }else{
      input.disabled = false;
      button.dataset.mode = 'apply';
      button.textContent = app.i18n.t('promo.apply');
    }
  }

  async function apply(codeRaw){
    const code = String(codeRaw || '').trim();
    if(!code){ setMessage(app.i18n.t('promo.errEmpty'), 'danger'); return; }
    const button = app.dom.byId('applyPromoBtn');
    // База промо — без сертификатов (совпадает с серверным пересчётом).
    const subtotal = app.cart.getCartPromoBase();
    if(button) button.disabled = true;
    let res;
    try{
      res = await app.api.get({action:'validate_promo', code, subtotal});
    }catch(err){
      res = {ok:false, error:'network'};
    }
    if(button) button.disabled = false;

    if(res && res.skipped){ setMessage(app.i18n.t('promo.errUnavailable'), 'danger'); return; }
    if(res && res.ok){
      applied = {code:res.code, type:res.type, value:res.value, min_order:res.min_order || 0};
      save();
      app.cart.displayCartItems();
      renderCart();
      setMessage(app.i18n.t('promo.applied', {amount:app.dom.rub(res.discount)}), 'ok');
    }else{
      applied = null;
      save();
      app.cart.displayCartItems();
      renderCart();
      setMessage(errorMessage(res || {}), 'danger');
    }
  }

  function clear(){
    applied = null;
    save();
    const input = app.dom.byId('promoInput');
    if(input){ input.value = ''; input.disabled = false; }
    setMessage('', '');
    renderCart();
    if(app.cart) app.cart.displayCartItems();
  }

  function bind(){
    const button = app.dom.byId('applyPromoBtn');
    const input = app.dom.byId('promoInput');
    if(button && button.dataset.bound !== 'true'){
      button.dataset.bound = 'true';
      button.addEventListener('click', () => {
        if(button.dataset.mode === 'remove') clear();
        else apply(input ? input.value : '');
      });
    }
    if(input && input.dataset.bound !== 'true'){
      input.dataset.bound = 'true';
      input.addEventListener('keydown', event => {
        if(event.key === 'Enter'){ event.preventDefault(); apply(input.value); }
      });
    }
  }

  function init(){
    load();
    bind();
    renderCart();
    if(applied) setMessage(app.i18n.t('promo.appliedShort', {code:applied.code}), 'ok');
    // Кнопкой «Применить/Убрать» управляем из JS — при смене языка обновляем сами.
    document.addEventListener('lb:language-changed', () => {
      renderCart();
      if(applied) setMessage(app.i18n.t('promo.appliedShort', {code:applied.code}), 'ok');
    });
  }

  app.promo = {init, apply, clear, get, discountFor, renderCart};
})();
