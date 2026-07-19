(function(){
  'use strict';

  const app = window.LaBelle = window.LaBelle || {};
  const LS_CART_KEY = 'lb_cart_v2';
  const LS_TTL_MS = 7 * 24 * 60 * 60 * 1000;

  let stateRef = null;

  function loadCart(){
    const data = app.storage.readJson(LS_CART_KEY, null);
    if(!data || !Array.isArray(data.cart)) return [];
    if(data.t && Date.now() - data.t > LS_TTL_MS){
      app.storage.remove(LS_CART_KEY);
      return [];
    }
    return data.cart;
  }

  function saveCart(){
    if(!stateRef) return;
    app.storage.writeJson(LS_CART_KEY, {t:Date.now(), cart:stateRef.cart});
  }

  function clearCart(){
    if(stateRef) stateRef.cart = [];
    app.storage.remove(LS_CART_KEY);
    if(app.promo) app.promo.clear();
    if(app.loyalty) app.loyalty.clear();
    updateCartCount();
  }

  function init(state){
    stateRef = state;
    state.cart = loadCart();
    updateCartCount();
    bindCartEvents();
    if(app.promo) app.promo.init();
    if(app.loyalty) app.loyalty.init();
  }

  function updateCartCount(){
    const count = stateRef?.cart?.reduce((sum, item) => sum + item.quantity, 0) || 0;
    const el = app.dom.byId('cartCount');
    if(el) el.textContent = count;
  }

  function addProduct(productId){
    const state = stateRef;
    const product = state.products.find(item => item.id === productId);
    if(!product || !product.available) return;
    const option = state.selectedOptions[productId] || {volume:Object.keys(product.volumes || {})[0]};
    const volume = option.volume || Object.keys(product.volumes || {})[0];
    const price = product.volumes?.[volume] || 0;
    if(!price) return;
    const key = `${productId}-volume-${volume}`;
    const existing = state.cart.find(item => item.key === key);
    if(existing) existing.quantity += 1;
    else{
      state.cart.push({
        key,
        id:productId,
        name:product.name,
        brand:product.brand,
        description:`${volume}мл`,
        type:'product',
        price,
        quantity:1
      });
    }
    updateCartCount();
    saveCart();
  }

  function addCustomSet(setData){
    if(!stateRef) return;
    stateRef.cart.push({
      key:`custom-set-${Date.now()}`,
      id:'custom-set',
      name:app.i18n.t('sets.customSetName'),
      brand:app.i18n.t('sets.customSetBrand', {count:setData.count, volume:setData.volume}),
      description:setData.names.join(', '),
      type:'custom-set',
      price:setData.price,
      quantity:1
    });
    updateCartCount();
    saveCart();
  }

  function addCertificate(amount){
    if(!stateRef) return;
    const value = Math.max(0, Math.round(Number(amount) || 0));
    if(!value) return;
    stateRef.cart.push({
      key:`certificate-${Date.now()}`,
      id:'certificate',
      name:app.i18n.t('gift.itemName'),
      brand:app.i18n.t('gift.itemBrand', {amount:app.dom.rub(value)}),
      description:app.i18n.t('gift.itemDesc'),
      type:'certificate',
      price:value,
      quantity:1
    });
    updateCartCount();
    saveCart();
  }

  function changeQuantity(itemKey, change){
    const item = stateRef.cart.find(cartItem => cartItem.key === itemKey);
    if(!item) return;
    item.quantity += change;
    if(item.quantity <= 0) removeFromCart(itemKey);
    else{
      displayCartItems();
      updateCartCount();
      saveCart();
    }
  }

  function removeFromCart(itemKey){
    stateRef.cart = stateRef.cart.filter(item => item.key !== itemKey);
    displayCartItems();
    updateCartCount();
    saveCart();
  }

  function getCartSubtotal(){
    return stateRef?.cart?.reduce((sum, item) => sum + item.price * item.quantity, 0) || 0;
  }

  // База промокода — без подарочных сертификатов (промо на них не действует).
  function getCartPromoBase(){
    return stateRef?.cart?.reduce((sum, item) => sum + (item.type === 'certificate' ? 0 : item.price * item.quantity), 0) || 0;
  }

  function getCartPromoDiscount(){
    return app.promo ? app.promo.discountFor(getCartPromoBase()) : 0;
  }

  function getCartPointsDiscount(){
    const afterPromo = getCartSubtotal() - getCartPromoDiscount();
    return app.loyalty ? app.loyalty.pointsDiscountFor(afterPromo) : 0;
  }

  function getCartDiscount(){
    return getCartPromoDiscount() + getCartPointsDiscount();
  }

  function getCartTotal(){
    return Math.max(0, getCartSubtotal() - getCartDiscount());
  }

  function renderTotals(){
    const subtotal = getCartSubtotal();
    const promoDiscount = getCartPromoDiscount();
    const pointsDiscount = getCartPointsDiscount();
    const subtotalEl = app.dom.byId('subtotalPrice');
    if(subtotalEl) subtotalEl.textContent = app.dom.rub(subtotal);
    const discountEl = app.dom.byId('discountPrice');
    if(discountEl) discountEl.textContent = app.dom.rub(promoDiscount);
    const discountLine = app.dom.byId('cartDiscountLine');
    if(discountLine) discountLine.classList.toggle('is-hidden', promoDiscount <= 0);
    const pointsEl = app.dom.byId('pointsPrice');
    if(pointsEl) pointsEl.textContent = app.dom.rub(pointsDiscount);
    const pointsLine = app.dom.byId('cartPointsLine');
    if(pointsLine) pointsLine.classList.toggle('is-hidden', pointsDiscount <= 0);
    const total = app.dom.byId('totalPrice');
    if(total) total.textContent = app.dom.rub(getCartTotal());
  }

  function displayCartItems(){
    const cartItems = app.dom.byId('cartItems');
    if(!cartItems || !stateRef) return;
    if(!stateRef.cart.length){
      cartItems.innerHTML = `<div class="empty-state empty-state--cart">${app.i18n.t('cart.empty')}</div>`;
      renderTotals();
      return;
    }
    cartItems.innerHTML = stateRef.cart.map(item => `
      <div class="cart-item">
        <div class="cart-item-info">
          <div class="cart-item-name">${app.dom.escapeHtml(item.name)}</div>
          <div class="cart-item-details">${app.dom.escapeHtml(item.brand)}</div>
          <div class="cart-item-details">${app.dom.escapeHtml(item.description)}</div>
          <div class="cart-item-price">${app.dom.rub(item.price)} ₸</div>
        </div>
        <div class="quantity-controls">
          <button class="quantity-btn" type="button" data-cart-key="${app.dom.escapeHtml(item.key)}" data-cart-change="-1">−</button>
          <span class="cart-quantity">${item.quantity}</span>
          <button class="quantity-btn" type="button" data-cart-key="${app.dom.escapeHtml(item.key)}" data-cart-change="1">+</button>
          <button class="quantity-btn quantity-btn--remove" type="button" data-cart-key="${app.dom.escapeHtml(item.key)}" data-cart-remove="true">${app.i18n.t('cart.remove')}</button>
        </div>
      </div>
    `).join('');
    renderTotals();
  }

  function openCart(){
    displayCartItems();
    app.payments.syncPaymentUi();
    app.ui.openModal('cartModal');
  }

  function closeCart(){
    app.ui.closeModal('cartModal');
  }

  function bindCartEvents(){
    app.dom.byId('openCartBtn')?.addEventListener('click', openCart);
    app.dom.byId('closeCartBtn')?.addEventListener('click', closeCart);
    app.dom.byId('cartItems')?.addEventListener('click', event => {
      const button = app.dom.closestFromEvent(event, '[data-cart-key]');
      if(!button) return;
      const key = button.dataset.cartKey;
      if(button.dataset.cartRemove === 'true') removeFromCart(key);
      else changeQuantity(key, parseInt(button.dataset.cartChange, 10));
    });
  }

  app.cart = {
    init,
    addProduct,
    addCustomSet,
    addCertificate,
    clearCart,
    saveCart,
    openCart,
    closeCart,
    updateCartCount,
    displayCartItems,
    getCartTotal,
    getCartSubtotal,
    getCartDiscount,
    getCartPromoBase,
    getCartPromoDiscount,
    getCartPointsDiscount,
    getItems: () => stateRef?.cart || []
  };
})();
