import { useEffect, useMemo, useState } from 'react'
import {
  ArrowDownLeft, ArrowRight, ArrowUpRight, Banknote, BarChart3, BookOpen,
  Boxes, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, CircleDollarSign,
  Download, Edit3, Eye, EyeOff, FileText, LayoutDashboard, LogOut, Menu, Moon,
  MoreHorizontal, Package, Plus, Search, Settings, Sun, Trash2, Truck, UserRound,
  WalletCards, X,
} from 'lucide-react'
import { currency, downloadCsv, formatDate, today } from './lib/format'
import { PRODUCT_OPTIONS } from './lib/products'
import { dataService } from './lib/store'
import { isSupabaseConfigured, supabase } from './lib/supabase'

const navItems = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'trucks', label: 'Truck Entries', icon: Truck },
  { id: 'salesman', label: 'Salesman Account', icon: UserRound },
  { id: 'cashbook', label: 'Personal Cash Book', icon: BookOpen },
]

const AUTH_TIMEOUT_MS = 10000
const amountToneClasses = {
  blue: 'text-blue-700 dark:text-blue-300',
  green: 'text-emerald-700 dark:text-emerald-300',
  red: 'text-red-600 dark:text-red-300',
  amber: 'text-amber-700 dark:text-amber-300',
  violet: 'text-violet-700 dark:text-violet-300',
}
const authRequest = async (request) => {
  let timeoutId
  try {
    return await Promise.race([
      request,
      new Promise((_, reject) => {
        timeoutId = window.setTimeout(
          () => reject(new Error('Authentication timed out. Check your internet connection and try again.')),
          AUTH_TIMEOUT_MS,
        )
      }),
    ])
  } finally {
    window.clearTimeout(timeoutId)
  }
}

const emptyProduct = () => ({ _key: crypto.randomUUID(), product_name: '', quantity: '', purchase_rate: '', sale_rate: '' })
const emptyTruck = () => ({ truck_number: '', entry_date: today(), products: [emptyProduct()] })

function App() {
  const [session, setSession] = useState(null)
  const [loadingAuth, setLoadingAuth] = useState(isSupabaseConfigured)

  useEffect(() => {
    if (!supabase) return
    const initializeSession = async () => {
      try {
        const { data, error } = await authRequest(supabase.auth.getSession())
        if (error || !data.session) {
          setSession(null)
          return
        }
        const { data: userData, error: userError } = await authRequest(supabase.auth.getUser())
        if (userError || !userData.user) {
          setSession(null)
          supabase.auth.signOut({ scope: 'local' })
          return
        }
        setSession(data.session)
      } catch {
        setSession(null)
      } finally {
        setLoadingAuth(false)
      }
    }
    initializeSession()
    const { data } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setLoadingAuth(false)
    })
    return () => data.subscription.unsubscribe()
  }, [])

  const logout = async () => {
    setSession(null)
    try {
      await authRequest(supabase.auth.signOut({ scope: 'local' }))
    } catch {
      // The local UI is already signed out; a fresh tab will require authentication.
    }
  }

  if (loadingAuth) return <Splash />
  if (isSupabaseConfigured && !session) return <Login />
  return <Workspace session={session} onLogout={session ? logout : null} />
}

function Splash() {
  return <div className="grid min-h-screen place-items-center bg-canvas dark:bg-slate-950"><div className="h-10 w-10 animate-spin rounded-full border-4 border-brand-100 border-t-brand-600" /></div>
}

function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const submit = async (event) => {
    event.preventDefault()
    setBusy(true)
    setError('')
    try {
      const { error: authError } = await authRequest(supabase.auth.signInWithPassword({ email, password }))
      if (authError) throw authError
    } catch (err) {
      setError(err.message || 'Unable to sign in. Please try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="relative grid min-h-screen place-items-center overflow-hidden bg-[#f5f8f6] p-5 dark:bg-slate-950">
      <div className="absolute left-[-8rem] top-[-8rem] h-96 w-96 rounded-full bg-brand-100/60 blur-3xl dark:bg-brand-900/20" />
      <div className="relative w-full max-w-md rounded-[2rem] border border-white bg-white/90 p-8 shadow-card backdrop-blur dark:border-slate-800 dark:bg-slate-900/90">
        <Brand />
        <div className="mt-10">
          <p className="eyebrow">Secure admin portal</p>
          <h1 className="mt-2 font-display text-3xl font-bold text-ink dark:text-white">Welcome back</h1>
          <p className="mt-2 text-sm text-muted">Sign in to manage trucks, collections, and cash.</p>
        </div>
        <form onSubmit={submit} className="mt-8 space-y-4">
          <Field label="Email address" type="email" value={email} onChange={setEmail} placeholder="admin@company.com" required />
          <div className="relative">
            <Field label="Password" type={show ? 'text' : 'password'} value={password} onChange={setPassword} placeholder="Enter password" required />
            <button type="button" onClick={() => setShow(!show)} className="absolute bottom-3 right-3 text-muted">{show ? <EyeOff size={18} /> : <Eye size={18} />}</button>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <button disabled={busy} className="btn-primary w-full justify-center">{busy ? 'Signing in...' : 'Sign in'} <ArrowRight size={18} /></button>
        </form>
      </div>
    </main>
  )
}

function Workspace({ session, onLogout }) {
  const [page, setPage] = useState('dashboard')
  const [data, setData] = useState({ trucks: [], cashCollections: [], cashBook: [] })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [sidebar, setSidebar] = useState(false)
  const [dark, setDark] = useState(() => localStorage.getItem('theme') === 'dark')

  const load = async ({ showLoader = true } = {}) => {
    try {
      if (showLoader) setLoading(true)
      setData(await dataService.load())
      setError('')
    } catch (err) {
      setError(err.message || 'Unable to load data. Please try again.')
    } finally {
      if (showLoader) setLoading(false)
    }
  }

  useEffect(() => { load() }, [])
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark)
    localStorage.setItem('theme', dark ? 'dark' : 'light')
  }, [dark])

  const navigate = (id) => {
    setPage(id)
    setSidebar(false)
  }

  return (
    <div className="min-h-screen bg-canvas text-ink dark:bg-slate-950 dark:text-slate-100">
      <Sidebar page={page} navigate={navigate} open={sidebar} close={() => setSidebar(false)} onLogout={onLogout} />
      <div className="lg:pl-[252px]">
        <header className="sticky top-0 z-30 flex h-[76px] items-center justify-between border-b border-slate-200/70 bg-white/90 px-4 backdrop-blur md:px-8 dark:border-slate-800 dark:bg-slate-950/90">
          <div className="flex items-center gap-3">
            <button className="icon-button lg:hidden" onClick={() => setSidebar(true)}><Menu size={21} /></button>
            <div>
              <h1 className="font-display text-lg font-bold md:text-xl">{navItems.find((item) => item.id === page)?.label}</h1>
              <p className="hidden text-xs text-muted sm:block">Friday, 12 June 2026</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {!isSupabaseConfigured && <span className="hidden rounded-full bg-amber-50 px-3 py-1.5 text-xs font-semibold text-amber-700 md:block dark:bg-amber-950 dark:text-amber-300">Demo data</span>}
            <button className="icon-button" onClick={() => setDark(!dark)} aria-label="Toggle theme">{dark ? <Sun size={19} /> : <Moon size={19} />}</button>
            <div className="ml-1 flex h-10 w-10 items-center justify-center rounded-full bg-brand-100 text-sm font-bold text-brand-700 dark:bg-brand-900 dark:text-brand-100">
              {session?.user?.email?.slice(0, 2).toUpperCase() || 'AK'}
            </div>
          </div>
        </header>
        <main className="p-4 md:p-8">
          {error && <div className="mb-5 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
          {loading ? <PageLoader /> : (
            <>
              {page === 'dashboard' && <Dashboard data={data} navigate={navigate} />}
              {page === 'trucks' && <Trucks data={data} reload={() => load({ showLoader: false })} />}
              {page === 'salesman' && <Salesman data={data} reload={() => load({ showLoader: false })} />}
              {page === 'cashbook' && <CashBook data={data} reload={() => load({ showLoader: false })} />}
            </>
          )}
        </main>
      </div>
    </div>
  )
}

function Brand() {
  return (
    <div className="flex items-center gap-3">
      <div className="grid h-11 w-11 place-items-center rounded-xl bg-brand-600 text-white shadow-lg shadow-brand-600/20"><Truck size={23} strokeWidth={2.3} /></div>
      <div><div className="font-display text-lg font-extrabold tracking-tight text-ink dark:text-white">HASSAN ENTERPRISES</div><div className="text-[10px] font-semibold uppercase tracking-[.18em] text-muted">Truck & Cash</div></div>
    </div>
  )
}

function Sidebar({ page, navigate, open, close, onLogout }) {
  return (
    <>
      {open && <button onClick={close} className="fixed inset-0 z-40 bg-slate-950/40 backdrop-blur-sm lg:hidden" />}
      <aside className={`fixed inset-y-0 left-0 z-50 flex w-[252px] flex-col border-r border-slate-200 bg-white p-5 transition-transform dark:border-slate-800 dark:bg-slate-900 ${open ? 'translate-x-0' : '-translate-x-full lg:translate-x-0'}`}>
        <div className="flex items-center justify-between"><Brand /><button className="icon-button lg:hidden" onClick={close}><X size={19} /></button></div>
        <nav className="mt-10 flex-1 space-y-1.5">
          <p className="mb-3 px-3 text-[10px] font-bold uppercase tracking-[.18em] text-slate-400">Workspace</p>
          {navItems.map((item) => <NavButton key={item.id} item={item} active={page === item.id} onClick={() => navigate(item.id)} />)}
          <p className="mb-3 mt-8 px-3 text-[10px] font-bold uppercase tracking-[.18em] text-slate-400">System</p>
          <NavButton item={{ label: 'Settings', icon: Settings }} />
        </nav>
        <div className="rounded-2xl bg-slate-50 p-3 dark:bg-slate-800/80">
          <div className="flex items-center gap-3">
            <div className="grid h-9 w-9 place-items-center rounded-full bg-brand-100 text-xs font-bold text-brand-700 dark:bg-brand-900 dark:text-brand-100">AK</div>
            <div className="min-w-0 flex-1"><p className="truncate text-sm font-semibold">Admin User</p><p className="truncate text-[11px] text-muted">Administrator</p></div>
            {onLogout && <button onClick={onLogout} className="text-slate-400 hover:text-red-600" title="Sign out"><LogOut size={17} /></button>}
          </div>
        </div>
      </aside>
    </>
  )
}

function NavButton({ item, active, onClick }) {
  const Icon = item.icon
  return <button onClick={onClick} className={`flex w-full items-center gap-3 rounded-xl px-3 py-3 text-sm font-semibold transition ${active ? 'bg-brand-50 text-brand-700 dark:bg-brand-900/40 dark:text-brand-100' : 'text-slate-500 hover:bg-slate-50 hover:text-ink dark:text-slate-400 dark:hover:bg-slate-800 dark:hover:text-white'}`}><Icon size={19} /><span>{item.label}</span>{active && <span className="ml-auto h-1.5 w-1.5 rounded-full bg-brand-600" />}</button>
}

function Dashboard({ data, navigate }) {
  const metrics = useMetrics(data)
  const recent = [...data.trucks].sort((a, b) => b.entry_date.localeCompare(a.entry_date)).slice(0, 4)

  return (
    <div className="space-y-6">
      <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><p className="eyebrow">Business overview</p><h2 className="mt-1 font-display text-2xl font-bold md:text-3xl">Good morning, Admin</h2><p className="mt-1 text-sm text-muted">Here is how your business is moving today.</p></div>
        <button onClick={() => navigate('trucks')} className="btn-primary self-start"><Plus size={18} /> Add truck entry</button>
      </section>
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Total Trucks" value={metrics.totalTrucks} note="All truck entries" icon={Truck} tone="green" />
        <MetricCard label="Total Sale Value" value={currency(metrics.totalSale)} note="Across all trucks" icon={CircleDollarSign} tone="blue" />
        <MetricCard label="Total Profit" value={currency(metrics.totalProfit)} note={`${metrics.margin.toFixed(1)}% net margin`} icon={BarChart3} tone="violet" />
        <MetricCard label="Outstanding" value={currency(metrics.outstanding)} note="With salesman" icon={WalletCards} tone="amber" />
      </section>
      <section className="grid gap-6 xl:grid-cols-[1.6fr_1fr]">
        <div className="card overflow-hidden">
          <div className="flex items-center justify-between p-5 md:px-6"><div><h3 className="card-title">Recent truck entries</h3><p className="card-subtitle">Latest inventory arrivals</p></div><button onClick={() => navigate('trucks')} className="text-sm font-semibold text-brand-600">View all</button></div>
          <div className="table-scroll"><table><thead><tr><th>Truck</th><th>Date</th><th>Products</th><th>Sale value</th><th>Profit</th></tr></thead><tbody>
            {recent.map((truck) => <tr key={truck.id}><td><div className="flex items-center gap-3"><span className="grid h-9 w-9 place-items-center rounded-lg bg-slate-100 text-slate-600 dark:bg-slate-800"><Truck size={17} /></span><span className="font-semibold">{truck.truck_number}</span></div></td><td>{formatDate(truck.entry_date)}</td><td>{truck.products.length}</td><td className="font-bold text-blue-700 dark:text-blue-300">{currency(truck.total_sale)}</td><td><span className="badge badge-green">{currency(truck.profit)}</span></td></tr>)}
          </tbody></table></div>
        </div>
        <div className="card p-5 md:p-6">
          <div className="flex items-center justify-between"><div><h3 className="card-title">Cash position</h3><p className="card-subtitle">Available balances</p></div><Banknote className="text-brand-600" size={22} /></div>
          <div className="mt-6 space-y-4">
            <CashSummary label="Personal cash balance" value={metrics.personalBalance} tone={metrics.personalBalance < 0 ? 'red' : 'violet'} />
            <CashSummary label="Total cash in" value={metrics.cashIn} tone="green" />
            <CashSummary label="Total cash out" value={metrics.cashOut} tone="red" />
          </div>
          <button onClick={() => navigate('cashbook')} className="mt-5 flex w-full items-center justify-center gap-2 text-sm font-semibold text-brand-600">View cash book <ArrowRight size={16} /></button>
        </div>
      </section>
    </div>
  )
}

function MetricCard({ label, value, note, icon: Icon, tone }) {
  return <div className="card p-5"><div className="flex items-start justify-between"><div><p className="text-xs font-semibold text-muted">{label}</p><p className={`mt-2 font-display text-2xl font-extrabold ${amountToneClasses[tone] || ''}`}>{value}</p></div><span className={`metric-icon metric-${tone}`}><Icon size={20} /></span></div><p className="mt-4 text-[11px] text-muted">{note}</p></div>
}

function CashSummary({ label, value, tone }) {
  return <div className="flex items-center justify-between border-b border-slate-100 pb-4 last:border-0 last:pb-0 dark:border-slate-800"><span className="text-sm text-muted">{label}</span><strong className={`rounded-lg px-2.5 py-1 text-sm ${amountToneClasses[tone] || ''}`}>{currency(value)}</strong></div>
}

function Trucks({ data, reload }) {
  const [query, setQuery] = useState('')
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const metrics = useMetrics(data)
  const filtered = data.trucks.filter((truck) => truck.truck_number.toLowerCase().includes(query.toLowerCase()))

  const edit = (truck) => { setEditing(truck); setFormOpen(true) }
  const remove = async () => {
    await dataService.deleteTruck(deleting.id)
    setDeleting(null)
    reload()
  }

  return (
    <div className="space-y-6">
      <PageHeading eyebrow="Inventory management" title="Truck entries" description="Manage incoming stock and product-level values.">
        <button onClick={() => { setEditing(null); setFormOpen(true) }} className="btn-primary"><Plus size={18} /> New truck entry</button>
      </PageHeading>
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Total Purchase Value" value={currency(metrics.totalPurchase)} note="All inventory purchased" icon={Package} tone="blue" />
        <MetricCard label="Total Sale Value" value={currency(metrics.totalSale)} note="Potential sales value" icon={CircleDollarSign} tone="green" />
        <MetricCard label="Expected Profit" value={currency(metrics.totalProfit)} note={`${metrics.margin.toFixed(1)}% average margin`} icon={BarChart3} tone="violet" />
      </div>
      <div className="card overflow-hidden">
        <Toolbar query={query} setQuery={setQuery} placeholder="Search truck number..." onExport={() => downloadCsv('truck-entries.csv', filtered.map((t) => ({ truck_number: t.truck_number, date: t.entry_date, purchase_value: t.total_purchase, sale_value: t.total_sale, profit: t.profit })))} />
        <div className="table-scroll"><table><thead><tr><th>Truck number</th><th>Entry date</th><th>Products</th><th>Purchase</th><th>Sale</th><th>Profit</th><th></th></tr></thead><tbody>
          {filtered.map((truck) => <tr key={truck.id}><td className="font-semibold">{truck.truck_number}</td><td>{formatDate(truck.entry_date)}</td><td><span className="badge badge-slate">{truck.products.length} item{truck.products.length !== 1 && 's'}</span></td><td className="font-semibold text-amber-700 dark:text-amber-300">{currency(truck.total_purchase)}</td><td className="font-bold text-blue-700 dark:text-blue-300">{currency(truck.total_sale)}</td><td><span className="badge badge-green">{currency(truck.profit)}</span></td><td><RowActions onEdit={() => edit(truck)} onDelete={() => setDeleting(truck)} /></td></tr>)}
        </tbody></table></div>
        <TableFooter count={filtered.length} />
      </div>
      {formOpen && <TruckForm initial={editing} onClose={() => setFormOpen(false)} onSaved={() => { setFormOpen(false); reload() }} />}
      {deleting && <Confirm title="Delete truck entry?" text={`${deleting.truck_number} and all its product rows will be permanently removed.`} onCancel={() => setDeleting(null)} onConfirm={remove} />}
    </div>
  )
}

function TruckForm({ initial, onClose, onSaved }) {
  const [form, setForm] = useState(initial ? { ...initial, products: initial.products.map((p) => ({ ...p, _key: String(p.id) })) } : emptyTruck())
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const totals = useMemo(() => {
    const purchase = form.products.reduce((sum, p) => sum + Number(p.quantity || 0) * Number(p.purchase_rate || 0), 0)
    const sale = form.products.reduce((sum, p) => sum + Number(p.quantity || 0) * Number(p.sale_rate || 0), 0)
    return { purchase, sale, profit: sale - purchase }
  }, [form.products])
  const set = (key, value) => setForm((current) => ({ ...current, [key]: value }))
  const setProduct = (productKey, key, value) => setForm((current) => ({ ...current, products: current.products.map((p) => p._key === productKey ? { ...p, [key]: value } : p) }))
  const submit = async (event) => {
    event.preventDefault()
    if (form.products.some((p) => !p.product_name || Number(p.quantity) <= 0 || Number(p.purchase_rate) < 0 || Number(p.sale_rate) < 0)) {
      setError('Complete every product row with valid positive values.')
      return
    }
    setSaving(true)
    setError('')
    try {
      await dataService.saveTruck(form)
      onSaved()
    } catch (err) {
      setError(err.message || 'Unable to save the truck entry. Please try again.')
    } finally {
      setSaving(false)
    }
  }
  return (
    <Modal wide title={initial ? 'Edit truck entry' : 'New truck entry'} subtitle="Add truck details and all products carried." onClose={onClose}>
      <form onSubmit={submit}>
        <div className="grid gap-4 md:grid-cols-2">
          <Field label="Truck number" value={form.truck_number} onChange={(v) => set('truck_number', v.toUpperCase())} placeholder="e.g. JY-7842" required />
          <Field label="Entry date" type="date" value={form.entry_date} onChange={(v) => set('entry_date', v)} required />
        </div>
        <div className="mt-7 flex items-center justify-between"><div><h4 className="font-display font-bold">Products</h4><p className="text-xs text-muted">Select one or more products carried in this truck.</p></div><button type="button" onClick={() => setForm((f) => ({ ...f, products: [...f.products, emptyProduct()] }))} className="btn-secondary btn-small"><Plus size={15} /> Add row</button></div>
        <div className="mt-4 space-y-3">
          {form.products.map((p, index) => {
            const purchase = Number(p.quantity || 0) * Number(p.purchase_rate || 0)
            const sale = Number(p.quantity || 0) * Number(p.sale_rate || 0)
            return <div key={p._key} className="rounded-2xl border border-slate-200 bg-slate-50/60 p-4 dark:border-slate-700 dark:bg-slate-800/40">
              <div className="mb-3 flex items-center justify-between"><span className="text-xs font-bold uppercase tracking-wider text-muted">Product {index + 1}</span>{form.products.length > 1 && <button type="button" onClick={() => setForm((f) => ({ ...f, products: f.products.filter((row) => row._key !== p._key) }))} className="text-slate-400 hover:text-red-600"><Trash2 size={16} /></button>}</div>
              <div className="grid gap-3 md:grid-cols-4">
                <ProductSearchField label="Product name" value={p.product_name} onChange={(v) => setProduct(p._key, 'product_name', v)} options={PRODUCT_OPTIONS} placeholder="Type to search products" required />
                <Field label="Quantity" type="number" value={p.quantity} onChange={(v) => setProduct(p._key, 'quantity', v)} placeholder="0" required min="1" step="1" />
                <Field label="Purchase rate" type="number" value={p.purchase_rate} onChange={(v) => setProduct(p._key, 'purchase_rate', v)} placeholder="Rs 0" required min="0" step="1" />
                <Field label="Sale rate" type="number" value={p.sale_rate} onChange={(v) => setProduct(p._key, 'sale_rate', v)} placeholder="Rs 0" required min="0" step="1" />
              </div>
              <div className="mt-3 flex gap-6 border-t border-slate-200 pt-3 text-xs dark:border-slate-700"><span className="text-muted">Purchase amount <strong className="ml-1 text-amber-700 dark:text-amber-300">{currency(purchase)}</strong></span><span className="text-muted">Sale amount <strong className="ml-1 text-blue-700 dark:text-blue-300">{currency(sale)}</strong></span></div>
            </div>
          })}
        </div>
        <div className="mt-5 grid gap-3 rounded-2xl bg-brand-50 p-4 sm:grid-cols-3 dark:bg-brand-900/30">
          <Total label="Total Purchase" value={totals.purchase} tone="amber" /><Total label="Total Sale" value={totals.sale} tone="blue" /><Total label="Expected Profit" value={totals.profit} tone={totals.profit < 0 ? 'red' : 'green'} />
        </div>
        {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
        <ModalActions onClose={onClose} saving={saving} label={initial ? 'Save changes' : 'Save truck entry'} />
      </form>
    </Modal>
  )
}

function Salesman({ data, reload }) {
  const [formOpen, setFormOpen] = useState(false)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [query, setQuery] = useState('')
  const metrics = useMetrics(data)
  const ledger = useLedger(data).filter((row) => `${row.description} ${row.type}`.toLowerCase().includes(query.toLowerCase()))
  const save = async (record) => {
    await dataService.saveCollection(record)
    setFormOpen(false)
    setEditing(null)
    reload()
  }
  const remove = async () => {
    await dataService.deleteCollection(deleting.id)
    setDeleting(null)
    reload()
  }

  return (
    <div className="space-y-6">
      <PageHeading eyebrow="Running account" title="Salesman account" description="Track truck values and every cash collection."><button onClick={() => setFormOpen(true)} className="btn-primary"><Plus size={18} /> Receive cash</button></PageHeading>
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Total Truck Amount Added" value={currency(metrics.totalSale)} note={`${metrics.totalTrucks} truck entries`} icon={Truck} tone="blue" />
        <MetricCard label="Total Cash Received" value={currency(metrics.totalCollections)} note={`${data.cashCollections.length} collections`} icon={ArrowDownLeft} tone="green" />
        <MetricCard label="Outstanding Balance" value={currency(metrics.outstanding)} note="Currently with salesman" icon={WalletCards} tone="amber" />
      </div>
      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 p-5 dark:border-slate-800"><h3 className="card-title">Account ledger</h3><p className="card-subtitle">A chronological record of all debits and credits.</p></div>
        <Toolbar query={query} setQuery={setQuery} placeholder="Search ledger..." onExport={() => downloadCsv('salesman-ledger.csv', ledger)} />
        <div className="table-scroll"><table><thead><tr><th>Date</th><th>Transaction type</th><th>Description</th><th>Debit</th><th>Credit</th><th>Running balance</th><th></th></tr></thead><tbody>
          {ledger.map((row) => <tr key={`${row.type}-${row.id}`}><td>{formatDate(row.date)}</td><td><span className={`badge ${row.type === 'Truck Entry' ? 'badge-blue' : 'badge-green'}`}>{row.type}</span></td><td>{row.description}</td><td className="font-bold text-blue-700 dark:text-blue-300">{row.debit ? currency(row.debit) : '—'}</td><td className="font-bold text-emerald-700 dark:text-emerald-300">{row.credit ? currency(row.credit) : '—'}</td><td className={`font-extrabold ${row.balance > 0 ? amountToneClasses.amber : amountToneClasses.green}`}>{currency(row.balance)}</td><td>{row.type === 'Cash Received' && <RowActions onEdit={() => { setEditing(data.cashCollections.find((c) => c.id === row.id)); setFormOpen(true) }} onDelete={() => setDeleting(data.cashCollections.find((c) => c.id === row.id))} />}</td></tr>)}
        </tbody></table></div><TableFooter count={ledger.length} />
      </div>
      {formOpen && <SimpleEntry title={editing ? 'Edit cash collection' : 'Cash collection'} subtitle="Record cash received from the salesman." initial={editing} dateKey="collection_date" onClose={() => { setFormOpen(false); setEditing(null) }} onSave={save} />}
      {deleting && <Confirm title="Delete cash collection?" text="This will increase the salesman outstanding balance." onCancel={() => setDeleting(null)} onConfirm={remove} />}
    </div>
  )
}

function CashBook({ data, reload }) {
  const [type, setType] = useState(null)
  const [editing, setEditing] = useState(null)
  const [deleting, setDeleting] = useState(null)
  const [query, setQuery] = useState('')
  const metrics = useMetrics(data)
  const rows = [...data.cashBook].sort((a, b) => b.transaction_date.localeCompare(a.transaction_date)).filter((row) => row.description.toLowerCase().includes(query.toLowerCase()))
  const save = async (record) => {
    await dataService.saveCashBook({ ...record, type: editing?.type || type })
    setType(null)
    setEditing(null)
    reload()
  }
  const remove = async () => {
    await dataService.deleteCashBook(deleting.id)
    setDeleting(null)
    reload()
  }
  return (
    <div className="space-y-6">
      <PageHeading eyebrow="Owner's independent account" title="Personal cash book" description="Track personal and business cash movement separately.">
        <div className="flex gap-2"><button onClick={() => setType('out')} className="btn-secondary"><ArrowUpRight size={17} /> Cash out</button><button onClick={() => setType('in')} className="btn-primary"><ArrowDownLeft size={17} /> Cash in</button></div>
      </PageHeading>
      <div className="grid gap-4 sm:grid-cols-3">
        <MetricCard label="Total Cash In" value={currency(metrics.cashIn)} note="All incoming cash" icon={ArrowDownLeft} tone="green" />
        <MetricCard label="Total Cash Out" value={currency(metrics.cashOut)} note="All outgoing cash" icon={ArrowUpRight} tone="red" />
        <MetricCard label="Current Cash Balance" value={currency(metrics.personalBalance)} note="Available personal cash" icon={Banknote} tone={metrics.personalBalance < 0 ? 'red' : 'violet'} />
      </div>
      <div className="card overflow-hidden">
        <div className="border-b border-slate-100 p-5 dark:border-slate-800"><h3 className="card-title">Cash book transactions</h3><p className="card-subtitle">Cash in and cash out history.</p></div>
        <Toolbar query={query} setQuery={setQuery} placeholder="Search descriptions..." onExport={() => downloadCsv('personal-cash-book.csv', rows)} />
        <div className="table-scroll"><table><thead><tr><th>Date</th><th>Type</th><th>Description</th><th>Cash in</th><th>Cash out</th><th></th></tr></thead><tbody>
          {rows.map((row) => <tr key={row.id}><td>{formatDate(row.transaction_date)}</td><td><span className={`badge ${row.type === 'in' ? 'badge-green' : 'badge-red'}`}>{row.type === 'in' ? 'Cash In' : 'Cash Out'}</span></td><td>{row.description}</td><td className="font-semibold text-brand-600">{row.type === 'in' ? currency(row.amount) : '—'}</td><td className="font-semibold text-red-500">{row.type === 'out' ? currency(row.amount) : '—'}</td><td><RowActions onEdit={() => { setEditing(row); setType(row.type) }} onDelete={() => setDeleting(row)} /></td></tr>)}
        </tbody></table></div><TableFooter count={rows.length} />
      </div>
      {type && <SimpleEntry title={editing ? `Edit cash ${type}` : `Cash ${type}`} subtitle={type === 'in' ? 'Record money added to personal cash.' : 'Record a personal or business payment.'} initial={editing} dateKey="transaction_date" onClose={() => { setType(null); setEditing(null) }} onSave={save} />}
      {deleting && <Confirm title="Delete cash book entry?" text="This transaction will be permanently removed from the personal cash book." onCancel={() => setDeleting(null)} onConfirm={remove} />}
    </div>
  )
}

function SimpleEntry({ title, subtitle, initial, dateKey, onClose, onSave }) {
  const [form, setForm] = useState(initial || { [dateKey]: today(), amount: '', description: '' })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const submit = async (event) => {
    event.preventDefault()
    setSaving(true)
    setError('')
    try {
      await onSave(form)
    } catch (err) {
      setError(err.message || 'Unable to save this transaction. Please try again.')
    } finally {
      setSaving(false)
    }
  }
  return <Modal title={title} subtitle={subtitle} onClose={onClose}><form onSubmit={submit}>
    <div className="space-y-4"><Field label="Date" type="date" value={form[dateKey]} onChange={(v) => setForm({ ...form, [dateKey]: v })} required /><Field label="Amount received (Rs)" type="number" value={form.amount} onChange={(v) => setForm({ ...form, amount: Number(v) })} placeholder="0" min="1" required /><Field label="Description" value={form.description} onChange={(v) => setForm({ ...form, description: v })} placeholder="Add a clear description" required /></div>
    {error && <p className="mt-3 text-sm text-red-600">{error}</p>}
    <ModalActions onClose={onClose} saving={saving} label="Save transaction" />
  </form></Modal>
}

function PageHeading({ eyebrow, title, description, children }) {
  return <section className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow">{eyebrow}</p><h2 className="mt-1 font-display text-2xl font-bold md:text-3xl">{title}</h2><p className="mt-1 text-sm text-muted">{description}</p></div><div className="flex flex-wrap gap-2">{children}</div></section>
}

function Toolbar({ query, setQuery, placeholder, onExport }) {
  return <div className="flex flex-col justify-between gap-3 border-b border-slate-100 p-4 sm:flex-row sm:items-center dark:border-slate-800"><div className="relative w-full max-w-sm"><Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={17} /><input value={query} onChange={(e) => setQuery(e.target.value)} className="input pl-10" placeholder={placeholder} /></div><div className="flex gap-2"><button className="btn-secondary btn-small"><CalendarDays size={15} /> All dates <ChevronDown size={14} /></button><button onClick={onExport} className="btn-secondary btn-small"><Download size={15} /> Export CSV</button></div></div>
}

function RowActions({ onEdit, onDelete }) {
  return <div className="flex items-center justify-end gap-1"><button onClick={onEdit} className="table-action" title="Edit"><Edit3 size={15} /></button><button onClick={onDelete} className="table-action hover:text-red-600" title="Delete"><Trash2 size={15} /></button><button className="table-action"><MoreHorizontal size={16} /></button></div>
}

function TableFooter({ count }) {
  return <div className="flex items-center justify-between border-t border-slate-100 px-5 py-4 text-xs text-muted dark:border-slate-800"><span>Showing {count} record{count !== 1 && 's'}</span><div className="flex gap-1"><button className="pagination"><ChevronLeft size={14} /></button><button className="pagination bg-brand-600 text-white">1</button><button className="pagination"><ChevronRight size={14} /></button></div></div>
}

function Field({ label, value, onChange, type = 'text', ...props }) {
  return <label className="block"><span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</span><input type={type} value={value} onChange={(e) => onChange(e.target.value)} className="input" {...props} /></label>
}

function ProductSearchField({ label, value, onChange, options, placeholder, ...props }) {
  const [open, setOpen] = useState(false)
  const query = value.trim().toLowerCase()
  const matches = query
    ? options.filter((option) => option.toLowerCase().includes(query))
    : options

  return (
    <div className="relative">
      <span className="mb-1.5 block text-xs font-semibold text-slate-600 dark:text-slate-300">{label}</span>
      <input
        value={value}
        onChange={(event) => { onChange(event.target.value); setOpen(true) }}
        onFocus={() => setOpen(true)}
        onBlur={() => setOpen(false)}
        className="input pr-9"
        placeholder={placeholder}
        autoComplete="off"
        {...props}
      />
      <Search className="pointer-events-none absolute right-3 top-[2.35rem] text-slate-400" size={16} />
      {open && (
        <div className="absolute z-30 mt-1 max-h-60 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white p-1 shadow-xl dark:border-slate-700 dark:bg-slate-800">
          {matches.length ? matches.map((option) => (
            <button
              key={option}
              type="button"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => { onChange(option); setOpen(false) }}
              className="block w-full rounded-lg px-3 py-2 text-left text-xs font-medium text-slate-700 hover:bg-brand-50 hover:text-brand-700 dark:text-slate-200 dark:hover:bg-slate-700 dark:hover:text-white"
            >
              {option}
            </button>
          )) : <p className="px-3 py-3 text-xs text-muted">No matching product found.</p>}
        </div>
      )}
    </div>
  )
}

function Modal({ title, subtitle, onClose, children, wide = false }) {
  return <div className="fixed inset-0 z-[70] flex items-end justify-center bg-slate-950/45 p-0 backdrop-blur-sm sm:items-center sm:p-5"><div className={`max-h-[94vh] w-full overflow-y-auto rounded-t-[1.75rem] bg-white shadow-2xl sm:rounded-[1.75rem] dark:bg-slate-900 ${wide ? 'max-w-5xl' : 'max-w-lg'}`}><div className="sticky top-0 z-10 flex items-start justify-between border-b border-slate-100 bg-white px-5 py-5 sm:px-7 dark:border-slate-800 dark:bg-slate-900"><div><h3 className="font-display text-xl font-bold">{title}</h3><p className="mt-1 text-xs text-muted">{subtitle}</p></div><button onClick={onClose} className="icon-button"><X size={19} /></button></div><div className="p-5 sm:p-7">{children}</div></div></div>
}

function ModalActions({ onClose, saving, label }) {
  return <div className="mt-7 flex justify-end gap-2 border-t border-slate-100 pt-5 dark:border-slate-800"><button type="button" onClick={onClose} className="btn-secondary">Cancel</button><button disabled={saving} className="btn-primary">{saving ? 'Saving...' : label}</button></div>
}

function Confirm({ title, text, onCancel, onConfirm }) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const confirm = async () => {
    setBusy(true)
    setError('')
    try {
      await onConfirm()
    } catch (err) {
      setError(err.message || 'Unable to delete this record. Please try again.')
      setBusy(false)
    }
  }
  return <div className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/45 p-5 backdrop-blur-sm"><div className="w-full max-w-sm rounded-3xl bg-white p-6 shadow-2xl dark:bg-slate-900"><div className="grid h-11 w-11 place-items-center rounded-xl bg-red-50 text-red-600 dark:bg-red-950"><Trash2 size={20} /></div><h3 className="mt-5 font-display text-xl font-bold">{title}</h3><p className="mt-2 text-sm leading-6 text-muted">{text}</p>{error && <p className="mt-3 text-sm text-red-600">{error}</p>}<div className="mt-6 flex justify-end gap-2"><button disabled={busy} onClick={onCancel} className="btn-secondary">Cancel</button><button disabled={busy} onClick={confirm} className="btn-danger disabled:cursor-not-allowed disabled:opacity-60">{busy ? 'Deleting...' : 'Delete record'}</button></div></div></div>
}

function Total({ label, value, tone }) {
  return <div><p className="text-[11px] font-semibold text-muted">{label}</p><p className={`mt-1 font-display text-lg font-extrabold ${amountToneClasses[tone] || ''}`}>{currency(value)}</p></div>
}

function PageLoader() {
  return <div className="grid min-h-[60vh] place-items-center"><div className="h-9 w-9 animate-spin rounded-full border-4 border-brand-100 border-t-brand-600" /></div>
}

function useMetrics(data) {
  return useMemo(() => {
    const totalPurchase = data.trucks.reduce((sum, t) => sum + t.total_purchase, 0)
    const totalSale = data.trucks.reduce((sum, t) => sum + t.total_sale, 0)
    const totalProfit = totalSale - totalPurchase
    const totalCollections = data.cashCollections.reduce((sum, c) => sum + Number(c.amount), 0)
    const cashIn = data.cashBook.filter((r) => r.type === 'in').reduce((sum, r) => sum + Number(r.amount), 0)
    const cashOut = data.cashBook.filter((r) => r.type === 'out').reduce((sum, r) => sum + Number(r.amount), 0)
    return { totalTrucks: data.trucks.length, totalPurchase, totalSale, totalProfit, margin: totalSale ? totalProfit / totalSale * 100 : 0, totalCollections, outstanding: totalSale - totalCollections, cashIn, cashOut, personalBalance: cashIn - cashOut }
  }, [data])
}

function useLedger(data) {
  return useMemo(() => {
    const rows = [
      ...data.trucks.map((t) => ({ id: t.id, date: t.entry_date, type: 'Truck Entry', description: `Truck ${t.truck_number}`, debit: t.total_sale, credit: 0 })),
      ...data.cashCollections.map((c) => ({ id: c.id, date: c.collection_date, type: 'Cash Received', description: c.description, debit: 0, credit: Number(c.amount) })),
    ].sort((a, b) => a.date.localeCompare(b.date) || b.debit - a.debit)
    let balance = 0
    return rows.map((row) => { balance += row.debit - row.credit; return { ...row, balance } }).reverse()
  }, [data])
}

export default App
