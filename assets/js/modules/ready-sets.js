(function(){
  'use strict';

  const app = window.LaBelle = window.LaBelle || {};

  let loaded = false;
  let sets = [];
  let loadError = '';
  // Каталог нужен только за картинками: состав, цены и наличие считает сервер.
  let catalogByKey = new Map();

  function toInt(value){
    const digits = String(value ?? '').replace(/[^\d]/g, '');
    return digits ? parseInt(digits, 10) : 0;
  }

  // Теги в таблице пишутся одной строкой через запятую/точку с запятой.
  function splitList(value){
    return String(value ?? '')
      .split(/[,;\n]/)
      .map(part => part.trim())
      .filter(Boolean);
  }

  // Русский текст — основной, поля вида name_kk подхватываются для казахского.
  function localized(row, field){
    const lang = app.i18n.getLanguage();
    if(lang !== 'ru'){
      const translated = String(row[`${field}_${lang}`] ?? '').trim();
      if(translated) return translated;
    }
    return String(row[field] ?? '').trim();
  }

  function normalizeDrive(urlValue){
    if(!urlValue) return '';
    try{
      const url = new URL(urlValue);
      if(url.hostname === 'drive.google.com'){
        const match = url.pathname.match(/\/file\/d\/([^/]+)/);
        if(match) return `https://drive.google.com/uc?export=view&id=${match[1]}`;
      }
    }catch(_){}
    return urlValue;
  }

  // Сервер уже раскрыл items в позиции каталога: key совпадает с product.key,
  // found:false — строку не нашли в каталоге, показываем её текстом как есть.
  function normalizeItems(rawItems){
    if(!Array.isArray(rawItems)) return [];
    return rawItems.map(item => ({
      key:String(item.key ?? ''),
      brand:String(item.brand ?? ''),
      name:String(item.name ?? ''),
      price:toInt(item.price),
      available:item.available !== false,
      found:item.found === true
    })).filter(item => item.name || item.brand);
  }

  function normalizeSet(row, index){
    const items = normalizeItems(row.items);
    const price = toInt(row.price);
    const oldPrice = toInt(row.old_price);
    return {
      id:String(row.set_id ?? '').trim(),
      name:localized(row, 'name'),
      description:localized(row, 'description'),
      badge:localized(row, 'badge'),
      items,
      volume:String(row.volume ?? '').trim(),
      count:toInt(row.count) || items.length,
      price,
      oldPrice:oldPrice > price ? oldPrice : 0,
      image:normalizeDrive(String(row.image_url ?? '').trim()),
      tags:splitList(row.tags),
      available:row.available !== false,
      sort:toInt(row.sort) || index + 1
    };
  }

  function sortSets(list){
    return [...list].sort((a, b) => {
      if(a.available !== b.available) return a.available ? -1 : 1;
      if(a.sort !== b.sort) return a.sort - b.sort;
      return a.price - b.price;
    });
  }

  async function load(){
    if(loaded) return sets;
    if(!app.api.isConfigured()){
      loaded = true;
      return sets;
    }
    try{
      const data = await app.api.get({action:'sets'});
      if(data && data.ok && Array.isArray(data.rows)){
        sets = sortSets(data.rows.map(normalizeSet).filter(set => set.id && set.name && set.price > 0));
      }
    }catch(err){
      loadError = err.message;
      console.warn('Ready sets load failed:', err);
    }
    loaded = true;
    return sets;
  }

  function setCatalog(products){
    catalogByKey = new Map();
    (products || []).forEach(product => {
      if(product.key) catalogByKey.set(product.key, product);
    });
  }

  function productFor(item){
    return item.key ? catalogByKey.get(item.key) || null : null;
  }

  function getSets(){
    return sets;
  }

  function findSet(setId){
    return sets.find(set => set.id === setId) || null;
  }

  function itemLabel(item){
    const product = productFor(item);
    const brand = product ? product.brand : item.brand;
    const name = product ? product.name : item.name;
    return [brand, name].filter(Boolean).join(' ');
  }

  function bottlesLabel(set){
    if(!set.count) return '';
    return set.volume
      ? app.i18n.t('readySets.bottles', {count:set.count, volume:set.volume})
      : app.i18n.t('readySets.bottlesNoVolume', {count:set.count});
  }

  // Своя картинка сета важнее; иначе собираем полку из флаконов каталога,
  // а если и их нет — остаётся эмодзи-заглушка.
  function imageHtml(set){
    const esc = app.dom.escapeHtml;
    if(set.image){
      return `<img src="${esc(set.image)}" alt="${esc(set.name)}" loading="lazy" data-img-fallback="🎁" data-img-fallback-class="set-card-fallback">`;
    }
    const shelf = set.items
      .map(productFor)
      .filter(product => product && product.image)
      .slice(0, 3);
    if(!shelf.length) return '<div class="set-card-fallback">🎁</div>';
    return `<div class="set-card-shelf" aria-hidden="true">${shelf
      .map(product => `<img src="${esc(product.image)}" alt="" loading="lazy" data-img-fallback="hide">`)
      .join('')}</div>`;
  }

  function compositionHtml(set){
    const esc = app.dom.escapeHtml;
    if(!set.items.length) return '';
    const rows = set.items.map(item => {
      const out = item.found && !item.available;
      const note = out ? ` <span class="set-card-item-note">${esc(app.i18n.t('filters.unavailable'))}</span>` : '';
      return `<li${out ? ' class="is-out"' : ''}>${esc(itemLabel(item))}${note}</li>`;
    }).join('');
    return `
      <div class="set-card-composition">
        <span class="set-card-composition-title">${esc(app.i18n.t('readySets.composition'))}</span>
        <ul class="set-card-list">${rows}</ul>
      </div>
    `;
  }

  function cardHtml(set, compact){
    const esc = app.dom.escapeHtml;
    const tags = [bottlesLabel(set), ...set.tags]
      .filter(Boolean)
      .map(tag => `<span class="tag">${esc(tag)}</span>`)
      .join('');
    const saving = set.oldPrice ? set.oldPrice - set.price : 0;

    return `
      <article class="set-card${compact ? ' set-card--compact' : ''}${set.available ? '' : ' is-unavailable'}">
        <div class="set-card-image">
          ${imageHtml(set)}
          ${set.badge ? `<span class="set-card-badge">${esc(set.badge)}</span>` : ''}
          ${saving > 0 ? `<span class="set-card-saving">−${app.dom.rub(saving)} ₸</span>` : ''}
        </div>
        <div class="set-card-body">
          <h3 class="set-card-name">${esc(set.name)}</h3>
          ${set.description ? `<p class="set-card-desc">${esc(set.description)}</p>` : ''}
          ${compact ? '' : compositionHtml(set)}
          <div class="set-card-tags">
            ${set.available ? '' : `<span class="tag tag--danger">${esc(app.i18n.t('readySets.soldOut'))}</span>`}
            ${tags}
          </div>
          <div class="set-card-footer">
            <div class="set-card-price">
              ${set.oldPrice ? `<span class="set-card-price-old">${app.dom.rub(set.oldPrice)} ₸</span>` : ''}
              <span class="set-card-price-now">${app.dom.rub(set.price)} ₸</span>
            </div>
            <button class="add-to-cart set-card-add" type="button" data-ready-set="${esc(set.id)}" ${set.available ? '' : 'disabled'}>
              ${esc(app.i18n.t(set.available ? 'readySets.add' : 'readySets.soldOut'))}
            </button>
          </div>
        </div>
      </article>
    `;
  }

  function addToCart(setId){
    const set = findSet(setId);
    if(!set || !set.available) return;
    app.cart.addReadySet({
      id:set.id,
      name:set.name,
      count:set.count,
      volume:set.volume,
      price:set.price,
      // Только названия ароматов — в том же виде, что у кастомного сета,
      // чтобы аналитика считала их одним списком.
      names:set.items.map(item => (productFor(item) || item).name).filter(Boolean)
    });
    app.cart.openCart();
  }

  function bindGrid(container){
    if(container.dataset.bound === 'true') return;
    container.dataset.bound = 'true';
    container.addEventListener('click', event => {
      const button = app.dom.closestFromEvent(event, '[data-ready-set]');
      if(!button || button.disabled) return;
      addToCart(button.dataset.readySet);
    });
  }

  // На главной пустая лента прячется целиком (пустой блок на витрине хуже,
  // чем его отсутствие), а на своей странице показывается текстом.
  function renderInto(gridId, sectionId, {compact = false, limit = 0, hideWhenEmpty = true} = {}){
    const grid = app.dom.byId(gridId);
    const section = app.dom.byId(sectionId);
    if(!grid) return;
    const list = limit ? sets.slice(0, limit) : sets;

    if(!list.length){
      if(hideWhenEmpty){
        section?.classList.add('is-hidden');
        grid.innerHTML = '';
        return;
      }
      section?.classList.remove('is-hidden');
      const message = loadError
        ? app.i18n.t('readySets.loadError', {error:loadError})
        : app.i18n.t('readySets.empty');
      grid.innerHTML = `<div class="empty-state">${app.dom.escapeHtml(message)}</div>`;
      setCount(0);
      return;
    }

    section?.classList.remove('is-hidden');
    grid.innerHTML = list.map(set => cardHtml(set, compact)).join('');
    bindGrid(grid);
    if(!compact) setCount(sets.length);
  }

  function setCount(count){
    const countEl = app.dom.byId('readySetsCount');
    if(countEl) countEl.textContent = app.i18n.t('readySets.count', {count});
  }

  function renderCatalogStrip(){
    renderInto('readySetsStrip', 'readySetsSection', {compact:true, limit:8});
  }

  function renderSetsPage(){
    renderInto('readySetsGrid', 'ready-sets', {hideWhenEmpty:false});
  }

  function render(page, products){
    if(products) setCatalog(products);
    if(page === 'sets') renderSetsPage();
    else renderCatalogStrip();
  }

  async function init(page, whenProductsReady){
    // Сеты и каталог грузятся параллельно, но рисуем только когда есть оба:
    // из каталога берутся картинки ароматов.
    const [, products] = await Promise.all([load(), whenProductsReady]);
    render(page, products);
  }

  app.readySets = {init, load, render, setCatalog, getSets, findSet};
})();
