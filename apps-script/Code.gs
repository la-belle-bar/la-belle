/**
 * La Belle — серверная часть на Google Apps Script.
 *
 * Единственная точка доступа сайта (GitHub Pages) к ПРИВАТНОЙ Google-таблице.
 * Скрипт выполняется от имени владельца таблицы, поэтому саму таблицу
 * никому расшаривать не нужно.
 *
 * ── Настройка ────────────────────────────────────────────────────────────────
 * Project Settings → Script Properties. Обязательные свойства:
 *
 *   SPREADSHEET_ID      ID таблицы (из её URL)
 *   CATALOG_SHEET_GID   gid листа каталога   (число из #gid=... в URL)
 *   ORDERS_SHEET_GID    gid листа заказов
 *   ADMIN_TOKEN         длинный случайный ключ для админки (32+ символов)
 *
 * Необязательные (для уведомлений в Telegram):
 *
 *   TELEGRAM_BOT_TOKEN  токен бота от @BotFather
 *   TELEGRAM_CHAT_ID    id чата/группы для уведомлений
 *
 * Деплой: Deploy → New deployment → Web app,
 *   Execute as: Me,  Who has access: Anyone.
 * После изменения кода: Deploy → Manage deployments → Edit → Version: New →
 * Deploy (URL при этом сохраняется).
 *
 * ── API ──────────────────────────────────────────────────────────────────────
 * GET  ?action=catalog                     — каталог (публично)
 * GET  ?action=verify&token=...            — проверка админ-ключа
 * GET  ?action=orders&token=...            — список заказов (только админ)
 * GET  ?action=test_telegram&token=...     — отправить тестовое сообщение в Telegram
 *                                            и вернуть ответ Telegram (диагностика)
 * POST {action:'submit_order', order, website}                — новый заказ
 * POST {action:'upsert_product', token, product_key, sheet_product}
 * POST {action:'update_order_status', token, order_id, status}
 */

var ORDER_HEADERS = [
  'timestamp','order_id','name','phone','email','city','street','house','flat',
  'comment','total','status','payment_method','payment_status','items_json','price_check',
  'subtotal','discount','promo_code','cert_codes','points_redeemed','loyalty_earned'
];

// Лист клиентов/лояльности (gid — в Script Properties CUSTOMER_SHEET_GID).
// Ключ — телефон (нормализованный). Баллы начисляются/списываются при оплате.
// Процент начисления — Script Property LOYALTY_EARN_PERCENT (по умолчанию 5).
var CUSTOMER_HEADERS = ['phone','name','points','total_spent','orders_count','first_order','last_order'];

// Лист промокодов/сертификатов (gid — в Script Properties PROMO_SHEET_GID).
// Колонки: code, type(percent|fixed|cert), value, min_order, active,
//          expires_at, usage_limit, used_count, note
var PROMO_HEADERS = ['code','type','value','min_order','active','expires_at','usage_limit','used_count','note'];

// Лист отзывов (gid — в Script Properties REVIEW_SHEET_GID).
// Отзыв публикуется на сайте только со статусом approved (модерация вручную).
var REVIEW_HEADERS = ['timestamp','review_id','product_key','name','rating','text','status'];

// Отдельный лимит на отправку отзывов (защита от заливки).
var REVIEW_RATE_LIMIT = 20;         // отзывов…
var REVIEW_RATE_WINDOW_SEC = 600;   // …за 10 минут

// Журнал изменений (gid — в Script Properties LOG_SHEET_GID). Пишется при
// каждом изменении из админки: кто (роль), что, над чем, детали.
var LOG_HEADERS = ['timestamp','actor_role','action','target','details'];

var ORDER_STATUSES = ['new','awaiting_payment','paid','processing','completed','cancelled'];

// Глобальный лимит приёма заказов (IP в Apps Script недоступен,
// поэтому ограничиваем общий поток — от заливки таблицы мусором).
var ORDER_RATE_LIMIT = 30;        // заказов…
var ORDER_RATE_WINDOW_SEC = 600;  // …за 10 минут

function doGet(e){
  var params = (e && e.parameter) || {};
  var action = params.action || 'catalog';
  try{
    if(action === 'catalog') return json_({ok:true, rows:readRows_('catalog')});
    if(action === 'validate_promo') return json_(evaluatePromo_(params.code, num_(params.subtotal, 0, 100000000)));
    if(action === 'reviews') return json_({ok:true, rows:readApprovedReviews_(params.product_key || '')});
    if(action === 'loyalty_balance') return json_(loyaltyBalanceResponse_(params.phone));
    if(action === 'account') return json_(handleAccount_(params.token));
    if(action === 'verify'){
      var role = requireAdmin_(params.token);
      return json_({ok:true, role:role});
    }
    if(action === 'orders'){
      requireAdmin_(params.token);
      return json_({ok:true, rows:readRows_('orders')});
    }
    if(action === 'reviews_admin'){
      requireAdmin_(params.token);
      return json_({ok:true, rows:readAllReviews_()});
    }
    if(action === 'customers_admin'){
      requireAdmin_(params.token);
      return json_({ok:true, rows:readCustomersAdmin_()});
    }
    if(action === 'log'){
      requireRole_(params.token, 'owner');
      return json_({ok:true, rows:readLog_()});
    }
    if(action === 'settings'){
      requireRole_(params.token, 'owner');
      return json_({ok:true, earn_percent:loyaltyEarnPercent_()});
    }
    if(action === 'test_telegram'){
      requireAdmin_(params.token);
      return json_(sendTelegram_('Тест уведомлений La Belle: если вы видите это сообщение — всё настроено верно.'));
    }
    return json_({ok:false, error:'unknown_action'});
  }catch(err){
    return json_({ok:false, error:String(err && err.message || err)});
  }
}

function doPost(e){
  var body;
  try{
    body = JSON.parse(e.postData.contents);
  }catch(err){
    return json_({ok:false, error:'bad_json'});
  }
  var action = body.action || '';
  try{
    if(action === 'submit_order') return json_(handleSubmitOrder_(body));
    if(action === 'account_login') return json_(handleAccountLogin_(body));
    if(action === 'submit_review') return json_(handleSubmitReview_(body));
    if(action === 'moderate_review'){
      var modRole = requireAdmin_(body.token);
      return json_(handleModerateReview_(body, modRole));
    }
    if(action === 'upsert_product'){
      var upsertRole = requireAdmin_(body.token);
      return json_(handleUpsertProduct_(body, upsertRole));
    }
    if(action === 'update_order_status'){
      var statusRole = requireAdmin_(body.token);
      return json_(handleUpdateOrderStatus_(body, statusRole));
    }
    if(action === 'update_settings'){
      var settingsRole = requireRole_(body.token, 'owner');
      return json_(handleUpdateSettings_(body, settingsRole));
    }
    return json_({ok:false, error:'unknown_action'});
  }catch(err){
    return json_({ok:false, error:String(err && err.message || err)});
  }
}

/* ── Заказы ─────────────────────────────────────────────────────────────── */

function handleSubmitOrder_(body){
  // Honeypot: боты заполняют скрытое поле — делаем вид, что всё прошло.
  if(String(body.website || '').trim()) return {ok:true};

  if(!checkOrderRate_()) return {ok:false, error:'rate_limited'};

  var raw = body.order || {};
  var phone = str_(raw.phone, 32);
  if(!phone) return {ok:false, error:'phone_required'};

  var items = sanitizeItems_(raw.items);
  if(!items.length) return {ok:false, error:'empty_order'};

  // Сумму и скидку считаем на сервере — присланным клиентом значениям не доверяем.
  var subtotal = items.reduce(function(sum, item){ return sum + item.total; }, 0);
  // Промокод не распространяется на подарочные сертификаты (это эквивалент денег).
  var promoBase = items.reduce(function(sum, item){
    return sum + (normalizeIdentity_(item.type) === 'certificate' ? 0 : item.total);
  }, 0);
  var promo = null;
  if(String(raw.promo_code || '').trim()){
    var evaluated = evaluatePromo_(raw.promo_code, promoBase);
    if(evaluated.ok) promo = evaluated;
  }
  var discount = promo ? promo.discount : 0;
  var afterPromo = Math.max(0, subtotal - discount);

  // Списание бонусов: сверяем запрошенные баллы с реальным балансом по телефону.
  // Баллы не списываем здесь — только фиксируем сумму; списание при оплате.
  var redeemReq = num_(raw.redeem_points, 0, 100000000);
  var pointsRedeemed = 0;
  if(redeemReq > 0){
    var balance = loyaltyBalance_(phone);
    pointsRedeemed = Math.max(0, Math.min(redeemReq, balance, afterPromo));
  }
  var total = Math.max(0, afterPromo - pointsRedeemed);

  var status = ORDER_STATUSES.indexOf(String(raw.status)) > -1 ? String(raw.status) : 'new';
  var order = {
    timestamp: parseDate_(raw.timestamp),
    order_id: str_(raw.order_id, 40) || ('LB-' + new Date().getTime()),
    name: str_(raw.name, 120),
    phone: phone,
    email: validEmail_(raw.email) ? str_(raw.email, 120) : '',
    city: str_(raw.city, 120),
    street: str_(raw.street, 200),
    house: str_(raw.house, 40),
    flat: str_(raw.flat, 40),
    comment: str_(raw.comment, 600),
    subtotal: subtotal,
    discount: discount,
    promo_code: promo ? promo.code : '',
    points_redeemed: pointsRedeemed,
    loyalty_earned: '',
    total: total,
    status: status,
    payment_method: str_(raw.payment_method, 40) || 'cash',
    payment_status: str_(raw.payment_status, 40) || 'pending',
    items_json: JSON.stringify(items),
    price_check: checkPrices_(items)
  };

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try{
    appendRowByHeaders_(getSheet_('orders'), order, ORDER_HEADERS);
    if(promo) consumePromo_(promo);
  }finally{
    lock.releaseLock();
  }

  var telegram = notifyTelegram_(order, items);
  return {ok:true, telegram:telegram.ok, telegram_error:telegram.error || '', price_check:order.price_check};
}

function handleUpdateOrderStatus_(body, role){
  var orderId = str_(body.order_id, 60);
  var status = String(body.status || '');
  if(!orderId) return {ok:false, error:'order_id_required'};
  if(ORDER_STATUSES.indexOf(status) === -1) return {ok:false, error:'bad_status'};

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try{
    var sheet = getSheet_('orders');
    var values = sheet.getDataRange().getValues();
    if(values.length < 2) return {ok:false, error:'order_not_found'};
    var headers = values[0].map(normalizeHeader_);
    var idCol = headers.indexOf('order_id');
    var statusCol = headers.indexOf('status');
    var paymentStatusCol = headers.indexOf('payment_status');
    var itemsCol = headers.indexOf('items_json');
    var certCol = headers.indexOf('cert_codes');
    if(idCol === -1 || statusCol === -1) return {ok:false, error:'missing_columns'};
    for(var i = 1; i < values.length; i++){
      if(String(values[i][idCol]).trim() === orderId){
        sheet.getRange(i + 1, statusCol + 1).setValue(status);
        if(status === 'paid' && paymentStatusCol !== -1){
          sheet.getRange(i + 1, paymentStatusCol + 1).setValue('paid');
        }
        logChange_(role, 'order_status', orderId, status);
        // Сертификаты выдаём только при оплате и только один раз (идемпотентно).
        var certs = [];
        if(status === 'paid' && itemsCol !== -1 && certCol !== -1 && !String(values[i][certCol]).trim()){
          certs = issueCertificatesForOrder_(values[i][itemsCol], orderId);
          if(certs.length){
            sheet.getRange(i + 1, certCol + 1).setValue(certs.join(', '));
            logChange_(role, 'cert_issue', orderId, certs.join(', '));
          }
        }
        // Лояльность: начисляем/списываем при оплате, возвращаем при отмене.
        if(status === 'paid') processLoyaltyOnPaid_(sheet, headers, values[i], i);
        else if(status === 'cancelled') processLoyaltyOnCancel_(sheet, headers, values[i], i);
        return {ok:true, certs:certs};
      }
    }
    return {ok:false, error:'order_not_found'};
  }finally{
    lock.releaseLock();
  }
}

/* ── Товары ─────────────────────────────────────────────────────────────── */

function handleUpsertProduct_(body, role){
  var productKey = String(body.product_key || '');
  var product = body.sheet_product || {};
  if(!productKey) return {ok:false, error:'product_key_required'};

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try{
    var sheet = getSheet_('catalog');
    var values = sheet.getDataRange().getValues();
    if(!values.length) return {ok:false, error:'catalog_empty'};
    var headers = values[0].map(normalizeHeader_);
    var rowIndex = findProductRow_(values, headers, productKey);

    if(rowIndex === -1){
      appendRowByHeaders_(sheet, product, null);
      logChange_(role, 'product_create', productKey, product.name || '');
      return {ok:true, created:true};
    }

    for(var key in product){
      if(!Object.prototype.hasOwnProperty.call(product, key)) continue;
      var col = headers.indexOf(normalizeHeader_(key));
      if(col === -1) continue;
      sheet.getRange(rowIndex + 1, col + 1).setValue(product[key]);
    }
    logChange_(role, 'product_update', productKey, product.name || '');
    return {ok:true, updated:true};
  }finally{
    lock.releaseLock();
  }
}

// product_key повторяет логику фронтенда:
// 'sku:<значение>' или 'name:<бренд>|<название>' (в нижнем регистре).
function findProductRow_(values, headers, productKey){
  var skuColumns = ['product_id','sku','id','артикул'];
  if(productKey.indexOf('sku:') === 0){
    var sku = productKey.slice(4);
    for(var c = 0; c < skuColumns.length; c++){
      var col = headers.indexOf(skuColumns[c]);
      if(col === -1) continue;
      for(var i = 1; i < values.length; i++){
        if(normalizeIdentity_(values[i][col]) === sku) return i;
      }
    }
    return -1;
  }
  if(productKey.indexOf('name:') === 0){
    var parts = productKey.slice(5).split('|');
    var brand = parts[0] || '';
    var name = parts[1] || '';
    var brandCol = headers.indexOf('brand');
    var nameCol = headers.indexOf('name');
    if(brandCol === -1 || nameCol === -1) return -1;
    for(var j = 1; j < values.length; j++){
      if(normalizeIdentity_(values[j][brandCol]) === brand &&
         normalizeIdentity_(values[j][nameCol]) === name) return j;
    }
  }
  return -1;
}

/* ── Проверка цен ───────────────────────────────────────────────────────── */

// Клиент присылает цены из браузера, доверять им нельзя. Сверяем каждую
// позицию с каталогом и пишем результат в колонку price_check —
// админ сразу видит заказы с подменёнными ценами.
function checkPrices_(items){
  var rows;
  try{
    rows = readRows_('catalog');
  }catch(err){
    return 'unchecked';
  }
  var priceColumns = {
    '2':'price_2ml', '5':'price_5ml', '10':'price_10ml', '15':'price_15ml', '20':'price_20ml'
  };
  var catalog = {};
  rows.forEach(function(row){
    var key = normalizeIdentity_(row.brand) + '|' + normalizeIdentity_(row.name);
    catalog[key] = row;
  });

  var problems = [];
  var unknown = 0;
  items.forEach(function(item){
    var row = catalog[normalizeIdentity_(item.brand) + '|' + normalizeIdentity_(item.name)];
    if(!row){ unknown++; return; }
    var volumeMatch = String(item.description || '').match(/(\d+)\s*мл/i);
    if(!volumeMatch || !priceColumns[volumeMatch[1]]){ unknown++; return; }
    var expected = toInt_(row[priceColumns[volumeMatch[1]]]);
    if(!expected){ unknown++; return; }
    if(expected !== Number(item.price)){
      problems.push(item.name + ': ' + item.price + ' вместо ' + expected);
    }
  });

  if(problems.length) return 'MISMATCH! ' + problems.join('; ');
  return unknown ? 'ok (' + unknown + ' не проверено)' : 'ok';
}

/* ── Промокоды и сертификаты ────────────────────────────────────────────── */

function getPromoSheet_(){
  var ss = getSpreadsheet_();
  var gid = prop_('PROMO_SHEET_GID');
  if(!gid) throw new Error('PROMO_SHEET_GID is not set in Script Properties');
  var sheets = ss.getSheets();
  for(var i = 0; i < sheets.length; i++){
    if(String(sheets[i].getSheetId()) === String(gid)) return sheets[i];
  }
  throw new Error('promo sheet not found by gid ' + gid);
}

function promoActive_(value){
  // Пусто = активен. Явные «нет/0/false/no/off» — выключено.
  var raw = normalizeIdentity_(value);
  if(raw === '') return true;
  return ['false','0','no','нет','off','неактивен','disabled'].indexOf(raw) === -1;
}

// Оценивает промокод для конкретной суммы БЕЗ списания использования.
// Возвращает {ok, code, type, value, min_order, discount, subtotal, total, message}
// или {ok:false, error, message}. rowIndex — только для внутреннего consume.
function evaluatePromo_(codeRaw, subtotal){
  var code = normalizeIdentity_(codeRaw);
  if(!code) return {ok:false, error:'empty', message:'Введите промокод'};
  var sheet;
  try{ sheet = getPromoSheet_(); }
  catch(err){ return {ok:false, error:'promo_not_configured', message:'Промокоды не настроены'}; }

  var values = sheet.getDataRange().getValues();
  if(values.length < 2) return {ok:false, error:'not_found', message:'Промокод не найден'};
  var headers = values[0].map(normalizeHeader_);
  var col = {};
  PROMO_HEADERS.forEach(function(name){ col[name] = headers.indexOf(name); });
  if(col.code === -1) return {ok:false, error:'bad_sheet', message:'Промокоды не настроены'};

  for(var i = 1; i < values.length; i++){
    if(normalizeIdentity_(values[i][col.code]) !== code) continue;
    var row = values[i];
    var get = function(name){ return col[name] === -1 ? '' : row[col[name]]; };

    if(!promoActive_(get('active'))) return {ok:false, error:'inactive', message:'Промокод неактивен'};

    var expires = String(get('expires_at') || '').trim();
    if(expires){
      var exp = new Date(expires);
      if(!isNaN(exp.getTime()) && exp.getTime() < new Date().getTime()){
        return {ok:false, error:'expired', message:'Срок действия промокода истёк'};
      }
    }

    var usageLimit = toInt_(get('usage_limit'));
    var usedCount = toInt_(get('used_count'));
    if(usageLimit && usedCount >= usageLimit) return {ok:false, error:'used_up', message:'Промокод уже использован'};

    var minOrder = toInt_(get('min_order'));
    if(minOrder && subtotal < minOrder){
      return {ok:false, error:'min_order', min_order:minOrder, message:'Минимальная сумма заказа — ' + minOrder + ' ₸'};
    }

    var type = normalizeIdentity_(get('type')) || 'fixed';
    var value = num_(get('value'), 0, 100000000);
    var discount = type === 'percent' ? Math.round(subtotal * value / 100) : value;
    discount = Math.max(0, Math.min(discount, subtotal));

    return {
      ok:true,
      code:String(get('code')).trim().toUpperCase(),
      type:type,
      value:value,
      min_order:minOrder,
      discount:discount,
      subtotal:subtotal,
      total:subtotal - discount,
      rowIndex:i,
      usedCol:col.used_count,
      usedCount:usedCount,
      message:'Промокод применён'
    };
  }
  return {ok:false, error:'not_found', message:'Промокод не найден'};
}

// Генерирует коды-сертификаты по позициям заказа типа 'certificate' и пишет их
// в лист promocodes (type=cert, одноразовые). Best-effort: если лист не настроен,
// возвращает пустой список — заказ от этого не страдает.
function issueCertificatesForOrder_(itemsJson, orderId){
  var items;
  try{ items = JSON.parse(itemsJson || '[]'); }
  catch(err){ return []; }
  if(!Array.isArray(items)) return [];

  var sheet;
  try{ sheet = getPromoSheet_(); }
  catch(err){ return []; }

  var codes = [];
  items.forEach(function(item){
    if(!item || normalizeIdentity_(item.type) !== 'certificate') return;
    var amount = num_(item.price, 0, 100000000);
    if(!amount) return;
    var qty = Math.max(1, Math.min(20, Math.round(Number(item.quantity) || 1)));
    for(var n = 0; n < qty; n++){
      var code = genCertCode_();
      appendRowByHeaders_(sheet, {
        code:code,
        type:'cert',
        value:amount,
        min_order:'',
        active:'TRUE',
        expires_at:'',
        usage_limit:1,
        used_count:0,
        note:'заказ ' + orderId
      }, PROMO_HEADERS);
      codes.push(code);
    }
  });
  return codes;
}

function genCertCode_(){
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  var out = '';
  for(var i = 0; i < 8; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return 'GIFT-' + out;
}

// Списывает одно использование. Вызывать под тем же локом, что и запись заказа.
function consumePromo_(evaluated){
  if(!evaluated || !evaluated.ok || evaluated.usedCol === -1 || evaluated.usedCol == null) return;
  try{
    var sheet = getPromoSheet_();
    sheet.getRange(evaluated.rowIndex + 1, evaluated.usedCol + 1).setValue(evaluated.usedCount + 1);
  }catch(err){ /* best-effort: заказ важнее счётчика */ }
}

/* ── Отзывы и рейтинги ──────────────────────────────────────────────────── */

function getReviewSheet_(){
  var ss = getSpreadsheet_();
  var gid = prop_('REVIEW_SHEET_GID');
  if(!gid) throw new Error('REVIEW_SHEET_GID is not set in Script Properties');
  var sheets = ss.getSheets();
  for(var i = 0; i < sheets.length; i++){
    if(String(sheets[i].getSheetId()) === String(gid)) return sheets[i];
  }
  throw new Error('reviews sheet not found by gid ' + gid);
}

function reviewApproved_(value){
  var raw = normalizeIdentity_(value);
  return ['approved','ok','да','yes','1','true','одобрен','опубликован'].indexOf(raw) > -1;
}

// Публично отдаём только одобренные отзывы. Если лист не настроен — пустой список,
// чтобы сайт работал и без отзывов.
function readApprovedReviews_(productKey){
  var rows;
  try{ rows = readRowsFromSheet_(getReviewSheet_()); }
  catch(err){ return []; }
  var wantKey = normalizeIdentity_(productKey);
  return rows.filter(function(row){
    if(!reviewApproved_(row.status)) return false;
    if(wantKey && normalizeIdentity_(row.product_key) !== wantKey) return false;
    return true;
  }).map(function(row){
    return {
      product_key:row.product_key || '',
      name:row.name || '',
      rating:toInt_(row.rating) || 0,
      text:row.text || '',
      timestamp:row.timestamp || ''
    };
  });
}

function handleSubmitReview_(body){
  // Honeypot: боты заполняют скрытое поле — делаем вид, что всё прошло.
  if(String(body.website || '').trim()) return {ok:true, status:'pending'};
  if(!checkReviewRate_()) return {ok:false, error:'rate_limited'};

  var productKey = str_(body.product_key, 120);
  if(!productKey) return {ok:false, error:'product_key_required'};
  var text = str_(body.text, 1000);
  if(!text) return {ok:false, error:'text_required'};
  var rating = num_(body.rating, 1, 5);

  var review = {
    timestamp: new Date(),
    review_id: 'RV-' + new Date().getTime(),
    product_key: productKey,
    name: str_(body.name, 80) || 'Аноним',
    rating: rating,
    text: text,
    status: 'pending'
  };

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try{
    appendRowByHeaders_(getReviewSheet_(), review, REVIEW_HEADERS);
  }finally{
    lock.releaseLock();
  }
  return {ok:true, status:'pending'};
}

function checkReviewRate_(){
  var cache = CacheService.getScriptCache();
  var count = Number(cache.get('review_rate') || 0);
  if(count >= REVIEW_RATE_LIMIT) return false;
  cache.put('review_rate', String(count + 1), REVIEW_RATE_WINDOW_SEC);
  return true;
}

// Все отзывы (включая pending) — только для админки (модерация).
function readAllReviews_(){
  var rows;
  try{ rows = readRowsFromSheet_(getReviewSheet_()); }
  catch(err){ return []; }
  return rows.map(function(row){
    return {
      review_id:row.review_id || '',
      product_key:row.product_key || '',
      name:row.name || '',
      rating:toInt_(row.rating) || 0,
      text:row.text || '',
      status:normalizeIdentity_(row.status) || 'pending',
      timestamp:row.timestamp || ''
    };
  }).reverse();
}

var REVIEW_STATUSES = ['pending','approved','rejected'];

function handleModerateReview_(body, role){
  var reviewId = str_(body.review_id, 60);
  var status = normalizeIdentity_(body.status);
  if(!reviewId) return {ok:false, error:'review_id_required'};
  if(REVIEW_STATUSES.indexOf(status) === -1) return {ok:false, error:'bad_status'};

  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try{
    var sheet = getReviewSheet_();
    var values = sheet.getDataRange().getValues();
    if(values.length < 2) return {ok:false, error:'review_not_found'};
    var headers = values[0].map(normalizeHeader_);
    var idCol = headers.indexOf('review_id');
    var statusCol = headers.indexOf('status');
    if(idCol === -1 || statusCol === -1) return {ok:false, error:'missing_columns'};
    for(var i = 1; i < values.length; i++){
      if(String(values[i][idCol]).trim() === reviewId){
        sheet.getRange(i + 1, statusCol + 1).setValue(status);
        logChange_(role, 'review_' + status, reviewId, '');
        return {ok:true};
      }
    }
    return {ok:false, error:'review_not_found'};
  }finally{
    lock.releaseLock();
  }
}

/* ── Журнал изменений ───────────────────────────────────────────────────── */

function getLogSheet_(){
  var ss = getSpreadsheet_();
  var gid = prop_('LOG_SHEET_GID');
  if(!gid) throw new Error('LOG_SHEET_GID is not set in Script Properties');
  var sheets = ss.getSheets();
  for(var i = 0; i < sheets.length; i++){
    if(String(sheets[i].getSheetId()) === String(gid)) return sheets[i];
  }
  throw new Error('log sheet not found by gid ' + gid);
}

// Best-effort: если лист журнала не настроен, изменение всё равно проходит.
function logChange_(role, action, target, details){
  try{
    appendRowByHeaders_(getLogSheet_(), {
      timestamp:new Date(),
      actor_role:role || '',
      action:action || '',
      target:target || '',
      details:details || ''
    }, LOG_HEADERS);
  }catch(err){ /* журнал не критичен для операции */ }
}

function readLog_(){
  var rows;
  try{ rows = readRowsFromSheet_(getLogSheet_()); }
  catch(err){ return []; }
  return rows.slice(-200).reverse();
}

/* ── Лояльность (баллы по телефону) ─────────────────────────────────────── */

function getCustomerSheet_(){
  var ss = getSpreadsheet_();
  var gid = prop_('CUSTOMER_SHEET_GID');
  if(!gid) throw new Error('CUSTOMER_SHEET_GID is not set in Script Properties');
  var sheets = ss.getSheets();
  for(var i = 0; i < sheets.length; i++){
    if(String(sheets[i].getSheetId()) === String(gid)) return sheets[i];
  }
  throw new Error('customers sheet not found by gid ' + gid);
}

// Ключ клиента — только цифры телефона (устойчиво к +, пробелам, скобкам).
function normalizePhone_(phone){
  return String(phone == null ? '' : phone).replace(/\D/g, '');
}

function loyaltyEarnPercent_(){
  var pct = Number(prop_('LOYALTY_EARN_PERCENT'));
  return isFinite(pct) && pct >= 0 && pct <= 100 ? pct : 5;
}

// Настройки из админки (owner): пока только процент кэшбэка. Хранится в
// Script Properties — переживает передеплой, в браузер сам ключ не попадает.
function handleUpdateSettings_(body, role){
  if(body.earn_percent != null){
    var pct = Number(body.earn_percent);
    if(!isFinite(pct) || pct < 0 || pct > 100) return {ok:false, error:'bad_earn_percent'};
    setProp_('LOYALTY_EARN_PERCENT', String(Math.round(pct * 100) / 100));
    logChange_(role, 'settings', 'earn_percent', String(pct));
  }
  return {ok:true, earn_percent:loyaltyEarnPercent_()};
}

function setProp_(key, value){
  PropertiesService.getScriptProperties().setProperty(key, String(value));
}

// Баланс баллов по телефону (0, если клиента нет или лист не настроен).
function loyaltyBalance_(phone){
  var key = normalizePhone_(phone);
  if(!key) return 0;
  var rows;
  try{ rows = readRowsFromSheet_(getCustomerSheet_()); }
  catch(err){ return 0; }
  for(var i = 0; i < rows.length; i++){
    if(normalizePhone_(rows[i].phone) === key) return toInt_(rows[i].points);
  }
  return 0;
}

// Список клиентов для админки (только по админ-ключу — это PII).
function readCustomersAdmin_(){
  var rows;
  try{ rows = readRowsFromSheet_(getCustomerSheet_()); }
  catch(err){ return []; }
  return rows.map(function(row){
    return {
      phone:row.phone || '',
      name:row.name || '',
      points:toInt_(row.points),
      total_spent:toInt_(row.total_spent),
      orders_count:toInt_(row.orders_count),
      last_order:row.last_order || ''
    };
  }).sort(function(a, b){ return b.total_spent - a.total_spent; });
}

// Публичный ответ на проверку баланса: отдаём только число баллов + лимит.
function loyaltyBalanceResponse_(phone){
  if(!normalizePhone_(phone)) return {ok:false, error:'phone_required', points:0};
  if(!checkLoyaltyRate_()) return {ok:false, error:'rate_limited', points:0};
  return {ok:true, points:loyaltyBalance_(phone), earn_percent:loyaltyEarnPercent_()};
}

function checkLoyaltyRate_(){
  var cache = CacheService.getScriptCache();
  var count = Number(cache.get('loyalty_rate') || 0);
  if(count >= 60) return false;               // 60 проверок…
  cache.put('loyalty_rate', String(count + 1), 600);  // …за 10 минут
  return true;
}

// Начисление/списание баллов при оплате. Идемпотентно: если loyalty_earned уже
// заполнена — ничего не делаем. Меняет баланс на (начислено − списано).
function processLoyaltyOnPaid_(sheet, headers, row, rowIndex){
  var earnedCol = headers.indexOf('loyalty_earned');
  var phoneCol = headers.indexOf('phone');
  if(earnedCol === -1 || phoneCol === -1) return;
  if(String(row[earnedCol]).trim() !== '') return; // уже обработан

  var phone = normalizePhone_(row[phoneCol]);
  if(!phone) return;

  var totalCol = headers.indexOf('total');
  var nameCol = headers.indexOf('name');
  var redeemedCol = headers.indexOf('points_redeemed');
  var total = totalCol === -1 ? 0 : toInt_(row[totalCol]);
  var name = nameCol === -1 ? '' : String(row[nameCol] || '');
  var redeemed = redeemedCol === -1 ? 0 : toInt_(row[redeemedCol]);
  var earned = Math.round(total * loyaltyEarnPercent_() / 100);

  var applied = upsertCustomer_(phone, name, earned - redeemed, total);
  // Отмечаем обработку (даже если 0 — чтобы не начислить повторно).
  sheet.getRange(rowIndex + 1, earnedCol + 1).setValue(applied ? earned : 0);
}

// Применяет знаковые дельты к клиенту (все счётчики не уходят в минус).
// createIfMissing=false — для реверса: несуществующего клиента не создаём.
function adjustCustomer_(phone, name, deltaPoints, deltaSpent, deltaOrders, createIfMissing){
  var key = normalizePhone_(phone);
  if(!key) return false;
  var sheet;
  try{ sheet = getCustomerSheet_(); }
  catch(err){ return false; }

  var values = sheet.getDataRange().getValues();
  var headers = values.length ? values[0].map(normalizeHeader_) : [];
  var col = {};
  CUSTOMER_HEADERS.forEach(function(h){ col[h] = headers.indexOf(h); });
  var nowIso = new Date().toISOString();

  for(var i = 1; i < values.length; i++){
    if(col.phone !== -1 && normalizePhone_(values[i][col.phone]) === key){
      if(col.points !== -1) sheet.getRange(i + 1, col.points + 1).setValue(Math.max(0, toInt_(values[i][col.points]) + deltaPoints));
      if(col.total_spent !== -1) sheet.getRange(i + 1, col.total_spent + 1).setValue(Math.max(0, toInt_(values[i][col.total_spent]) + deltaSpent));
      if(col.orders_count !== -1) sheet.getRange(i + 1, col.orders_count + 1).setValue(Math.max(0, toInt_(values[i][col.orders_count]) + deltaOrders));
      if(col.last_order !== -1) sheet.getRange(i + 1, col.last_order + 1).setValue(nowIso);
      if(col.name !== -1 && name && !String(values[i][col.name]).trim()) sheet.getRange(i + 1, col.name + 1).setValue(name);
      return true;
    }
  }
  if(!createIfMissing) return false;
  appendRowByHeaders_(sheet, {
    phone:key,
    name:name || '',
    points:Math.max(0, deltaPoints),
    total_spent:Math.max(0, deltaSpent),
    orders_count:Math.max(0, deltaOrders),
    first_order:nowIso,
    last_order:nowIso
  }, CUSTOMER_HEADERS);
  return true;
}

// Начисление/списание при оплате (создаёт клиента при необходимости).
function upsertCustomer_(phone, name, deltaPoints, addSpent){
  return adjustCustomer_(phone, name, deltaPoints, toInt_(addSpent), 1, true);
}

// Возврат баллов и откат счётчиков при отмене оплаченного заказа. Идемпотентно:
// после возврата ставим в loyalty_earned пометку 'reversed'.
function processLoyaltyOnCancel_(sheet, headers, row, rowIndex){
  var earnedCol = headers.indexOf('loyalty_earned');
  var phoneCol = headers.indexOf('phone');
  if(earnedCol === -1 || phoneCol === -1) return;
  var marker = String(row[earnedCol]).trim();
  if(marker === '' || marker === 'reversed') return; // не начисляли или уже вернули

  var phone = normalizePhone_(row[phoneCol]);
  if(!phone) return;

  var totalCol = headers.indexOf('total');
  var redeemedCol = headers.indexOf('points_redeemed');
  var total = totalCol === -1 ? 0 : toInt_(row[totalCol]);
  var redeemed = redeemedCol === -1 ? 0 : toInt_(row[redeemedCol]);
  var earned = toInt_(marker);

  // Откатываем: возвращаем списанные баллы, снимаем начисленные, минус заказ.
  adjustCustomer_(phone, '', redeemed - earned, -total, -1, false);
  sheet.getRange(rowIndex + 1, earnedCol + 1).setValue('reversed');
}

/* ── Личный кабинет (вход по телефону + номеру заказа) ──────────────────── */

// Сессия — HMAC-подписанный токен phone|expiry (без хранения на сервере).
// Секрет генерируется автоматически и живёт в Script Properties.
function sessionSecret_(){
  var s = prop_('SESSION_SECRET');
  if(!s){ s = genToken_(48); setProp_('SESSION_SECRET', s); }
  return s;
}

function genToken_(n){
  var chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789';
  var out = '';
  for(var i = 0; i < n; i++) out += chars.charAt(Math.floor(Math.random() * chars.length));
  return out;
}

function hmacHex_(msg){
  var raw = Utilities.computeHmacSha256Signature(msg, sessionSecret_());
  return raw.map(function(b){ return ('0' + (b & 0xff).toString(16)).slice(-2); }).join('');
}

function makeSession_(phone){
  var payload = normalizePhone_(phone) + '|' + (new Date().getTime() + 30 * 24 * 3600 * 1000);
  return Utilities.base64EncodeWebSafe(payload) + '.' + hmacHex_(payload);
}

// Возвращает телефон из валидного токена или '' (плохая подпись/просрочен).
function verifySession_(token){
  var parts = String(token || '').split('.');
  if(parts.length !== 2) return '';
  var payload;
  try{ payload = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString(); }
  catch(err){ return ''; }
  if(hmacHex_(payload) !== parts[1]) return '';
  var seg = payload.split('|');
  if(seg.length !== 2 || Number(seg[1]) < new Date().getTime()) return '';
  return seg[0];
}

function checkLoginRate_(){
  var cache = CacheService.getScriptCache();
  var count = Number(cache.get('login_rate') || 0);
  if(count >= 30) return false;                 // 30 попыток…
  cache.put('login_rate', String(count + 1), 600);  // …за 10 минут
  return true;
}

// Вход: телефон + номер любого своего заказа. Совпало — выдаём сессию.
function handleAccountLogin_(body){
  if(!checkLoginRate_()) return {ok:false, error:'rate_limited'};
  var phone = normalizePhone_(body.phone);
  var orderId = str_(body.order_id, 60);
  if(!phone || !orderId) return {ok:false, error:'bad_credentials'};

  var rows;
  try{ rows = readRows_('orders'); }
  catch(err){ return {ok:false, error:'unavailable'}; }
  var found = false;
  for(var i = 0; i < rows.length; i++){
    if(String(rows[i].order_id).trim() === orderId && normalizePhone_(rows[i].phone) === phone){ found = true; break; }
  }
  if(!found) return {ok:false, error:'not_found'};

  return {ok:true, token:makeSession_(phone), phone:phone, points:loyaltyBalance_(phone), earn_percent:loyaltyEarnPercent_()};
}

function customerInfo_(phone){
  var key = normalizePhone_(phone);
  var info = {name:'', total_spent:0, orders_count:0};
  var rows;
  try{ rows = readRowsFromSheet_(getCustomerSheet_()); }
  catch(err){ return info; }
  for(var i = 0; i < rows.length; i++){
    if(normalizePhone_(rows[i].phone) === key){
      info.name = rows[i].name || '';
      info.total_spent = toInt_(rows[i].total_spent);
      info.orders_count = toInt_(rows[i].orders_count);
      return info;
    }
  }
  return info;
}

// Данные кабинета по сессии: баланс + свои заказы. Только по валидному токену.
function handleAccount_(token){
  var phone = verifySession_(token);
  if(!phone) return {ok:false, error:'unauthorized'};

  var rows;
  try{ rows = readRows_('orders'); }
  catch(err){ rows = []; }
  var orders = rows.filter(function(r){ return normalizePhone_(r.phone) === phone; }).map(function(r){
    var items = [];
    try{ items = JSON.parse(r.items_json || '[]'); }catch(_){}
    return {
      order_id:r.order_id || '',
      timestamp:r.timestamp || '',
      status:r.status || '',
      total:toInt_(r.total),
      discount:toInt_(r.discount),
      points_redeemed:toInt_(r.points_redeemed),
      items:items.map(function(it){ return {name:it.name || '', description:it.description || '', quantity:Number(it.quantity || 1)}; })
    };
  }).reverse();

  var info = customerInfo_(phone);
  return {
    ok:true,
    phone:phone,
    points:loyaltyBalance_(phone),
    earn_percent:loyaltyEarnPercent_(),
    name:info.name,
    total_spent:info.total_spent,
    orders_count:info.orders_count,
    orders:orders
  };
}

/* ── Email (только сбор адреса в заказе, авто-отправка отключена) ────────── */

// Email покупателя сохраняется в заказ для базы клиентов; письма сейчас не
// отправляются (уведомления идут в Telegram + WhatsApp click-to-chat).
function validEmail_(value){
  var email = String(value == null ? '' : value).trim();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

/* ── Telegram ───────────────────────────────────────────────────────────── */

// Возвращает {ok:true} или {ok:false, error:'…'} — ошибка видна
// в ответе submit_order (telegram_error) и через ?action=test_telegram.
function sendTelegram_(text){
  var token = prop_('TELEGRAM_BOT_TOKEN');
  var chatId = prop_('TELEGRAM_CHAT_ID');
  if(!token) return {ok:false, error:'TELEGRAM_BOT_TOKEN не задан в Script Properties'};
  if(!chatId) return {ok:false, error:'TELEGRAM_CHAT_ID не задан в Script Properties'};
  try{
    var response = UrlFetchApp.fetch('https://api.telegram.org/bot' + token + '/sendMessage', {
      method:'post',
      contentType:'application/json',
      payload:JSON.stringify({chat_id:chatId, text:text}),
      muteHttpExceptions:true
    });
    var code = response.getResponseCode();
    if(code === 200) return {ok:true};
    return {ok:false, error:'Telegram HTTP ' + code + ': ' + response.getContentText().slice(0, 300)};
  }catch(err){
    return {ok:false, error:String(err && err.message || err)};
  }
}

function notifyTelegram_(order, items){
  var lines = [
    'Новый заказ: ' + order.order_id,
    'Имя: ' + (order.name || '-'),
    'Телефон: ' + (order.phone || '-'),
    'Адрес: ' + [order.city, order.street, order.house, order.flat].filter(Boolean).join(', '),
    'Оплата: ' + order.payment_method,
    'Статус: ' + order.status,
    order.comment ? 'Комментарий: ' + order.comment : '',
    '',
    'Состав:'
  ].filter(function(line){ return line !== ''; });
  items.forEach(function(item, index){
    lines.push((index + 1) + '. ' + item.name + ' / ' + item.brand + ' / ' + item.description +
      ' — ' + item.quantity + ' x ' + item.price + ' ₸');
  });
  lines.push('');
  if(order.discount > 0 || order.points_redeemed > 0){
    lines.push('Подытог: ' + order.subtotal + ' ₸');
    if(order.discount > 0) lines.push('Скидка' + (order.promo_code ? ' (' + order.promo_code + ')' : '') + ': −' + order.discount + ' ₸');
    if(order.points_redeemed > 0) lines.push('Бонусы: −' + order.points_redeemed + ' ₸');
  }
  lines.push('Итого: ' + order.total + ' ₸');
  if(order.price_check.indexOf('MISMATCH') === 0) lines.push('⚠️ ' + order.price_check);

  return sendTelegram_(lines.join('\n'));
}

// Запуск из редактора: выберите эту функцию в списке → Run.
// Функции с "_" на конце в список не попадают, поэтому она без подчёркивания.
// Первый запуск покажет окно авторизации (право «внешние запросы» для Telegram).
function testTelegramFromEditor(){
  var result = sendTelegram_('Тест уведомлений La Belle из редактора: всё настроено верно.');
  Logger.log(JSON.stringify(result));
}

/* ── Доступ и утилиты ───────────────────────────────────────────────────── */

// Роли определяются токеном (проверка на сервере). Owner — существующий
// ADMIN_TOKEN (обратная совместимость) или ADMIN_TOKEN_OWNER; менеджер —
// ADMIN_TOKEN_MANAGER. Токены в браузер не попадают.
function resolveRole_(token){
  if(!token) return '';
  var owner = prop_('ADMIN_TOKEN') || prop_('ADMIN_TOKEN_OWNER');
  var manager = prop_('ADMIN_TOKEN_MANAGER');
  if(owner && String(token) === owner) return 'owner';
  if(manager && String(token) === manager) return 'manager';
  return '';
}

// Возвращает роль или бросает. min: 'manager' (по умолчанию) или 'owner'.
function requireRole_(token, min){
  var owner = prop_('ADMIN_TOKEN') || prop_('ADMIN_TOKEN_OWNER');
  if(!owner) throw new Error('admin_token_not_configured');
  var role = resolveRole_(token);
  if(!role) throw new Error('unauthorized');
  if(min === 'owner' && role !== 'owner') throw new Error('forbidden');
  return role;
}

// Обратная совместимость: минимальный уровень — менеджер.
function requireAdmin_(token){
  return requireRole_(token, 'manager');
}

function prop_(key){
  return PropertiesService.getScriptProperties().getProperty(key) || '';
}

function getSpreadsheet_(){
  var id = prop_('SPREADSHEET_ID');
  if(!id) throw new Error('SPREADSHEET_ID is not set in Script Properties');
  return SpreadsheetApp.openById(id);
}

function getSheet_(kind){
  var ss = getSpreadsheet_();
  var gid = prop_(kind === 'catalog' ? 'CATALOG_SHEET_GID' : 'ORDERS_SHEET_GID');
  if(!gid) throw new Error(kind + ' sheet gid is not set in Script Properties');
  var sheets = ss.getSheets();
  for(var i = 0; i < sheets.length; i++){
    if(String(sheets[i].getSheetId()) === String(gid)) return sheets[i];
  }
  throw new Error(kind + ' sheet not found by gid ' + gid);
}

function readRows_(kind){
  return readRowsFromSheet_(getSheet_(kind));
}

function readRowsFromSheet_(sheet){
  var values = sheet.getDataRange().getValues();
  if(values.length < 2) return [];
  var headers = values[0].map(normalizeHeader_);
  var rows = [];
  for(var i = 1; i < values.length; i++){
    var row = {};
    var hasValue = false;
    for(var j = 0; j < headers.length; j++){
      if(!headers[j]) continue;
      var value = values[i][j];
      if(value instanceof Date) value = value.toISOString();
      else if(value == null) value = '';
      else value = String(value);
      if(value.trim()) hasValue = true;
      row[headers[j]] = value;
    }
    if(hasValue) rows.push(row);
  }
  return rows;
}

function appendRowByHeaders_(sheet, data, defaultHeaders){
  var lastColumn = sheet.getLastColumn();
  var headers;
  if(sheet.getLastRow() === 0 || lastColumn === 0){
    headers = defaultHeaders || Object.keys(data);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  }else{
    headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0].map(normalizeHeader_);
  }
  var row = headers.map(function(header){
    return Object.prototype.hasOwnProperty.call(data, header) ? data[header] : '';
  });
  sheet.appendRow(row);
}

function checkOrderRate_(){
  var cache = CacheService.getScriptCache();
  var count = Number(cache.get('order_rate') || 0);
  if(count >= ORDER_RATE_LIMIT) return false;
  cache.put('order_rate', String(count + 1), ORDER_RATE_WINDOW_SEC);
  return true;
}

function sanitizeItems_(items){
  if(!Array.isArray(items)) return [];
  return items.slice(0, 60).map(function(item, index){
    item = item || {};
    var quantity = Math.max(1, Math.min(99, Math.round(Number(item.quantity) || 1)));
    var price = num_(item.price, 0, 10000000);
    return {
      index: index + 1,
      name: str_(item.name, 200),
      brand: str_(item.brand, 200),
      description: str_(item.description, 400),
      type: str_(item.type, 20) || 'product',
      quantity: quantity,
      price: price,
      total: price * quantity
    };
  }).filter(function(item){ return item.name || item.brand; });
}

function str_(value, max){
  return String(value == null ? '' : value).trim().slice(0, max);
}

function num_(value, min, max){
  var n = Number(value);
  if(!isFinite(n)) return 0;
  return Math.max(min, Math.min(max, Math.round(n)));
}

function toInt_(value){
  var digits = String(value == null ? '' : value).replace(/[^\d]/g, '');
  return digits ? parseInt(digits, 10) : 0;
}

function parseDate_(value){
  var parsed = new Date(value);
  return isNaN(parsed.getTime()) ? new Date() : parsed;
}

function normalizeHeader_(value){
  return String(value == null ? '' : value).trim().toLowerCase();
}

function normalizeIdentity_(value){
  return String(value == null ? '' : value).trim().toLowerCase();
}

function json_(payload){
  return ContentService
    .createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}
