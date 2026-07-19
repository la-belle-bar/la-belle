(function(){
  'use strict';

  const app = window.LaBelle = window.LaBelle || {};
  const LS_PRODUCT_OVERRIDES_KEY = 'lb_product_overrides_v1';

  function toInt(value){
    const digits = String(value ?? '').replace(/[^\d]/g, '');
    return digits ? parseInt(digits, 10) : null;
  }

  function slug(value){
    return String(value || '')
      .toLowerCase()
      .replace(/['']/g, '')
      .replace(/[^a-z0-9а-яё\s-]/gi, ' ')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/\s/g, '_');
  }

  function imagePathFor(product){
    return `images/${slug(product.brand)}_${slug(product.name)}.jpg`;
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

  function getRowValue(row, keys){
    for(const key of keys){
      if(row[key] != null && String(row[key]).trim() !== '') return row[key];
    }
    return '';
  }

  function normalizeIdentity(value){
    return String(value || '').trim().toLowerCase();
  }

  function makeProductKey(row, index){
    const explicit = getRowValue(row, ['product_id','sku','id','артикул']);
    if(explicit) return `sku:${normalizeIdentity(explicit)}`;
    const brand = normalizeIdentity(row.brand);
    const name = normalizeIdentity(row.name);
    return brand || name ? `name:${brand}|${name}` : `row:${index + 1}`;
  }

  function getStockQty(row){
    const raw = getRowValue(row, ['stock_qty','qty','quantity','stock_count','остаток','количество']);
    if(raw === '') return null;
    const parsed = toInt(raw);
    return parsed == null ? 0 : parsed;
  }

  function getVolumes(row){
    const volumes = {};
    [
      ['price_2ml','2'],
      ['price_5ml','5'],
      ['price_10ml','10'],
      ['price_15ml','15'],
      ['price_20ml','20']
    ].forEach(([column, volume]) => {
      const price = toInt(row[column]);
      if(price) volumes[volume] = price;
    });
    return volumes;
  }

  function getMinPrice(product){
    const prices = Object.values(product.volumes || {}).filter(price => Number(price) > 0);
    return prices.length ? Math.min(...prices) : null;
  }

  function getAvailability(row, volumes, stockQty){
    if(stockQty != null) return Number(stockQty) > 0;
    const raw = String(getRowValue(row, ['status','availability','available','in_stock','stock','наличие','статус']) || '').toLowerCase();
    if(raw){
      if(['нет','не в наличии','sold','out','false','0','no'].some(item => raw.includes(item))) return false;
      if(['в наличии','available','true','yes','1','stock'].some(item => raw.includes(item))) return true;
    }
    return Object.values(volumes).some(price => Number(price) > 0);
  }

  function getProductAvailability(product){
    if(product.stockQty != null) return Number(product.stockQty) > 0;
    return Object.values(product.volumes || {}).some(price => Number(price) > 0);
  }

  function normalizeProduct(product){
    product.stockQty = product.stockQty == null || product.stockQty === '' ? null : Number(product.stockQty);
    product.image = product.imageUrl ? normalizeDrive(String(product.imageUrl).trim()) : imagePathFor(product);
    product.available = getProductAvailability(product);
    product.minPrice = getMinPrice(product);
    return product;
  }

  function getProductOverrides(){
    return app.storage.readJson(LS_PRODUCT_OVERRIDES_KEY, {});
  }

  function saveProductOverrides(overrides){
    app.storage.writeJson(LS_PRODUCT_OVERRIDES_KEY, overrides);
  }

  function applyProductOverride(product){
    const override = getProductOverrides()[product.key];
    if(!override) return normalizeProduct(product);
    return normalizeProduct({
      ...product,
      ...override,
      notes:{
        ...product.notes,
        ...(override.notes || {})
      },
      volumes:override.volumes ? {...override.volumes} : product.volumes
    });
  }

  async function fetchRows(){
    if(!app.api.isConfigured()) throw new Error('apiUrl не настроен в config.js');
    const data = await app.api.get({action:'catalog'});
    if(!data.ok || !Array.isArray(data.rows)) throw new Error(data.error || 'Каталог недоступен');
    return data.rows;
  }

  function mapRows(rows){
    return rows.map((row, index) => {
      const volumes = getVolumes(row);
      const stockQty = getStockQty(row);
      const product = {
        id:index + 1,
        key:makeProductKey(row, index),
        rowNumber:index + 2,
        brand:row.brand || '',
        name:row.name || '',
        category:getRowValue(row, ['category','type','group','категория']),
        season:getRowValue(row, ['season','сезон','seasonality','сезонность']),
        gender:getRowValue(row, ['gender','sex','пол']),
        occasion:getRowValue(row, ['occasion','use_case','purpose','повод','сценарий']),
        longevity:getRowValue(row, ['longevity','стойкость']),
        sillage:getRowValue(row, ['sillage','шлейф']),
        description:row.description_short || `${row.brand || ''} ${row.name || ''}`.trim(),
        fullDescription:row.description_full || '',
        emoji:'🧴',
        notes:{
          top:row.notes_top || '—',
          heart:row.notes_heart || '—',
          base:row.notes_base || '—'
        },
        volumes,
        stockQty,
        available:getAvailability(row, volumes, stockQty),
        imageUrl:row.image_url || '',
        image:''
      };
      return applyProductOverride(product);
    }).filter(product => product.brand || product.name);
  }

  async function loadProducts(){
    const rows = await fetchRows();
    return mapRows(rows);
  }

  function getUniqueBrands(products){
    return Array.from(new Set(products.map(product => product.brand).filter(Boolean))).sort((a,b) => a.localeCompare(b, 'ru'));
  }

  function getUniqueVolumes(products){
    return Array.from(new Set(products.flatMap(product => Object.keys(product.volumes || {}))))
      .sort((a,b) => Number(a) - Number(b));
  }

  function getUniqueCategories(products){
    return Array.from(new Set(products.map(product => product.category).filter(Boolean))).sort((a,b) => a.localeCompare(b, 'ru'));
  }

  function getUniqueField(products, field){
    return Array.from(new Set(products.map(product => product[field]).filter(Boolean))).sort((a,b) => a.localeCompare(b, 'ru'));
  }

  function fillSelect(select, values, allKey){
    if(!select) return;
    const current = select.value;
    select.innerHTML = `<option value="">${app.i18n.t(allKey)}</option>` + values
      .map(value => `<option value="${app.dom.escapeHtml(value)}">${app.dom.escapeHtml(value)}${allKey === 'filters.allVolumes' ? 'мл' : ''}</option>`)
      .join('');
    if(values.includes(current)) select.value = current;
  }

  function fillCatalogFilters(state){
    const products = state.products;
    const brands = getUniqueBrands(products);
    fillSelect(app.dom.byId('brandFilter'), brands, 'filters.allBrands');
    app.dom.byId('brandFilterField')?.classList.toggle('is-hidden', brands.length === 0);
    fillSelect(app.dom.byId('volumeFilter'), getUniqueVolumes(products), 'filters.allVolumes');
    const categories = getUniqueCategories(products);
    fillSelect(app.dom.byId('categoryFilter'), categories, 'filters.allCategories');
    app.dom.byId('categoryFilterField')?.classList.toggle('is-hidden', categories.length === 0);
    [
      ['season','seasonFilter','seasonFilterField','filters.allSeasons'],
      ['gender','genderFilter','genderFilterField','filters.allGenders'],
      ['occasion','occasionFilter','occasionFilterField','filters.allOccasions']
    ].forEach(([field, selectId, fieldId, allKey]) => {
      const values = getUniqueField(products, field);
      fillSelect(app.dom.byId(selectId), values, allKey);
      app.dom.byId(fieldId)?.classList.toggle('is-hidden', values.length === 0);
    });
  }

  function bindCatalogFilters(state){
    const bindings = [
      ['searchInput','search'],
      ['brandFilter','brand'],
      ['volumeFilter','volume'],
      ['categoryFilter','category'],
      ['seasonFilter','season'],
      ['genderFilter','gender'],
      ['occasionFilter','occasion'],
      ['minPriceFilter','minPrice'],
      ['maxPriceFilter','maxPrice'],
      ['availabilityFilter','availability'],
      ['sortSelect','sort']
    ];
    bindings.forEach(([id, key]) => {
      const el = app.dom.byId(id);
      if(!el || el.dataset.bound === 'true') return;
      el.dataset.bound = 'true';
      const handler = () => {
        state.filters[key] = el.value;
        state.pagination.catalogPage = 1;
        renderCatalog(state);
      };
      el.addEventListener('input', handler);
      el.addEventListener('change', handler);
    });
    const reset = app.dom.byId('resetFiltersBtn');
    if(reset && reset.dataset.bound !== 'true'){
      reset.dataset.bound = 'true';
      reset.addEventListener('click', () => {
        state.filters = {
          search:'',
          brand:'',
          volume:'',
          category:'',
          season:'',
          gender:'',
          occasion:'',
          minPrice:'',
          maxPrice:'',
          availability:'available',
          sort:'default'
        };
        Object.entries({
          searchInput:'search',
          brandFilter:'brand',
          volumeFilter:'volume',
          categoryFilter:'category',
          seasonFilter:'season',
          genderFilter:'gender',
          occasionFilter:'occasion',
          minPriceFilter:'minPrice',
          maxPriceFilter:'maxPrice',
          availabilityFilter:'availability',
          sortSelect:'sort'
        }).forEach(([id, key]) => {
          const el = app.dom.byId(id);
          if(el) el.value = state.filters[key];
        });
        state.pagination.catalogPage = 1;
        renderCatalog(state);
      });
    }
  }

  function productMatchesSearch(product, query){
    if(!query) return true;
    const hay = [
      product.brand,
      product.name,
      product.category,
      product.season,
      product.gender,
      product.occasion,
      product.description,
      product.fullDescription,
      product.notes.top,
      product.notes.heart,
      product.notes.base
    ].join(' ').toLowerCase();
    return hay.includes(query);
  }

  function getFilteredProducts(state){
    const filters = state.filters;
    const query = filters.search.trim().toLowerCase();
    const min = toInt(filters.minPrice);
    const max = toInt(filters.maxPrice);
    let list = state.products.filter(product => {
      if(!productMatchesSearch(product, query)) return false;
      if(filters.brand && product.brand !== filters.brand) return false;
      if(filters.category && product.category !== filters.category) return false;
      if(filters.season && product.season !== filters.season) return false;
      if(filters.gender && product.gender !== filters.gender) return false;
      if(filters.occasion && product.occasion !== filters.occasion) return false;
      if(filters.volume && !product.volumes?.[filters.volume]) return false;
      if(filters.availability === 'available' && !product.available) return false;
      if(filters.availability === 'unavailable' && product.available) return false;
      if(min != null && (product.minPrice == null || product.minPrice < min)) return false;
      if(max != null && (product.minPrice == null || product.minPrice > max)) return false;
      return true;
    });

    list = [...list];
    if(filters.sort === 'price-asc') list.sort((a,b) => (a.minPrice ?? Number.MAX_SAFE_INTEGER) - (b.minPrice ?? Number.MAX_SAFE_INTEGER));
    if(filters.sort === 'price-desc') list.sort((a,b) => (b.minPrice ?? -1) - (a.minPrice ?? -1));
    if(filters.sort === 'name-asc') list.sort((a,b) => a.name.localeCompare(b.name, 'ru'));
    return list;
  }

  function renderProductCard(product){
    const card = document.createElement('article');
    card.className = `product-card${product.available ? '' : ' is-unavailable'}`;
    card.tabIndex = 0;
    card.setAttribute('role', 'button');
    card.setAttribute('aria-label', `${product.brand} ${product.name}`);
    card.addEventListener('click', () => openProductModal(product.id));
    card.addEventListener('keydown', event => {
      if(event.target.closest && event.target.closest('.fav-btn')) return;
      if(event.key === 'Enter' || event.key === ' '){
        event.preventDefault();
        openProductModal(product.id);
      }
    });

    const priceHtml = product.minPrice
      ? app.i18n.t('product.fromPrice', {price:app.dom.rub(product.minPrice)})
      : app.i18n.t('product.priceRequest');
    const categoryTag = product.category ? `<span class="tag">${app.dom.escapeHtml(product.category)}</span>` : '';
    const extraTags = ['season','gender','occasion']
      .map(field => product[field] ? `<span class="tag">${app.dom.escapeHtml(product[field])}</span>` : '')
      .join('');
    const volumeTag = Object.keys(product.volumes || {}).length
      ? `<span class="tag">${Object.keys(product.volumes).join('/')}мл</span>`
      : '';

    card.innerHTML = `
      <div class="product-image-wrap">
        <img class="product-image" src="${app.dom.escapeHtml(product.image)}" alt="${app.dom.escapeHtml(product.name)}" data-img-fallback="${app.dom.escapeHtml(product.emoji)}" data-img-fallback-class="product-image">
        ${app.favorites.favButtonHtml(product)}
      </div>
      <div class="product-meta">
        <div class="product-brand">${app.dom.escapeHtml(product.brand)}</div>
        <div class="product-name">${app.dom.escapeHtml(product.name)}</div>
        <div class="product-price-line">
          <span class="product-price-range">${priceHtml}</span>
          ${app.reviews ? app.reviews.badgeHtml(product) : ''}
        </div>
        <div class="product-tags">
          ${product.available ? '' : `<span class="tag tag--danger">${app.i18n.t('filters.unavailable')}</span>`}
          ${volumeTag}
          ${categoryTag}
          ${extraTags}
        </div>
      </div>
    `;
    return card;
  }

  function getPaginationItems(currentPage, totalPages){
    const pages = Array.from(new Set([
      1,
      currentPage - 1,
      currentPage,
      currentPage + 1,
      totalPages
    ])).filter(page => page >= 1 && page <= totalPages).sort((a,b) => a - b);

    const items = [];
    pages.forEach((page, index) => {
      if(index > 0 && page - pages[index - 1] > 1) items.push(null);
      items.push(page);
    });
    return items;
  }

  function renderPagination(containerId, totalItems, currentPage, pageSize, onChange){
    const container = app.dom.byId(containerId);
    if(!container) return;
    const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
    if(totalItems === 0 || totalPages === 1){
      container.innerHTML = '';
      container.hidden = true;
      return;
    }

    container.hidden = false;
    const pageButtons = getPaginationItems(currentPage, totalPages).map(page => {
      if(page == null) return '<span class="pagination-ellipsis" aria-hidden="true">...</span>';
      const current = page === currentPage;
      return `<button class="pagination-btn${current ? ' is-current' : ''}" type="button" data-page="${page}" ${current ? 'aria-current="page"' : ''}>${page}</button>`;
    }).join('');

    container.innerHTML = `
      <button class="pagination-btn pagination-btn--arrow" type="button" data-page="${currentPage - 1}" aria-label="${app.i18n.t('pagination.previous')}" ${currentPage === 1 ? 'disabled' : ''}>&lsaquo;</button>
      <div class="pagination-pages">${pageButtons}</div>
      <button class="pagination-btn pagination-btn--arrow" type="button" data-page="${currentPage + 1}" aria-label="${app.i18n.t('pagination.next')}" ${currentPage === totalPages ? 'disabled' : ''}>&rsaquo;</button>
    `;

    container.querySelectorAll('[data-page]').forEach(button => {
      button.addEventListener('click', () => {
        if(button.disabled) return;
        onChange(Number(button.dataset.page));
      });
    });
  }

  function renderCatalog(state){
    const grid = app.dom.byId('productsGrid');
    if(!grid) return;
    const list = getFilteredProducts(state);
    const count = app.dom.byId('catalogCount');
    if(count) count.textContent = app.i18n.t('catalog.count', {shown:list.length, total:state.products.length});
    if(!list.length){
      grid.innerHTML = `<div class="empty-state">${app.i18n.t('catalog.empty')}</div>`;
      renderPagination('catalogPagination', 0, 1, state.pagination.catalogPageSize, () => {});
      return;
    }
    const totalPages = Math.ceil(list.length / state.pagination.catalogPageSize);
    state.pagination.catalogPage = Math.min(Math.max(state.pagination.catalogPage, 1), totalPages);
    const start = (state.pagination.catalogPage - 1) * state.pagination.catalogPageSize;
    const visibleProducts = list.slice(start, start + state.pagination.catalogPageSize);
    grid.innerHTML = '';
    visibleProducts.forEach(product => grid.appendChild(renderProductCard(product)));
    renderPagination(
      'catalogPagination',
      list.length,
      state.pagination.catalogPage,
      state.pagination.catalogPageSize,
      page => {
        state.pagination.catalogPage = page;
        renderCatalog(state);
        app.dom.byId('catalog')?.scrollIntoView({behavior:'smooth', block:'start'});
      }
    );
  }

  function initCatalogPage(state){
    fillCatalogFilters(state);
    bindCatalogFilters(state);
    bindProductModalEvents();
    renderCatalog(state);
    app.favorites.renderStrips();
    // Рейтинги подгружаются асинхронно — после загрузки перерисовываем карточки.
    if(app.reviews && !app.reviews.isLoaded()){
      app.reviews.load().then(() => {
        renderCatalog(state);
        app.favorites.renderStrips();
      });
    }
  }

  function generateVolumeOptions(product, productId){
    const entries = Object.entries(product.volumes || {});
    if(!entries.length) return `<div class="empty-state empty-state--compact">${app.i18n.t('product.noVolumes')}</div>`;
    return entries.map(([volume, price]) => {
      const selected = app.state.selectedOptions[productId]?.volume === volume;
      return `
        <button class="volume-option ${selected ? 'selected' : ''}" type="button" data-product-id="${productId}" data-option-type="volume" data-option-value="${app.dom.escapeHtml(volume)}">
          ${app.dom.escapeHtml(volume)}мл <span class="volume-price">${app.dom.rub(price)}₸</span>
        </button>
      `;
    }).join('');
  }

  function getCurrentPrice(productId){
    const product = app.state.products.find(item => item.id === productId);
    const option = app.state.selectedOptions[productId];
    const volume = option?.volume || Object.keys(product?.volumes || {})[0];
    return product?.volumes?.[volume] || 0;
  }

  function selectOptionInModal(productId, value){
    if(!app.state.selectedOptions[productId]) app.state.selectedOptions[productId] = {};
    app.state.selectedOptions[productId].volume = value;
    const product = app.state.products.find(item => item.id === productId);
    const volumeEl = app.dom.byId(`volumeOptions-${productId}`);
    if(volumeEl) volumeEl.innerHTML = generateVolumeOptions(product, productId);
    const priceEl = app.dom.byId(`currentPrice-${productId}`);
    if(priceEl) priceEl.textContent = `${app.dom.rub(getCurrentPrice(productId))} ₸`;
  }

  function openProductModal(productId){
    const product = app.state.products.find(item => item.id === productId);
    const title = app.dom.byId('productModalTitle');
    const body = app.dom.byId('productModalBody');
    if(!product || !title || !body) return;
    if(!app.state.selectedOptions[productId]){
      app.state.selectedOptions[productId] = {volume:Object.keys(product.volumes || {})[0]};
    }
    title.textContent = `${product.brand} ${product.name}`;
    app.favorites.recordView(product.key);
    const categoryTag = product.category ? `<span class="tag">${app.dom.escapeHtml(product.category)}</span>` : '';
    const extraTags = ['season','gender','occasion']
      .map(field => product[field] ? `<span class="tag">${app.dom.escapeHtml(product[field])}</span>` : '')
      .join('');
    body.innerHTML = `
      <div class="detail-grid">
        <div class="detail-image">
          <img src="${app.dom.escapeHtml(product.image)}" alt="${app.dom.escapeHtml(product.name)}" data-img-fallback="${app.dom.escapeHtml(product.emoji)}">
        </div>
        <div>
          <div class="product-tags">
            <span class="tag${product.available ? '' : ' tag--danger'}">${app.i18n.t(product.available ? 'filters.available' : 'filters.unavailable')}</span>
            ${categoryTag}
            ${extraTags}
          </div>
          <div class="detail-title">${app.i18n.t('product.description')}</div>
          <div class="detail-content detail-content--spaced">${app.dom.escapeHtml(product.fullDescription || product.description)}</div>
          <div class="detail-title">${app.i18n.t('product.notes')}</div>
          <div class="detail-content detail-content--notes">
            <div><strong>${app.i18n.t('product.topNotes')}:</strong> ${app.dom.escapeHtml(product.notes.top)}</div>
            <div><strong>${app.i18n.t('product.heartNotes')}:</strong> ${app.dom.escapeHtml(product.notes.heart)}</div>
            <div><strong>${app.i18n.t('product.baseNotes')}:</strong> ${app.dom.escapeHtml(product.notes.base)}</div>
          </div>
          <div class="detail-title">${app.i18n.t('product.volume')}</div>
          <div class="volume-options" id="volumeOptions-${productId}">${generateVolumeOptions(product, productId)}</div>
          <div class="current-price" id="currentPrice-${productId}">${app.dom.rub(getCurrentPrice(productId))} ₸</div>
          <div class="detail-actions">
            <button class="add-to-cart" type="button" data-add-product-id="${productId}" ${product.available && getCurrentPrice(productId) ? '' : 'disabled'}>${app.i18n.t('cart.add')}</button>
            ${app.favorites.favButtonHtml(product, {wide:true})}
          </div>
        </div>
      </div>
      ${app.reviews ? app.reviews.sectionHtml(product) : ''}
      ${app.favorites.similarHtml(product)}
    `;
    app.i18n.applyTranslations(body);
    app.ui.openModal('productModal');
  }

  function closeProductModal(){
    app.ui.closeModal('productModal');
  }

  function populateHeroShelf(products){
    const shelf = app.dom.byId('heroShelf');
    if(!shelf) return;
    const items = products.filter(product => product.image).slice(0, 3);
    if(items.length < 3) return;
    shelf.innerHTML = items.map(product => `<img src="${app.dom.escapeHtml(product.image)}" alt="" data-img-fallback="hide">`).join('');
  }

  function renderLoadError(page, err){
    const message = `Ошибка загрузки каталога: ${app.dom.escapeHtml(err.message)}`;
    if(page === 'catalog' && app.dom.byId('productsGrid')) app.dom.byId('productsGrid').innerHTML = `<div class="empty-state">${message}</div>`;
    if(page === 'custom-set' && app.dom.byId('customSetGrid')) app.dom.byId('customSetGrid').innerHTML = `<div class="empty-state">${message}</div>`;
  }

  function fillSetFilters(state){
    const brands = getUniqueBrands(state.products);
    fillSelect(app.dom.byId('customSetBrandFilter'), brands, 'filters.allBrands');
    app.dom.byId('setBrandFilterField')?.classList.toggle('is-hidden', brands.length === 0);
    fillSelect(app.dom.byId('customSetVolume'), getUniqueVolumes(state.products), 'filters.allVolumes');
    const categories = getUniqueCategories(state.products);
    fillSelect(app.dom.byId('customSetCategoryFilter'), categories, 'filters.allCategories');
    app.dom.byId('setCategoryFilterField')?.classList.toggle('is-hidden', categories.length === 0);
    [
      ['season','customSetSeasonFilter','setSeasonFilterField','filters.allSeasons'],
      ['gender','customSetGenderFilter','setGenderFilterField','filters.allGenders'],
      ['occasion','customSetOccasionFilter','setOccasionFilterField','filters.allOccasions']
    ].forEach(([field, selectId, fieldId, allKey]) => {
      const values = getUniqueField(state.products, field);
      fillSelect(app.dom.byId(selectId), values, allKey);
      app.dom.byId(fieldId)?.classList.toggle('is-hidden', values.length === 0);
    });
  }

  function getSetProducts(state){
    const query = state.setFilters.search.trim().toLowerCase();
    return state.products.filter(product => {
      if(!product.available) return false;
      if(!productMatchesSearch(product, query)) return false;
      if(state.setFilters.brand && product.brand !== state.setFilters.brand) return false;
      if(state.setFilters.category && product.category !== state.setFilters.category) return false;
      if(state.setFilters.season && product.season !== state.setFilters.season) return false;
      if(state.setFilters.gender && product.gender !== state.setFilters.gender) return false;
      if(state.setFilters.occasion && product.occasion !== state.setFilters.occasion) return false;
      const volume = state.setFilters.volume || app.dom.byId('customSetVolume')?.value || '';
      if(volume && !product.volumes?.[volume]) return false;
      return true;
    });
  }

  function bindSetFilters(state){
    const bindings = [
      ['customSetSearch','search'],
      ['customSetBrandFilter','brand'],
      ['customSetCategoryFilter','category'],
      ['customSetSeasonFilter','season'],
      ['customSetGenderFilter','gender'],
      ['customSetOccasionFilter','occasion'],
      ['customSetVolume','volume']
    ];
    bindings.forEach(([id, key]) => {
      const el = app.dom.byId(id);
      if(!el || el.dataset.bound === 'true') return;
      el.dataset.bound = 'true';
      const handler = () => {
        state.setFilters[key] = el.value;
        state.pagination.setPage = 1;
        if(key === 'volume') syncSetCountToMin(el.value);
        renderSetGrid(state);
        calculateCustomSet(state);
      };
      el.addEventListener('input', handler);
      el.addEventListener('change', handler);
    });
    const count = app.dom.byId('customSetCount');
    if(count && count.dataset.bound !== 'true'){
      count.dataset.bound = 'true';
      count.addEventListener('input', () => calculateCustomSet(state));
    }
    const addButton = app.dom.byId('addCustomSetBtn');
    if(addButton && addButton.dataset.bound !== 'true'){
      addButton.dataset.bound = 'true';
      addButton.addEventListener('click', () => addCustomSetToCart(state));
    }
    const clearButton = app.dom.byId('clearCustomSetBtn');
    if(clearButton && clearButton.dataset.bound !== 'true'){
      clearButton.dataset.bound = 'true';
      clearButton.addEventListener('click', () => {
        state.customSetSelection = [];
        renderSetGrid(state);
        calculateCustomSet(state);
      });
    }
  }

  function renderSetGrid(state){
    const grid = app.dom.byId('customSetGrid');
    if(!grid) return;
    const list = getSetProducts(state);
    const countEl = app.dom.byId('setCatalogCount');
    if(countEl) countEl.textContent = app.i18n.t('catalog.count', {shown:list.length, total:state.products.length});
    if(!list.length){
      grid.innerHTML = `<div class="empty-state">${app.i18n.t('catalog.empty')}</div>`;
      renderPagination('setPagination', 0, 1, state.pagination.setPageSize, () => {});
      return;
    }
    const totalPages = Math.ceil(list.length / state.pagination.setPageSize);
    state.pagination.setPage = Math.min(Math.max(state.pagination.setPage, 1), totalPages);
    const start = (state.pagination.setPage - 1) * state.pagination.setPageSize;
    const visibleProducts = list.slice(start, start + state.pagination.setPageSize);
    grid.innerHTML = '';
    visibleProducts.forEach(product => {
      const selected = state.customSetSelection.includes(product.id);
      const item = document.createElement('article');
      item.className = `custom-item${selected ? ' selected' : ''}`;
      item.tabIndex = 0;
      item.setAttribute('role', 'button');
      item.setAttribute('aria-pressed', selected ? 'true' : 'false');
      item.addEventListener('click', () => toggleSetItem(state, product.id));
      item.addEventListener('keydown', event => {
        if(event.key === 'Enter' || event.key === ' '){
          event.preventDefault();
          toggleSetItem(state, product.id);
        }
      });
      item.innerHTML = `
        <div class="custom-item-image">
          <img src="${app.dom.escapeHtml(product.image)}" alt="${app.dom.escapeHtml(product.name)}" data-img-fallback="${app.dom.escapeHtml(product.emoji)}" data-img-fallback-class="custom-item-fallback">
        </div>
        <div class="custom-item-name">${app.dom.escapeHtml(product.name)}</div>
        <div class="custom-item-brand">${app.dom.escapeHtml(product.brand)}</div>
      `;
      grid.appendChild(item);
    });
    renderPagination(
      'setPagination',
      list.length,
      state.pagination.setPage,
      state.pagination.setPageSize,
      page => {
        state.pagination.setPage = page;
        renderSetGrid(state);
        app.dom.byId('customSetGrid')?.scrollIntoView({behavior:'smooth', block:'start'});
      }
    );
    renderSetSelected(state);
  }

  function toggleSetItem(state, productId){
    const index = state.customSetSelection.indexOf(productId);
    if(index > -1) state.customSetSelection.splice(index, 1);
    else state.customSetSelection.push(productId);
    renderSetGrid(state);
    calculateCustomSet(state);
  }

  function renderSetSelected(state){
    const selectedEl = app.dom.byId('customSetSelected');
    if(!selectedEl) return;
    const items = state.customSetSelection.map(id => state.products.find(product => product.id === id)).filter(Boolean);
    if(!items.length){
      selectedEl.innerHTML = `<div class="empty-state empty-state--compact">${app.i18n.t('sets.empty')}</div>`;
      return;
    }
    selectedEl.innerHTML = items.map(product => `
      <div class="selected-pill">
        <span>${app.dom.escapeHtml(product.name)}</span>
        <span>${app.dom.escapeHtml(product.brand)}</span>
      </div>
    `).join('');
  }

  // Для распива 2мл сет собирается минимум из 5 флаконов, для остальных объёмов — от 2.
  const MIN_SET_COUNT_BY_VOLUME = {'2':5};

  function getMinSetCount(volume){
    return MIN_SET_COUNT_BY_VOLUME[volume] || 2;
  }

  // Для объёмов с повышенным минимумом (например, 2 мл → 5 флаконов)
  // автоматически поднимаем количество до минимума, чтобы пользователя
  // не блокировало молча предзаполненное значение.
  function syncSetCountToMin(volume){
    const countInput = app.dom.byId('customSetCount');
    if(!countInput) return;
    const minCount = getMinSetCount(volume || app.dom.byId('customSetVolume')?.value || '');
    countInput.min = String(minCount);
    const current = parseInt(countInput.value, 10) || 0;
    if(current < minCount) countInput.value = String(minCount);
  }

  function calculateCustomSet(state){
    const priceEl = app.dom.byId('customSetPrice');
    const addBtn = app.dom.byId('addCustomSetBtn');
    if(!priceEl || !addBtn) return;
    renderSetSelected(state);
    const volume = app.dom.byId('customSetVolume')?.value || '';
    const minCount = getMinSetCount(volume);
    const countInput = app.dom.byId('customSetCount');
    if(countInput && countInput.min !== String(minCount)) countInput.min = String(minCount);
    const count = parseInt(countInput?.value, 10) || 0;
    if(!count || count < minCount){
      addBtn.disabled = true;
      priceEl.textContent = app.i18n.t('sets.countMin', {min:minCount});
      return;
    }
    if(!state.customSetSelection.length){
      addBtn.disabled = true;
      priceEl.textContent = app.i18n.t('sets.pickCount', {count});
      return;
    }
    if(state.customSetSelection.length > count){
      addBtn.disabled = true;
      priceEl.textContent = app.i18n.t('sets.tooMany', {selected:state.customSetSelection.length, count});
      return;
    }
    let total = 0;
    state.customSetSelection.forEach(id => {
      const product = state.products.find(item => item.id === id);
      total += product?.volumes?.[volume] || 0;
    });
    if(total <= 0){
      addBtn.disabled = true;
      priceEl.textContent = app.i18n.t('sets.noVolumePrice', {volume});
      return;
    }
    if(state.customSetSelection.length < count){
      total += (total / state.customSetSelection.length) * (count - state.customSetSelection.length);
    }
    priceEl.textContent = `${app.dom.rub(Math.round(total))} ₸`;
    addBtn.disabled = false;
  }

  function addCustomSetToCart(state){
    const addBtn = app.dom.byId('addCustomSetBtn');
    if(addBtn?.disabled || !state.customSetSelection.length) return;
    const volume = app.dom.byId('customSetVolume')?.value || '';
    const count = parseInt(app.dom.byId('customSetCount')?.value, 10) || 0;
    const selected = state.customSetSelection.map(id => state.products.find(product => product.id === id)).filter(Boolean);
    let total = selected.reduce((sum, product) => sum + (product.volumes?.[volume] || 0), 0);
    if(selected.length < count) total += (total / selected.length) * (count - selected.length);
    app.cart.addCustomSet({
      count,
      volume,
      names:selected.map(product => product.name),
      price:Math.round(total)
    });
    state.customSetSelection = [];
    renderSetGrid(state);
    calculateCustomSet(state);
    app.cart.openCart();
  }

  function initSetPage(state){
    fillSetFilters(state);
    const volume = app.dom.byId('customSetVolume');
    if(volume && !volume.value) volume.value = getUniqueVolumes(state.products)[0] || '';
    if(volume) state.setFilters.volume = volume.value;
    syncSetCountToMin(volume?.value);
    bindSetFilters(state);
    renderSetGrid(state);
    calculateCustomSet(state);
  }

  function bindProductModalEvents(){
    const body = app.dom.byId('productModalBody');
    if(!body || body.dataset.bound === 'true') return;
    body.dataset.bound = 'true';
    body.addEventListener('click', event => {
      const option = app.dom.closestFromEvent(event, '[data-option-type]');
      if(option){
        selectOptionInModal(parseInt(option.dataset.productId, 10), option.dataset.optionValue);
        return;
      }
      const addButton = app.dom.closestFromEvent(event, '[data-add-product-id]');
      if(addButton){
        app.cart.addProduct(parseInt(addButton.dataset.addProductId, 10));
        closeProductModal();
        return;
      }
      const similarButton = app.dom.closestFromEvent(event, '[data-open-product]');
      if(similarButton){
        openProductModal(parseInt(similarButton.dataset.openProduct, 10));
      }
    });
    app.dom.byId('closeProductModalBtn')?.addEventListener('click', closeProductModal);
  }

  function sanitizeVolumes(volumes){
    const result = {};
    ['2','5','10','15','20'].forEach(volume => {
      const value = toInt(volumes?.[volume]);
      if(value) result[volume] = value;
    });
    return result;
  }

  function toSheetProductPayload(product){
    return {
      brand:product.brand,
      name:product.name,
      description_short:product.description,
      description_full:product.fullDescription,
      notes_top:product.notes.top,
      notes_heart:product.notes.heart,
      notes_base:product.notes.base,
      season:product.season,
      longevity:product.longevity,
      sillage:product.sillage,
      price_2ml:product.volumes['2'] || '',
      price_5ml:product.volumes['5'] || '',
      price_10ml:product.volumes['10'] || '',
      price_15ml:product.volumes['15'] || '',
      price_20ml:product.volumes['20'] || '',
      image_url:product.imageUrl,
      gender:product.gender,
      occasion:product.occasion,
      stock_qty:product.stockQty == null ? '' : product.stockQty,
      category:product.category
    };
  }

  async function syncProductUpdate(productKey, values){
    const token = app.api.getAdminToken();
    if(!app.api.isConfigured() || !token) return {ok:false, skipped:true};
    const data = await app.api.post({
      action:'upsert_product',
      token,
      product_key:productKey,
      sheet_product:toSheetProductPayload(values)
    });
    if(!data.ok && !data.skipped) throw new Error(data.error || 'Не удалось сохранить товар в таблицу');
    return data;
  }

  async function saveProductUpdate(productKey, values){
    const overrides = getProductOverrides();
    const stockQty = values.stockQty == null || values.stockQty === '' || Number.isNaN(Number(values.stockQty))
      ? null
      : Number(values.stockQty);
    const next = {
      brand:String(values.brand || '').trim(),
      name:String(values.name || '').trim(),
      category:String(values.category || '').trim(),
      season:String(values.season || '').trim(),
      gender:String(values.gender || '').trim(),
      occasion:String(values.occasion || '').trim(),
      longevity:String(values.longevity || '').trim(),
      sillage:String(values.sillage || '').trim(),
      description:String(values.description || '').trim(),
      fullDescription:String(values.fullDescription || '').trim(),
      notes:{
        top:String(values.notes?.top || '').trim() || '—',
        heart:String(values.notes?.heart || '').trim() || '—',
        base:String(values.notes?.base || '').trim() || '—'
      },
      volumes:sanitizeVolumes(values.volumes),
      stockQty,
      imageUrl:String(values.imageUrl || '').trim(),
      updatedAt:new Date().toISOString()
    };
    overrides[productKey] = next;
    saveProductOverrides(overrides);
    const remote = await syncProductUpdate(productKey, next);
    return {ok:true, local:true, remote};
  }

  function clearProductOverride(productKey){
    const overrides = getProductOverrides();
    delete overrides[productKey];
    saveProductOverrides(overrides);
  }

  app.products = {
    loadProducts,
    initCatalogPage,
    initSetPage,
    renderProductCard,
    openProductModal,
    closeProductModal,
    selectOptionInModal,
    getCurrentPrice,
    populateHeroShelf,
    renderLoadError,
    getProductOverrides,
    saveProductUpdate,
    clearProductOverride
  };
})();
