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

  // На sets.html каталог нужен не для витрины, а ради картинок в составе сетов.
  const PRODUCT_PAGES = ['catalog','custom-set','sets'];
  const READY_SET_PAGES = ['catalog','sets'];

  async function initProducts(){
    if(!PRODUCT_PAGES.includes(page)) return [];
    try{
      state.products = await app.products.loadProducts();
      app.products.populateHeroShelf(state.products);
      if(page === 'catalog') app.products.initCatalogPage(state);
      if(page === 'custom-set') app.products.initSetPage(state);
    }catch(err){
      app.products.renderLoadError(page, err);
    }
    return state.products;
  }

  // Готовые сеты грузятся параллельно каталогу, но рисуются после него:
  // состав сета — это позиции каталога, оттуда же берутся картинки флаконов.
  let productsReady = Promise.resolve([]);

  function initReadySets(){
    if(!READY_SET_PAGES.includes(page)) return;
    app.readySets.init(page, productsReady);
  }

  document.addEventListener('DOMContentLoaded', () => {
    app.i18n.init();
    app.ui.bindNavigation();
    app.checkout.bindCheckoutPersistence();
    app.cart.init(state);
    app.checkout.init(state);
    initYear();
    productsReady = initProducts();
    initReadySets();
  });

  document.addEventListener('lb:language-changed', () => {
    if(app.readySets) app.readySets.render(page, state.products);
    if(!state.products.length) return;
    if(page === 'catalog') app.products.initCatalogPage(state);
    if(page === 'custom-set') app.products.initSetPage(state);
    if(document.querySelector('#cartModal.is-open')) app.cart.displayCartItems();
    app.payments.syncPaymentUi();
  });
})();
