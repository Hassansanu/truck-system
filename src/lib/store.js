import { isSupabaseConfigured, supabase } from './supabase'

const STORAGE_KEY = 'raahbar-truck-cash-v1'
const REQUEST_TIMEOUT_MS = 15000

const databaseRequest = async (request, action) => {
  let timeoutId
  try {
    const result = await Promise.race([
      Promise.resolve(request),
      new Promise((_, reject) => {
        timeoutId = window.setTimeout(
          () => reject(new Error(`${action} timed out. Check your internet connection and try again.`)),
          REQUEST_TIMEOUT_MS,
        )
      }),
    ])
    if (result.error) throw new Error(result.error.message || `${action} failed.`)
    return result.data
  } finally {
    window.clearTimeout(timeoutId)
  }
}

const seed = {
  trucks: [
    { id: 't1', truck_number: 'JY-7842', entry_date: '2026-06-10', products: [{ id: 'p1', product_name: 'Wheat Flour (50kg)', quantity: 240, purchase_rate: 4850, sale_rate: 5300 }] },
    { id: 't2', truck_number: 'LES-4291', entry_date: '2026-06-08', products: [{ id: 'p2', product_name: 'Basmati Rice (25kg)', quantity: 320, purchase_rate: 4400, sale_rate: 4800 }] },
    { id: 't3', truck_number: 'TKX-9012', entry_date: '2026-06-05', products: [{ id: 'p3', product_name: 'Refined Sugar (50kg)', quantity: 180, purchase_rate: 3900, sale_rate: 4250 }] },
    { id: 't4', truck_number: 'JZ-1120', entry_date: '2026-05-31', products: [{ id: 'p4', product_name: 'Cooking Oil (16L)', quantity: 100, purchase_rate: 5600, sale_rate: 6100 }] },
  ],
  cashCollections: [
    { id: 'c1', collection_date: '2026-06-11', amount: 850000, description: 'Weekly cash collection' },
    { id: 'c2', collection_date: '2026-06-07', amount: 650000, description: 'Partial settlement' },
    { id: 'c3', collection_date: '2026-06-02', amount: 480000, description: 'Cash received' },
  ],
  cashBook: [
    { id: 'b1', transaction_date: '2026-06-11', type: 'in', amount: 850000, description: 'Received from salesman' },
    { id: 'b2', transaction_date: '2026-06-10', type: 'out', amount: 520000, description: 'Sent to Pak Agro Industries' },
    { id: 'b3', transaction_date: '2026-06-08', type: 'out', amount: 45000, description: 'Office and business expenses' },
    { id: 'b4', transaction_date: '2026-06-07', type: 'in', amount: 650000, description: 'Received from salesman' },
  ],
}

const normalizeTruck = (truck) => {
  const products = truck.products || truck.truck_products || []
  const purchase = products.reduce((sum, p) => sum + Number(p.quantity) * Number(p.purchase_rate), 0)
  const sale = products.reduce((sum, p) => sum + Number(p.quantity) * Number(p.sale_rate), 0)
  return { ...truck, products, total_purchase: purchase, total_sale: sale, profit: sale - purchase }
}

const localRead = () => {
  const stored = localStorage.getItem(STORAGE_KEY)
  if (stored) return JSON.parse(stored)
  localStorage.setItem(STORAGE_KEY, JSON.stringify(seed))
  return seed
}

const localWrite = (data) => localStorage.setItem(STORAGE_KEY, JSON.stringify(data))

export const dataService = {
  async load() {
    if (!isSupabaseConfigured) {
      const data = localRead()
      return { ...data, trucks: data.trucks.map(normalizeTruck) }
    }
    const [trucks, collections, cashBook] = await Promise.all([
      databaseRequest(
        supabase.from('trucks').select('*, truck_products(*)').order('entry_date', { ascending: false }),
        'Loading truck entries',
      ),
      databaseRequest(
        supabase.from('cash_collections').select('*').order('collection_date', { ascending: false }),
        'Loading cash collections',
      ),
      databaseRequest(
        supabase.from('cash_book').select('*').order('transaction_date', { ascending: false }),
        'Loading cash book',
      ),
    ])
    return {
      trucks: trucks.map(normalizeTruck),
      cashCollections: collections,
      cashBook: cashBook.map((row) => ({
        ...row,
        type: row.type || row.transaction_type,
      })),
    }
  },

  async saveTruck(truck) {
    const normalizedTruck = {
      ...truck,
      products: truck.products.map((product) => ({
        ...product,
        quantity: Number(product.quantity),
        purchase_rate: Number(product.purchase_rate),
        sale_rate: Number(product.sale_rate),
      })),
    }
    if (!isSupabaseConfigured) {
      const data = localRead()
      const record = { ...normalizedTruck, id: truck.id || crypto.randomUUID(), products: normalizedTruck.products.map((p) => ({ ...p, id: p.id || crypto.randomUUID() })) }
      const index = data.trucks.findIndex((item) => item.id === record.id)
      if (index >= 0) data.trucks[index] = record
      else data.trucks.push(record)
      localWrite(data)
      return
    }
    const header = {
      ...(truck.id ? { id: truck.id } : {}),
      truck_number: truck.truck_number,
      entry_date: truck.entry_date,
    }
    const products = normalizedTruck.products
    const isExistingTruck = Boolean(truck.created_at)
    const existingProducts = isExistingTruck
      ? await databaseRequest(
          supabase.from('truck_products').select('id').eq('truck_id', truck.id),
          'Loading existing products',
        )
      : []
    const savedTruck = await databaseRequest(
      supabase.from('trucks').upsert(header).select().single(),
      isExistingTruck ? 'Updating truck entry' : 'Creating truck entry',
    )
    const productRows = products.map((product) => ({
      id: product.id,
      product_name: product.product_name,
      quantity: product.quantity,
      purchase_rate: product.purchase_rate,
      sale_rate: product.sale_rate,
      truck_id: savedTruck.id,
    }))
    await databaseRequest(
      supabase.from('truck_products').upsert(productRows),
      'Saving truck products',
    )
    const currentIds = new Set(productRows.map((product) => product.id))
    const removedIds = existingProducts.filter((product) => !currentIds.has(product.id)).map((product) => product.id)
    if (removedIds.length) {
      await databaseRequest(
        supabase.from('truck_products').delete().in('id', removedIds),
        'Removing deleted products',
      )
    }
  },

  async deleteTruck(id) {
    if (!isSupabaseConfigured) {
      const data = localRead()
      data.trucks = data.trucks.filter((item) => item.id !== id)
      localWrite(data)
      return
    }
    await databaseRequest(supabase.from('trucks').delete().eq('id', id), 'Deleting truck entry')
  },

  async saveCollection(collection) {
    if (!isSupabaseConfigured) return this.saveLocalList('cashCollections', collection)
    await databaseRequest(
      supabase.from('cash_collections').upsert({ ...collection, amount: Number(collection.amount) }),
      collection.created_at ? 'Updating cash collection' : 'Saving cash collection',
    )
  },

  async deleteCollection(id) {
    if (!isSupabaseConfigured) return this.deleteLocalList('cashCollections', id)
    await databaseRequest(
      supabase.from('cash_collections').delete().eq('id', id),
      'Deleting cash collection',
    )
  },

  async saveCashBook(record) {
    if (!isSupabaseConfigured) return this.saveLocalList('cashBook', record)
    const payload = {
      ...(record.id ? { id: record.id } : {}),
      transaction_date: record.transaction_date,
      type: record.type,
      amount: Number(record.amount),
      description: record.description,
    }
    await databaseRequest(
      supabase.from('cash_book').upsert(payload),
      record.created_at ? 'Updating cash book entry' : 'Saving cash book entry',
    )
  },

  async deleteCashBook(id) {
    if (!isSupabaseConfigured) return this.deleteLocalList('cashBook', id)
    await databaseRequest(supabase.from('cash_book').delete().eq('id', id), 'Deleting cash book entry')
  },

  saveLocalList(key, record) {
    const data = localRead()
    const item = { ...record, id: record.id || crypto.randomUUID() }
    const index = data[key].findIndex((row) => row.id === item.id)
    if (index >= 0) data[key][index] = item
    else data[key].push(item)
    localWrite(data)
  },

  deleteLocalList(key, id) {
    const data = localRead()
    data[key] = data[key].filter((item) => item.id !== id)
    localWrite(data)
  },
}
