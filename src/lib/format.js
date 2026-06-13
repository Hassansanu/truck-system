export const currency = (value) => {
  const amount = Number(value || 0)
  return `PKR ${new Intl.NumberFormat('en-PK', { maximumFractionDigits: 0 }).format(amount)}`
}

export const formatDate = (date, short = false) =>
  new Intl.DateTimeFormat('en-PK', short
    ? { day: '2-digit', month: 'short' }
    : { day: '2-digit', month: 'short', year: 'numeric' }).format(new Date(`${date}T00:00:00`))

export const today = () => new Date().toISOString().slice(0, 10)

export const downloadCsv = (filename, rows) => {
  if (!rows.length) return
  const columns = Object.keys(rows[0])
  const escape = (value) => `"${String(value ?? '').replaceAll('"', '""')}"`
  const csv = [columns.join(','), ...rows.map((row) => columns.map((column) => escape(row[column])).join(','))].join('\n')
  const link = document.createElement('a')
  link.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }))
  link.download = filename
  link.click()
  URL.revokeObjectURL(link.href)
}
