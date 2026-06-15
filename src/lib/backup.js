const number = (value) => Number(value || 0)
const safeText = (value) => {
  const text = String(value ?? '')
  return /^[=+\-@]/.test(text) ? `'${text}` : text
}

const sum = (rows, field) => rows.reduce((total, row) => total + number(row[field]), 0)

const monthLabel = (month) =>
  new Intl.DateTimeFormat('en-PK', { month: 'long', year: 'numeric' })
    .format(new Date(`${month}-01T00:00:00`))

const addSheet = (XLSX, workbook, name, headers, rows, widths) => {
  const sheet = XLSX.utils.aoa_to_sheet([headers, ...rows])
  sheet['!cols'] = widths.map((width) => ({ wch: width }))
  sheet['!autofilter'] = { ref: `A1:${XLSX.utils.encode_col(headers.length - 1)}1` }
  sheet['!freeze'] = { xSplit: 0, ySplit: 1, topLeftCell: 'A2', activePane: 'bottomLeft', state: 'frozen' }
  XLSX.utils.book_append_sheet(workbook, sheet, name)
}

const createMonthlyRows = (data) => {
  const months = new Set([
    ...data.trucks.map((truck) => truck.entry_date?.slice(0, 7)),
    ...data.cashCollections.map((collection) => collection.collection_date?.slice(0, 7)),
    ...data.cashBook.map((row) => row.transaction_date?.slice(0, 7)),
  ].filter(Boolean))

  return [...months].sort().map((month) => {
    const trucks = data.trucks.filter((truck) => truck.entry_date?.startsWith(month))
    const collections = data.cashCollections.filter((collection) => collection.collection_date?.startsWith(month))
    const cashBook = data.cashBook.filter((row) => row.transaction_date?.startsWith(month))
    const purchase = sum(trucks, 'total_purchase')
    const sale = sum(trucks, 'total_sale')
    const collectionsTotal = sum(collections, 'amount')
    const cashIn = sum(cashBook.filter((row) => row.type === 'in'), 'amount')
    const cashOut = sum(cashBook.filter((row) => row.type === 'out'), 'amount')

    return [
      month,
      monthLabel(month),
      trucks.length,
      purchase,
      sale,
      sale - purchase,
      collectionsTotal,
      sale - collectionsTotal,
      cashIn,
      cashOut,
      cashIn - cashOut,
    ]
  })
}

export function buildFullBackupWorkbook(XLSX, data, createdAt = new Date()) {
  const workbook = XLSX.utils.book_new()
  const productRows = data.trucks.flatMap((truck) =>
    truck.products.map((product) => [
      product.id,
      truck.id,
      safeText(truck.truck_number),
      truck.entry_date,
      safeText(product.product_name),
      number(product.quantity),
      number(product.purchase_rate),
      number(product.sale_rate),
      number(product.purchase_amount || number(product.quantity) * number(product.purchase_rate)),
      number(product.sale_amount || number(product.quantity) * number(product.sale_rate)),
      product.created_at || '',
    ]),
  )
  const cashIn = data.cashBook.filter((row) => row.type === 'in')
  const cashOut = data.cashBook.filter((row) => row.type === 'out')

  addSheet(XLSX, workbook, 'Backup Summary',
    ['Backup Information', 'Value'],
    [
      ['Business', 'HASSAN ENTERPRISES'],
      ['Backup created', createdAt.toLocaleString('en-PK')],
      ['Truck records', data.trucks.length],
      ['Truck product records', productRows.length],
      ['Salesman collection records', data.cashCollections.length],
      ['Cash book records', data.cashBook.length],
      ['Total truck purchase', sum(data.trucks, 'total_purchase')],
      ['Total truck sale', sum(data.trucks, 'total_sale')],
      ['Total truck profit', sum(data.trucks, 'profit')],
      ['Total salesman collections', sum(data.cashCollections, 'amount')],
      ['Total cash in', sum(cashIn, 'amount')],
      ['Total cash out', sum(cashOut, 'amount')],
      ['Cash balance', sum(cashIn, 'amount') - sum(cashOut, 'amount')],
      ['Restore note', 'Keep this complete workbook unchanged. Each database area is stored on a separate sheet.'],
    ],
    [30, 72],
  )

  addSheet(XLSX, workbook, 'Trucks',
    ['ID', 'Truck Number', 'Entry Date', 'Supplier', 'Notes', 'Product Count', 'Total Purchase', 'Total Sale', 'Profit', 'Created At', 'Updated At'],
    data.trucks.map((truck) => [
      truck.id,
      safeText(truck.truck_number),
      truck.entry_date,
      safeText(truck.supplier_name),
      safeText(truck.notes),
      truck.products.length,
      number(truck.total_purchase),
      number(truck.total_sale),
      number(truck.profit),
      truck.created_at || '',
      truck.updated_at || '',
    ]),
    [10, 20, 14, 22, 45, 14, 18, 18, 18, 24, 24],
  )

  addSheet(XLSX, workbook, 'Truck Products',
    ['ID', 'Truck ID', 'Truck Number', 'Entry Date', 'Product Name', 'Quantity', 'Purchase Rate', 'Sale Rate', 'Purchase Amount', 'Sale Amount', 'Created At'],
    productRows,
    [10, 12, 20, 14, 48, 12, 16, 16, 18, 18, 24],
  )

  addSheet(XLSX, workbook, 'Salesman Collections',
    ['ID', 'Collection Date', 'Amount', 'Description', 'Created At', 'Updated At'],
    data.cashCollections.map((row) => [
      row.id,
      row.collection_date,
      number(row.amount),
      safeText(row.description),
      row.created_at || '',
      row.updated_at || '',
    ]),
    [10, 16, 18, 65, 24, 24],
  )

  addSheet(XLSX, workbook, 'Cash Book',
    ['ID', 'Transaction Date', 'Type', 'Amount', 'Description', 'Created At', 'Updated At'],
    data.cashBook.map((row) => [
      row.id,
      row.transaction_date,
      row.type === 'in' ? 'Cash In' : 'Cash Out',
      number(row.amount),
      safeText(row.description),
      row.created_at || '',
      row.updated_at || '',
    ]),
    [10, 18, 14, 18, 65, 24, 24],
  )

  addSheet(XLSX, workbook, 'Monthly Summary',
    ['Month Key', 'Month', 'Trucks', 'Management Investment', 'Truck Sale', 'Profit', 'Salesman Collections', 'Outstanding Added', 'Cash In', 'Cash Out', 'Net Cash'],
    createMonthlyRows(data),
    [12, 20, 10, 24, 18, 18, 22, 22, 18, 18, 18],
  )

  workbook.Props = {
    Title: 'Hassan Enterprises Full Database Backup',
    Subject: 'Truck and cash management backup',
    Author: 'Hassan Enterprises',
    CreatedDate: createdAt,
  }

  return {
    workbook,
    counts: {
      trucks: data.trucks.length,
      products: productRows.length,
      collections: data.cashCollections.length,
      cashBook: data.cashBook.length,
    },
  }
}

export async function downloadFullBackup(data) {
  const XLSX = await import('xlsx')
  const createdAt = new Date()
  const { workbook, counts } = buildFullBackupWorkbook(XLSX, data, createdAt)
  const timestamp = createdAt.toISOString().replace(/[:.]/g, '-')
  XLSX.writeFileXLSX(workbook, `hassan-enterprises-backup-${timestamp}.xlsx`, {
    compression: true,
    cellDates: true,
  })

  return counts
}
