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
  'timestamp','order_id','name','phone','city','street','house','flat',
  'comment','total','status','payment_method','payment_status','items_json','price_check'
];

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
    if(action === 'verify'){
      requireAdmin_(params.token);
      return json_({ok:true});
    }
    if(action === 'orders'){
      requireAdmin_(params.token);
      return json_({ok:true, rows:readRows_('orders')});
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
    if(action === 'upsert_product'){
      requireAdmin_(body.token);
      return json_(handleUpsertProduct_(body));
    }
    if(action === 'update_order_status'){
      requireAdmin_(body.token);
      return json_(handleUpdateOrderStatus_(body));
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

  var status = ORDER_STATUSES.indexOf(String(raw.status)) > -1 ? String(raw.status) : 'new';
  var order = {
    timestamp: parseDate_(raw.timestamp),
    order_id: str_(raw.order_id, 40) || ('LB-' + new Date().getTime()),
    name: str_(raw.name, 120),
    phone: phone,
    city: str_(raw.city, 120),
    street: str_(raw.street, 200),
    house: str_(raw.house, 40),
    flat: str_(raw.flat, 40),
    comment: str_(raw.comment, 600),
    total: num_(raw.total, 0, 100000000),
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
  }finally{
    lock.releaseLock();
  }

  var telegram = notifyTelegram_(order, items);
  return {ok:true, telegram:telegram.ok, telegram_error:telegram.error || '', price_check:order.price_check};
}

function handleUpdateOrderStatus_(body){
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
    if(idCol === -1 || statusCol === -1) return {ok:false, error:'missing_columns'};
    for(var i = 1; i < values.length; i++){
      if(String(values[i][idCol]).trim() === orderId){
        sheet.getRange(i + 1, statusCol + 1).setValue(status);
        if(status === 'paid' && paymentStatusCol !== -1){
          sheet.getRange(i + 1, paymentStatusCol + 1).setValue('paid');
        }
        return {ok:true};
      }
    }
    return {ok:false, error:'order_not_found'};
  }finally{
    lock.releaseLock();
  }
}

/* ── Товары ─────────────────────────────────────────────────────────────── */

function handleUpsertProduct_(body){
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
      return {ok:true, created:true};
    }

    for(var key in product){
      if(!Object.prototype.hasOwnProperty.call(product, key)) continue;
      var col = headers.indexOf(normalizeHeader_(key));
      if(col === -1) continue;
      sheet.getRange(rowIndex + 1, col + 1).setValue(product[key]);
    }
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
  lines.push('Сумма: ' + order.total + ' ₸');
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

function requireAdmin_(token){
  var adminToken = prop_('ADMIN_TOKEN');
  if(!adminToken) throw new Error('admin_token_not_configured');
  if(!token || String(token) !== adminToken) throw new Error('unauthorized');
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
  var values = getSheet_(kind).getDataRange().getValues();
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
