/**
 * @typedef {Object} Product
 * @property {number} id
 * @property {string} key
 * @property {number} rowNumber
 * @property {string} brand
 * @property {string} name
 * @property {string} category
 * @property {string} season
 * @property {string} gender
 * @property {string} occasion
 * @property {string} longevity
 * @property {string} sillage
 * @property {string} description
 * @property {string} fullDescription
 * @property {{top:string, heart:string, base:string}} notes
 * @property {Record<string, number>} volumes
 * @property {number|null} stockQty
 * @property {boolean} available
 * @property {string} imageUrl
 * @property {string} image
 * @property {number|null} minPrice
 */

/**
 * @typedef {Object} CartItem
 * @property {string} key
 * @property {number|string} id
 * @property {string} name
 * @property {string} brand
 * @property {string} description
 * @property {string} type
 * @property {number} price
 * @property {number} quantity
 */

/**
 * @typedef {Object} PaymentInfo
 * @property {'cash'|'kaspi'} method
 * @property {'pending'|'awaiting_payment'|'paid'|'failed'} status
 */

/**
 * @typedef {Object} Order
 * @property {string} id
 * @property {string} createdAt
 * @property {{name:string, phone:string, city:string, street:string, house:string, flat:string, comment:string}} customer
 * @property {CartItem[]} items
 * @property {number} total
 * @property {PaymentInfo} payment
 * @property {string} status
 * @property {'local'|'sheet'} [source]
 */

window.LaBelle = window.LaBelle || {};
