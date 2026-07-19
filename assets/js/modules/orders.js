(function(){
  'use strict';

  const app = window.LaBelle = window.LaBelle || {};
  const LS_ORDERS_KEY = 'lb_orders_v1';
  const LS_ORDER_STATUS_OVERRIDES_KEY = 'lb_order_status_overrides_v1';

  function getOrders(){
    return app.storage.readJson(LS_ORDERS_KEY, []);
  }

  function saveOrders(orders){
    app.storage.writeJson(LS_ORDERS_KEY, orders);
  }

  function getStatusOverrides(){
    return app.storage.readJson(LS_ORDER_STATUS_OVERRIDES_KEY, {});
  }

  function saveStatusOverrides(overrides){
    app.storage.writeJson(LS_ORDER_STATUS_OVERRIDES_KEY, overrides);
  }

  function applyStatusOverride(order){
    const status = getStatusOverrides()[order.id];
    if(!status) return order;
    return {
      ...order,
      status,
      payment:{
        ...(order.payment || {}),
        status:status === 'paid' ? 'paid' : order.payment?.status
      }
    };
  }

  function clearStatusOverride(orderId){
    const overrides = getStatusOverrides();
    if(!(orderId in overrides)) return;
    delete overrides[orderId];
    saveStatusOverrides(overrides);
  }

  function makeOrderId(){
    const now = new Date();
    const stamp = now.toISOString().replace(/\D/g, '').slice(0, 14);
    return `LB-${stamp}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  }

  function saveOrder(order){
    const orders = getOrders();
    orders.unshift(order);
    saveOrders(orders);
    return order;
  }

  function applyLocalStatus(orderId, status){
    const orders = getOrders();
    const order = orders.find(item => item.id === orderId);
    if(!order){
      const overrides = getStatusOverrides();
      overrides[orderId] = status;
      saveStatusOverrides(overrides);
      return {id:orderId, status};
    }
    order.status = status;
    if(order.payment) order.payment.status = status === 'paid' ? 'paid' : order.payment.status;
    saveOrders(orders);
    return order;
  }

  // Локальное обновление всегда, удалённое — только если админ авторизован.
  // Возвращает {order, remote} — по remote.ok видно, дошло ли до таблицы.
  async function updateOrderStatus(orderId, status){
    const order = applyLocalStatus(orderId, status);
    const token = app.api.getAdminToken();
    if(!app.api.isConfigured() || !token) return {order, remote:{ok:false, skipped:true}};
    let remote;
    try{
      remote = await app.api.post({action:'update_order_status', token, order_id:orderId, status});
    }catch(err){
      remote = {ok:false, error:err.message};
    }
    // После успешной записи в таблицу локальный override больше не нужен:
    // источник правды — таблица, иначе устаревший override прятал бы её данные.
    if(remote.ok) clearStatusOverride(orderId);
    return {order, remote};
  }

  function toInt(value){
    const digits = String(value ?? '').replace(/[^\d]/g, '');
    return digits ? parseInt(digits, 10) : 0;
  }

  function parseOrderDate(value){
    const raw = String(value || '').trim();
    const match = raw.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?/);
    if(match){
      const [, day, month, year, hour, minute, second = '0'] = match;
      return new Date(Number(year), Number(month) - 1, Number(day), Number(hour), Number(minute), Number(second)).toISOString();
    }
    const parsed = Date.parse(raw);
    return Number.isNaN(parsed) ? new Date().toISOString() : new Date(parsed).toISOString();
  }

  function parseItemsJson(value){
    try{
      const parsed = JSON.parse(String(value || '[]'));
      return Array.isArray(parsed) ? parsed : [];
    }catch(_){
      return [];
    }
  }

  function mapSheetOrder(row, index){
    const timestamp = row.timestamp || row.Timestamp || '';
    const items = parseItemsJson(row.items_json || row.items || '');
    const id = row.order_id || `SHEET-${index + 1}-${String(timestamp).replace(/\D/g, '').slice(0, 12)}`;
    return applyStatusOverride({
      id,
      source:'sheet',
      createdAt:parseOrderDate(timestamp),
      customer:{
        name:row.name || '',
        phone:row.phone || '',
        email:row.email || '',
        city:row.city || '',
        street:row.street || '',
        house:row.house || '',
        flat:row.flat || '',
        comment:row.comment || ''
      },
      items:items.map((item, itemIndex) => ({
        index:item.index || itemIndex + 1,
        name:item.name || '',
        brand:item.brand || '',
        description:item.description || '',
        type:item.type || 'product',
        quantity:Number(item.quantity || 1),
        price:Number(item.price || 0),
        total:Number(item.total || 0)
      })),
      subtotal:toInt(row.subtotal),
      discount:toInt(row.discount),
      pointsRedeemed:toInt(row.points_redeemed),
      promoCode:row.promo_code || '',
      total:toInt(row.total),
      payment:{
        method:row.payment_method || '-',
        status:row.payment_status || 'unknown'
      },
      status:row.status || 'new'
    });
  }

  // Заказы из приватной таблицы доступны только с админ-токеном:
  // Apps Script проверяет его на сервере.
  async function loadRemoteOrders(){
    const token = app.api.getAdminToken();
    if(!app.api.isConfigured() || !token) return [];
    const data = await app.api.get({action:'orders', token});
    if(!data.ok || !Array.isArray(data.rows)) throw new Error(data.error || 'Заказы недоступны');
    return data.rows
      .filter(row => String(row.timestamp || '').trim() && String(row.timestamp || '').trim().toLowerCase() !== 'время')
      .map(mapSheetOrder);
  }

  async function loadOrders(){
    const local = getOrders().map(order => applyStatusOverride({...order, source:order.source || 'local'}));
    const sheet = await loadRemoteOrders();
    const remoteIds = new Set(sheet.map(order => order.id));
    // Заказ, который уже есть в таблице, показываем из таблицы — там свежий статус.
    return [...sheet, ...local.filter(order => !remoteIds.has(order.id))]
      .sort((a,b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  async function sendToSheet(order){
    if(!app.api.isConfigured()) return {ok:false, skipped:true};
    const payload = {
      action:'submit_order',
      // Honeypot: реальный посетитель поле не видит и не заполняет.
      website:app.dom.byId('c_website')?.value || '',
      order:{
        order_id: order.id,
        timestamp: order.createdAt,
        name: order.customer.name,
        phone: order.customer.phone,
        email: order.customer.email || '',
        city: order.customer.city,
        street: order.customer.street,
        house: order.customer.house,
        flat: order.customer.flat,
        comment: order.customer.comment,
        subtotal: order.subtotal,
        discount: order.discount,
        promo_code: order.promoCode || '',
        redeem_points: order.redeemPoints || 0,
        total: order.total,
        status: order.status,
        payment_method: order.payment.method,
        payment_status: order.payment.status,
        items: order.items
      }
    };
    return app.api.post(payload);
  }

  function buildOrder({customer, items, total, payment, subtotal, discount, promoCode, pointsRedeemed, redeemPoints}){
    const status = app.payments.getOrderStatusForPayment(payment);
    const computedSubtotal = subtotal != null
      ? subtotal
      : items.reduce((sum, item) => sum + item.price * item.quantity, 0);
    const appliedDiscount = Math.max(0, Number(discount) || 0);
    const appliedPoints = Math.max(0, Number(pointsRedeemed) || 0);
    return {
      id:makeOrderId(),
      createdAt:new Date().toISOString(),
      customer,
      items:items.map((item, index) => ({
        index:index + 1,
        name:item.name,
        brand:item.brand,
        description:item.description,
        type:item.type || 'product',
        quantity:item.quantity,
        price:item.price,
        total:item.price * item.quantity
      })),
      subtotal:computedSubtotal,
      discount:appliedDiscount,
      pointsRedeemed:appliedPoints,
      redeemPoints:Math.max(0, Number(redeemPoints) || 0),
      promoCode:promoCode || '',
      total:total != null ? total : Math.max(0, computedSubtotal - appliedDiscount - appliedPoints),
      payment,
      status
    };
  }

  app.orders = {
    getOrders,
    loadOrders,
    saveOrder,
    buildOrder,
    updateOrderStatus,
    sendToSheet
  };
})();
