(function(){
  'use strict';

  const app = window.LaBelle = window.LaBelle || {};

  function readJson(key, fallback){
    try{
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    }catch(_){
      return fallback;
    }
  }

  function writeJson(key, value){
    try{
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    }catch(_){
      return false;
    }
  }

  function remove(key){
    try{ localStorage.removeItem(key); }catch(_){}
  }

  app.storage = {readJson, writeJson, remove};

  app.dom = {
    byId: id => document.getElementById(id),
    all: (selector, root = document) => Array.from(root.querySelectorAll(selector)),
    closestFromEvent(event, selector){
      return event.target instanceof Element ? event.target.closest(selector) : null;
    },
    escapeHtml(value){
      return String(value ?? '').replace(/[&<>"']/g, ch => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      }[ch]));
    },
    rub(value){
      const n = Number(value);
      return Number.isFinite(n) ? n.toLocaleString('ru-RU') : value;
    }
  };

  // Фоллбэки для битых картинок без инлайновых onerror-обработчиков,
  // чтобы работала строгая Content-Security-Policy (script-src 'self').
  // data-img-fallback="hide" прячет картинку, любое другое значение
  // подставляется как текст (эмодзи) в div с классом data-img-fallback-class.
  document.addEventListener('error', event => {
    const img = event.target;
    if(!(img instanceof HTMLImageElement)) return;
    const fallback = img.dataset.imgFallback;
    if(!fallback) return;
    if(fallback === 'hide'){
      img.style.display = 'none';
      return;
    }
    const div = document.createElement('div');
    if(img.dataset.imgFallbackClass) div.className = img.dataset.imgFallbackClass;
    div.textContent = fallback;
    img.replaceWith(div);
  }, true);

  function syncBodyScrollLock(){
    document.body.style.overflow = document.querySelector('.modal.is-open') ? 'hidden' : '';
  }

  function openModal(id){
    const modal = app.dom.byId(id);
    if(!modal) return;
    modal.classList.add('is-open');
    syncBodyScrollLock();
  }

  function closeModal(id){
    const modal = app.dom.byId(id);
    if(!modal) return;
    modal.classList.remove('is-open');
    syncBodyScrollLock();
  }

  app.ui = app.ui || {};
  app.ui.openModal = openModal;
  app.ui.closeModal = closeModal;
  app.ui.closeTopModal = function(){
    const opened = app.dom.all('.modal.is-open');
    const modal = opened[opened.length - 1];
    if(!modal) return;
    if(modal.id === 'cartModal') app.cart.closeCart();
    else if(modal.id === 'productModal') app.products.closeProductModal();
    else closeModal(modal.id);
  };
  app.ui.bindNavigation = function(){
    app.dom.all('[data-filters-toggle]').forEach(button => {
      const target = app.dom.byId(button.dataset.filtersToggle);
      if(!target) return;
      button.addEventListener('click', () => {
        const open = target.classList.toggle('is-open');
        button.setAttribute('aria-expanded', open ? 'true' : 'false');
      });
    });

    const burger = app.dom.byId('burgerBtn');
    const nav = app.dom.byId('siteNav');
    if(burger && nav){
      const closeNavigation = () => {
        nav.classList.remove('is-open');
        burger.setAttribute('aria-expanded', 'false');
        document.body.classList.remove('nav-locked');
      };

      burger.addEventListener('click', () => {
        const open = nav.classList.toggle('is-open');
        burger.setAttribute('aria-expanded', open ? 'true' : 'false');
        document.body.classList.toggle('nav-locked', open);
      });
      nav.addEventListener('click', event => {
        const link = app.dom.closestFromEvent(event, 'a,button');
        if(!link) return;
        closeNavigation();
      });
      document.addEventListener('click', event => {
        if(!nav.classList.contains('is-open') || !(event.target instanceof Element)) return;
        if(event.target.closest('.site-header')) return;
        closeNavigation();
      });
      window.addEventListener('resize', () => {
        if(window.innerWidth > 1020) closeNavigation();
      });
    }

    document.addEventListener('click', event => {
      if(!(event.target instanceof Element)) return;
      if(event.target.classList.contains('modal')){
        if(event.target.id === 'cartModal') app.cart.closeCart();
        else if(event.target.id === 'productModal') app.products.closeProductModal();
        else closeModal(event.target.id);
      }
    });
    document.addEventListener('keydown', event => {
      if(event.key === 'Escape') app.ui.closeTopModal();
    });
  };
})();
