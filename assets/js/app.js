(function(){
  'use strict';

  const app = window.LaBelle;
  const page = document.body.dataset.page || 'catalog';
  const state = {
    page,
    products: [],
    cart: [],
    selectedOptions: {},
    filters: {
      search: '',
      brand: '',
      volume: '',
      category: '',
      season: '',
      gender: '',
      occasion: '',
      minPrice: '',
      maxPrice: '',
      availability: 'available',
      sort: 'default'
    },
    setFilters: {
      search: '',
      brand: '',
      category: '',
      season: '',
      gender: '',
      occasion: '',
      volume: ''
    },
    pagination: {
      catalogPage: 1,
      catalogPageSize: 24,
      setPage: 1,
      setPageSize: 20
    },
    customSetSelection: []
  };

  app.state = state;

  function initYear(){
    const year = app.dom.byId('yearSpan');
    if(year) year.textContent = new Date().getFullYear();
  }

  async function initProducts(){
    if(page !== 'catalog' && page !== 'custom-set') return;
    try{
      state.products = await app.products.loadProducts();
      app.products.populateHeroShelf(state.products);
      if(page === 'catalog') app.products.initCatalogPage(state);
      if(page === 'custom-set') app.products.initSetPage(state);
    }catch(err){
      app.products.renderLoadError(page, err);
    }
  }

  document.addEventListener('DOMContentLoaded', () => {
    app.i18n.init();
    app.ui.bindNavigation();
    app.checkout.bindCheckoutPersistence();
    app.cart.init(state);
    app.checkout.init(state);
    initYear();
    initProducts();
  });

  document.addEventListener('lb:language-changed', () => {
    if(!state.products.length) return;
    if(page === 'catalog') app.products.initCatalogPage(state);
    if(page === 'custom-set') app.products.initSetPage(state);
    if(document.querySelector('#cartModal.is-open')) app.cart.displayCartItems();
    app.payments.syncPaymentUi();
  });
})();
