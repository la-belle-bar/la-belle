(function(){
  'use strict';

  const app = window.LaBelle = window.LaBelle || {};

  const AMOUNTS = (app.config && Array.isArray(app.config.certificateAmounts) && app.config.certificateAmounts.length)
    ? app.config.certificateAmounts.map(Number).filter(value => value > 0)
    : [5000, 10000, 15000, 25000];

  let chosen = AMOUNTS[1] || AMOUNTS[0];

  function renderAmounts(){
    const wrap = app.dom.byId('certAmounts');
    if(!wrap) return;
    wrap.innerHTML = AMOUNTS.map(amount => `
      <button class="cert-amount${amount === chosen ? ' is-active' : ''}" type="button" data-cert-amount="${amount}">
        ${app.dom.rub(amount)} ₸
      </button>
    `).join('');
    const chosenEl = app.dom.byId('certChosen');
    if(chosenEl) chosenEl.textContent = app.dom.rub(chosen);
  }

  function buy(){
    if(!app.cart) return;
    app.cart.addCertificate(chosen);
    app.cart.openCart();
  }

  function bind(){
    const wrap = app.dom.byId('certAmounts');
    if(wrap && wrap.dataset.bound !== 'true'){
      wrap.dataset.bound = 'true';
      wrap.addEventListener('click', event => {
        const button = app.dom.closestFromEvent(event, '[data-cert-amount]');
        if(!button) return;
        chosen = Number(button.dataset.certAmount) || chosen;
        renderAmounts();
      });
    }
    const buyBtn = app.dom.byId('buyCertBtn');
    if(buyBtn && buyBtn.dataset.bound !== 'true'){
      buyBtn.dataset.bound = 'true';
      buyBtn.addEventListener('click', buy);
    }
  }

  function init(){
    if(!app.dom.byId('certAmounts')) return;
    renderAmounts();
    bind();
  }

  document.addEventListener('DOMContentLoaded', init);
  document.addEventListener('lb:language-changed', renderAmounts);

  app.gift = {init, renderAmounts};
})();
