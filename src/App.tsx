import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, AlertCircle, CheckCircle2, CreditCard, Download, LogOut, MessageSquareWarning, RefreshCcw, Search, ShieldCheck, Users } from 'lucide-react'
import { Badge } from './components/ui/badge'
import { Button } from './components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from './components/ui/card'
import { Input } from './components/ui/input'
import { Label } from './components/ui/label'
import { Textarea } from './components/ui/textarea'

type AccountRole = 'user' | 'admin'
type SubscriptionStatus = 'active' | 'paused' | 'canceled' | 'past_due'
type ComplaintStatus = 'open' | 'in_review' | 'resolved' | 'rejected'

interface SessionResponse {
  session: {
    user: {
      id: string
      provider: string
      role: AccountRole
      email?: string
      name?: string
    }
    signedInAt: string
  }
  accessToken: string
  refreshToken: string
}

interface Plan {
  planId: string
  code: string
  name: string
  amountCents: number
  currency: string
  interval: 'monthly' | 'yearly'
  isActive: boolean
}

interface Subscription {
  subscriptionId: string
  accountId: string
  planId: string
  status: SubscriptionStatus
  currentPeriodStart: string
  currentPeriodEnd: string
}

interface Invoice {
  invoiceId: string
  subscriptionId: string
  accountId: string
  amountDueCents: number
  amountPaidCents: number
  currency: string
  status: 'open' | 'paid' | 'void'
  dueAt: string
  paidAt: string | null
}

interface Complaint {
  complaintId: string
  accountId: string
  subject: string
  message: string
  status: ComplaintStatus
  adminResponse?: string
  updatedAt: string
}

interface ActiveUsersDashboardUser {
  accountId: string
  email: string | null
  name: string | null
  lastActivityAt: string
  lastEventType: 'app_open' | 'session_restored' | 'sign_in' | 'screen_viewed' | 'ride_created' | 'bike_created'
  eventCount: number
  hasActiveSubscription: boolean
  hasCurrentSession: boolean
}

interface ActiveUsersDashboardData {
  generatedAt: string
  periodDays: number
  kpis: {
    activeUsers: number
    totalEvents: number
    activeSubscribers: number
    currentSessions: number
  }
  trend: Array<{
    date: string
    activeUsers: number
    totalEvents: number
  }>
  users: ActiveUsersDashboardUser[]
}

interface ApiFailure {
  error?: {
    message?: string
  }
}

class ApiRequestError extends Error {
  status: number

  constructor(status: number, message: string) {
    super(message)
    this.name = 'ApiRequestError'
    this.status = status
  }
}

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:9000'
const SESSION_STORAGE_KEY = 'bikevital.admin.session'

async function apiRequest<T>(path: string, init: RequestInit = {}, token?: string): Promise<T> {
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(init.headers ?? {}),
    },
  })

  if (!response.ok) {
    let message = `HTTP ${response.status}`
    try {
      const payload = (await response.json()) as ApiFailure
      if (payload.error?.message) {
        message = payload.error.message
      }
    } catch {
      // Ignore body parsing failures and keep generic message.
    }
    throw new ApiRequestError(response.status, message)
  }

  if (response.status === 204) {
    return undefined as T
  }

  return (await response.json()) as T
}

function formatCurrency(amountCents: number, currency: string): string {
  return new Intl.NumberFormat('pt-BR', {
    style: 'currency',
    currency: currency.toUpperCase(),
  }).format(amountCents / 100)
}

function statusBadgeVariant(status: SubscriptionStatus | ComplaintStatus): 'success' | 'warning' | 'danger' | 'info' | 'neutral' {
  if (status === 'active' || status === 'resolved') return 'success'
  if (status === 'past_due' || status === 'in_review') return 'warning'
  if (status === 'canceled' || status === 'rejected') return 'danger'
  if (status === 'paused') return 'info'
  return 'neutral'
}

function activityEventLabel(eventType: ActiveUsersDashboardUser['lastEventType']): string {
  switch (eventType) {
    case 'app_open':
      return 'Abertura do app'
    case 'session_restored':
      return 'Sessão restaurada'
    case 'sign_in':
      return 'Login'
    case 'screen_viewed':
      return 'Tela visualizada'
    case 'ride_created':
      return 'Ride criada'
    case 'bike_created':
      return 'Bike criada'
    default:
      return eventType
  }
}

function formatDateTime(value: string): string {
  return new Date(value).toLocaleString('pt-BR')
}

function downloadCsv(filename: string, rows: string[][]): void {
  const csv = rows.map((row) => row.map((cell) => `"${String(cell).replaceAll('"', '""')}"`).join(',')).join('\n')
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  URL.revokeObjectURL(url)
}

function SidebarMenuButton(props: { isActive: boolean; label: string; onClick: () => void }) {
  return (
    <Button
      variant={props.isActive ? 'default' : 'ghost'}
      size="sm"
      onClick={props.onClick}
      className="w-full justify-start"
      type="button"
    >
      {props.label}
    </Button>
  )
}

function App() {
  const [session, setSession] = useState<SessionResponse | null>(null)
  const refreshPromiseRef = useRef<Promise<SessionResponse> | null>(null)
  const [activeTab, setActiveTab] = useState<'billing' | 'password' | 'complaints' | 'active-users'>('billing')
  const [authEmail, setAuthEmail] = useState('')
  const [authPassword, setAuthPassword] = useState('')
  const [authError, setAuthError] = useState<string | null>(null)
  const [authLoading, setAuthLoading] = useState(false)

  const [plans, setPlans] = useState<Plan[]>([])
  const [subscriptions, setSubscriptions] = useState<Subscription[]>([])
  const [invoices, setInvoices] = useState<Invoice[]>([])
  const [complaints, setComplaints] = useState<Complaint[]>([])
  const [loadingAdminData, setLoadingAdminData] = useState(false)
  const [feedbackMessage, setFeedbackMessage] = useState<string | null>(null)
  const [errorMessage, setErrorMessage] = useState<string | null>(null)

  const [newPlan, setNewPlan] = useState({
    code: '',
    name: '',
    amountCents: '2990',
    currency: 'BRL',
    interval: 'monthly' as 'monthly' | 'yearly',
  })

  const [forgotEmail, setForgotEmail] = useState('')
  const [forgotResult, setForgotResult] = useState<string | null>(null)
  const [resetForm, setResetForm] = useState({
    email: '',
    token: '',
    newPassword: '',
  })

  const [complaintDrafts, setComplaintDrafts] = useState<Record<string, { status: ComplaintStatus; adminResponse: string }>>({})
  const [activeUsersDashboard, setActiveUsersDashboard] = useState<ActiveUsersDashboardData | null>(null)
  const [loadingActiveUsersDashboard, setLoadingActiveUsersDashboard] = useState(false)
  const [activityWindowDays, setActivityWindowDays] = useState<7 | 30 | 90>(30)
  const [activeUsersSearch, setActiveUsersSearch] = useState('')
  const [onlySubscribers, setOnlySubscribers] = useState(false)
  const [onlyCurrentSessions, setOnlyCurrentSessions] = useState(false)
  const [autoRefreshDashboard, setAutoRefreshDashboard] = useState(true)
  const [selectedActiveUserId, setSelectedActiveUserId] = useState<string | null>(null)

  const token = session?.accessToken

  const summary = useMemo(() => {
    return {
      plans: plans.length,
      subscriptions: subscriptions.length,
      invoicesOpen: invoices.filter((invoice) => invoice.status === 'open').length,
      complaintsOpen: complaints.filter((complaint) => complaint.status === 'open').length,
    }
  }, [plans, subscriptions, invoices, complaints])

  useEffect(() => {
    const raw = localStorage.getItem(SESSION_STORAGE_KEY)
    if (!raw) {
      return
    }

    try {
      const parsed = JSON.parse(raw) as SessionResponse
      setSession(parsed)
    } catch {
      localStorage.removeItem(SESSION_STORAGE_KEY)
    }
  }, [])

  useEffect(() => {
    if (!token) {
      return
    }

    void loadAdminData()
  }, [token])

  function clearAuthenticatedState(message?: string): void {
    setSession(null)
    setPlans([])
    setSubscriptions([])
    setInvoices([])
    setComplaints([])
    setActiveUsersDashboard(null)
    setComplaintDrafts({})
    setLoadingAdminData(false)
    setFeedbackMessage(null)
    setErrorMessage(null)
    localStorage.removeItem(SESSION_STORAGE_KEY)

    if (message) {
      setAuthError(message)
    }
  }

  async function refreshAdminSession(): Promise<SessionResponse> {
    if (refreshPromiseRef.current) {
      return refreshPromiseRef.current
    }

    const refreshToken = session?.refreshToken
    if (!refreshToken) {
      throw new Error('Sessão expirada. Faça login novamente.')
    }

    const refreshPromise = (async () => {
      const refreshed = await apiRequest<SessionResponse>('/v1/auth/refresh', {
        method: 'POST',
        body: JSON.stringify({ refreshToken }),
      })

      if (refreshed.session.user.role !== 'admin') {
        throw new Error('Sessão renovada sem privilégios administrativos.')
      }

      setSession(refreshed)
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(refreshed))
      return refreshed
    })()

    refreshPromiseRef.current = refreshPromise

    try {
      return await refreshPromise
    } finally {
      if (refreshPromiseRef.current === refreshPromise) {
        refreshPromiseRef.current = null
      }
    }
  }

  async function apiRequestWithAdminAuth<T>(path: string, init: RequestInit = {}): Promise<T> {
    if (!session?.accessToken) {
      throw new Error('Sessão administrativa indisponível. Faça login novamente.')
    }

    try {
      return await apiRequest<T>(path, init, session.accessToken)
    } catch (error) {
      if (!(error instanceof ApiRequestError) || error.status !== 401) {
        throw error
      }

      let refreshed: SessionResponse
      try {
        refreshed = await refreshAdminSession()
      } catch {
        clearAuthenticatedState('Sessão expirada. Faça login novamente.')
        throw new Error('Sessão expirada. Faça login novamente.')
      }

      try {
        return await apiRequest<T>(path, init, refreshed.accessToken)
      } catch (retryError) {
        if (retryError instanceof ApiRequestError && retryError.status === 401) {
          clearAuthenticatedState('Sessão expirada. Faça login novamente.')
          throw new Error('Sessão expirada. Faça login novamente.')
        }
        throw retryError
      }
    }
  }

  async function loadAdminData(): Promise<void> {
    setLoadingAdminData(true)
    setErrorMessage(null)

    try {
      const [plansResponse, subscriptionsResponse, invoicesResponse, complaintsResponse] = await Promise.all([
        apiRequestWithAdminAuth<{ plans: Plan[] }>('/v1/admin/plans', { method: 'GET' }),
        apiRequestWithAdminAuth<{ subscriptions: Subscription[] }>('/v1/admin/subscriptions', { method: 'GET' }),
        apiRequestWithAdminAuth<{ invoices: Invoice[] }>('/v1/admin/invoices', { method: 'GET' }),
        apiRequestWithAdminAuth<{ complaints: Complaint[] }>('/v1/admin/complaints', { method: 'GET' }),
      ])

      setPlans(plansResponse.plans)
      setSubscriptions(subscriptionsResponse.subscriptions)
      setInvoices(invoicesResponse.invoices)
      setComplaints(complaintsResponse.complaints)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Falha ao carregar dados administrativos.')
    } finally {
      setLoadingAdminData(false)
    }
  }

  async function loadActiveUsersDashboard(periodDays = activityWindowDays): Promise<void> {
    setLoadingActiveUsersDashboard(true)
    setErrorMessage(null)

    try {
      const dashboard = await apiRequestWithAdminAuth<ActiveUsersDashboardData>(
        `/v1/admin/telemetry/active-users?periodDays=${periodDays}&limit=100`,
        { method: 'GET' },
      )
      setActiveUsersDashboard(dashboard)
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Falha ao carregar dashboard de usuários ativos.')
    } finally {
      setLoadingActiveUsersDashboard(false)
    }
  }

  useEffect(() => {
    if (!token || activeTab !== 'active-users') {
      return
    }

    void loadActiveUsersDashboard(activityWindowDays)
  }, [activeTab, activityWindowDays, token])

  useEffect(() => {
    if (!token || activeTab !== 'active-users' || !autoRefreshDashboard) {
      return
    }

    const timer = window.setInterval(() => {
      void loadActiveUsersDashboard(activityWindowDays)
    }, 30000)

    return () => {
      window.clearInterval(timer)
    }
  }, [activeTab, activityWindowDays, autoRefreshDashboard, token])

  const filteredActiveUsers = useMemo(() => {
    if (!activeUsersDashboard) {
      return []
    }

    const search = activeUsersSearch.trim().toLowerCase()
    return activeUsersDashboard.users.filter((user) => {
      if (onlySubscribers && !user.hasActiveSubscription) {
        return false
      }

      if (onlyCurrentSessions && !user.hasCurrentSession) {
        return false
      }

      if (!search) {
        return true
      }

      return [user.name, user.email, user.accountId, activityEventLabel(user.lastEventType)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(search))
    })
  }, [activeUsersDashboard, activeUsersSearch, onlySubscribers, onlyCurrentSessions])

  const selectedActiveUser = useMemo(() => {
    if (!selectedActiveUserId) {
      return filteredActiveUsers[0] ?? null
    }

    return filteredActiveUsers.find((user) => user.accountId === selectedActiveUserId) ?? filteredActiveUsers[0] ?? null
  }, [filteredActiveUsers, selectedActiveUserId])

  useEffect(() => {
    if (!selectedActiveUser && selectedActiveUserId) {
      setSelectedActiveUserId(null)
    }
  }, [selectedActiveUser, selectedActiveUserId])

  const trendPeak = useMemo(() => {
    if (!activeUsersDashboard) {
      return 1
    }

    return Math.max(1, ...activeUsersDashboard.trend.map((item) => item.activeUsers))
  }, [activeUsersDashboard])

  function handleExportActiveUsersCsv(): void {
    if (!filteredActiveUsers.length) {
      return
    }

    downloadCsv(`bikevital-active-users-${activityWindowDays}d.csv`, [
      ['accountId', 'name', 'email', 'lastActivityAt', 'lastEventType', 'eventCount', 'hasActiveSubscription', 'hasCurrentSession'],
      ...filteredActiveUsers.map((user) => [
        user.accountId,
        user.name ?? '',
        user.email ?? '',
        user.lastActivityAt,
        user.lastEventType,
        String(user.eventCount),
        String(user.hasActiveSubscription),
        String(user.hasCurrentSession),
      ]),
    ])
  }

  async function handleAdminSignIn(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setAuthLoading(true)
    setAuthError(null)

    try {
      const signedIn = await apiRequest<SessionResponse>('/v1/auth/admin/sign-in', {
        method: 'POST',
        body: JSON.stringify({
          email: authEmail,
          password: authPassword,
        }),
      })

      if (signedIn.session.user.role !== 'admin') {
        throw new Error('Usuário autenticado sem role de administrador.')
      }

      setSession(signedIn)
      localStorage.setItem(SESSION_STORAGE_KEY, JSON.stringify(signedIn))
      setAuthPassword('')
    } catch (error) {
      setAuthError(error instanceof Error ? error.message : 'Falha ao autenticar no admin.')
    } finally {
      setAuthLoading(false)
    }
  }

  function handleSignOut(): void {
    setAuthError(null)
    clearAuthenticatedState()
  }

  async function handleCreatePlan(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()

    setErrorMessage(null)
    setFeedbackMessage(null)

    try {
      const created = await apiRequestWithAdminAuth<Plan>(
        '/v1/admin/plans',
        {
          method: 'POST',
          body: JSON.stringify({
            code: newPlan.code.trim(),
            name: newPlan.name.trim(),
            amountCents: Number(newPlan.amountCents),
            currency: newPlan.currency.trim().toUpperCase(),
            interval: newPlan.interval,
          }),
        },
      )

      setPlans((current) => [created, ...current])
      setFeedbackMessage('Plano criado com sucesso.')
      setNewPlan({
        code: '',
        name: '',
        amountCents: '2990',
        currency: 'BRL',
        interval: 'monthly',
      })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Falha ao criar plano.')
    }
  }

  async function handleSubscriptionAction(subscriptionId: string, action: 'renew' | 'cancel' | 'status', status?: SubscriptionStatus): Promise<void> {
    setErrorMessage(null)
    setFeedbackMessage(null)

    try {
      let updated: Subscription
      if (action === 'renew') {
        updated = await apiRequestWithAdminAuth<Subscription>(`/v1/admin/subscriptions/${subscriptionId}/renew`, { method: 'POST' })
      } else if (action === 'cancel') {
        updated = await apiRequestWithAdminAuth<Subscription>(`/v1/admin/subscriptions/${subscriptionId}/cancel`, { method: 'POST' })
      } else {
        updated = await apiRequestWithAdminAuth<Subscription>(
          `/v1/admin/subscriptions/${subscriptionId}/status`,
          {
            method: 'PATCH',
            body: JSON.stringify({ status }),
          },
        )
      }

      setSubscriptions((current) =>
        current.map((subscription) =>
          subscription.subscriptionId === subscriptionId ? updated : subscription,
        ),
      )
      setFeedbackMessage('Subscription atualizada.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Falha ao atualizar subscription.')
    }
  }

  async function handleMarkInvoicePaid(invoiceId: string): Promise<void> {
    setErrorMessage(null)
    setFeedbackMessage(null)
    try {
      const updated = await apiRequestWithAdminAuth<Invoice>(`/v1/admin/invoices/${invoiceId}/mark-paid`, { method: 'POST' })
      setInvoices((current) => current.map((invoice) => (invoice.invoiceId === invoiceId ? updated : invoice)))
      setFeedbackMessage('Invoice marcada como paga.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Falha ao marcar invoice como paga.')
    }
  }

  async function handleForgotPassword(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setErrorMessage(null)
    setForgotResult(null)

    try {
      const response = await apiRequest<{ accepted: boolean; resetToken?: string }>(
        '/v1/auth/email/forgot-password',
        {
          method: 'POST',
          body: JSON.stringify({ email: forgotEmail.trim() }),
        },
      )

      if (response.resetToken) {
        setForgotResult(`Token gerado (ambiente local): ${response.resetToken}`)
      } else {
        setForgotResult('Solicitação aceita. Verifique o canal de recuperação configurado.')
      }
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Falha ao solicitar reset de senha.')
    }
  }

  async function handleResetPassword(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    setErrorMessage(null)
    setFeedbackMessage(null)

    try {
      await apiRequest(
        '/v1/auth/email/reset-password',
        {
          method: 'POST',
          body: JSON.stringify({
            email: resetForm.email.trim(),
            token: resetForm.token.trim(),
            newPassword: resetForm.newPassword,
          }),
        },
      )

      setFeedbackMessage('Senha redefinida com sucesso.')
      setResetForm({ email: '', token: '', newPassword: '' })
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Falha ao redefinir senha.')
    }
  }

  async function handleUpdateComplaint(complaint: Complaint): Promise<void> {
    const draft = complaintDrafts[complaint.complaintId]
    if (!draft) {
      return
    }

    setErrorMessage(null)
    setFeedbackMessage(null)
    try {
      const updated = await apiRequestWithAdminAuth<Complaint>(
        `/v1/admin/complaints/${complaint.complaintId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            status: draft.status,
            adminResponse: draft.adminResponse,
          }),
        },
      )

      setComplaints((current) =>
        current.map((item) => (item.complaintId === complaint.complaintId ? updated : item)),
      )
      setFeedbackMessage('Reclamação atualizada no painel.')
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : 'Falha ao atualizar reclamação.')
    }
  }

  function ensureComplaintDraft(complaint: Complaint): { status: ComplaintStatus; adminResponse: string } {
    return (
      complaintDrafts[complaint.complaintId] ?? {
        status: complaint.status,
        adminResponse: complaint.adminResponse ?? '',
      }
    )
  }

  if (!session) {
    return (
      <main className="min-h-screen bg-[radial-gradient(circle_at_top_left,#dbf5e8_0%,#f4f8fb_40%,#eef2ff_100%)] p-6 md:p-10">
        <div className="mx-auto grid max-w-5xl gap-8 md:grid-cols-[1.2fr_1fr]">
          <Card className="border-emerald-200/80 bg-white/90 backdrop-blur">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-2xl">
                <ShieldCheck className="size-6 text-emerald-600" />
                BikeVital Admin
              </CardTitle>
              <CardDescription>
                Painel administrativo web em React + Vite + shadcn/ui na porta 9001.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4 text-sm text-slate-600">
              <p>Use login administrativo dedicado para acessar subscriptions, pagamentos manuais, reset de senha e fila de reclamações.</p>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="font-medium text-slate-800">URL API</p>
                  <p className="mt-1 text-xs">{API_BASE_URL}</p>
                </div>
                <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                  <p className="font-medium text-slate-800">Modo</p>
                  <p className="mt-1 text-xs">MVP com pagamentos manuais e arquitetura preparada para Stripe</p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="border-slate-200 bg-white/95">
            <CardHeader>
              <CardTitle>Entrar como admin</CardTitle>
              <CardDescription>Autenticação via endpoint /v1/auth/admin/sign-in</CardDescription>
            </CardHeader>
            <CardContent>
              <form className="space-y-4" onSubmit={handleAdminSignIn}>
                <div className="space-y-2">
                  <Label htmlFor="auth-email">Email</Label>
                  <Input
                    id="auth-email"
                    value={authEmail}
                    onChange={(event) => setAuthEmail(event.target.value)}
                    type="email"
                    autoComplete="email"
                    required
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="auth-password">Senha</Label>
                  <Input
                    id="auth-password"
                    value={authPassword}
                    onChange={(event) => setAuthPassword(event.target.value)}
                    type="password"
                    autoComplete="current-password"
                    required
                  />
                </div>
                {authError ? (
                  <div className="rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">{authError}</div>
                ) : null}
                <Button className="w-full" disabled={authLoading} type="submit">
                  {authLoading ? 'Autenticando...' : 'Entrar no painel'}
                </Button>
              </form>
            </CardContent>
          </Card>
        </div>
      </main>
    )
  }

  return (
    <main className="min-h-screen bg-slate-100 pb-10">
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-4 py-4 md:px-8">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-emerald-600">BikeVital Operations</p>
            <h1 className="text-2xl font-semibold text-slate-900">Painel Administrativo</h1>
            <p className="text-sm text-slate-500">Logado como {session.session.user.email ?? session.session.user.id}</p>
          </div>
          <Button variant="outline" onClick={handleSignOut}>
            <LogOut className="mr-2 size-4" />
            Sair
          </Button>
        </div>
      </header>

      <section className="mx-auto mt-6 grid max-w-7xl gap-4 px-4 md:grid-cols-4 md:px-8">
        <Card className="bg-emerald-50 border-emerald-200">
          <CardContent className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-emerald-700">Planos</p>
            <p className="text-2xl font-semibold text-emerald-950">{summary.plans}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-slate-500">Subscriptions</p>
            <p className="text-2xl font-semibold text-slate-900">{summary.subscriptions}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-slate-500">Invoices em aberto</p>
            <p className="text-2xl font-semibold text-slate-900">{summary.invoicesOpen}</p>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="space-y-1">
            <p className="text-xs uppercase tracking-wide text-slate-500">Reclamações abertas</p>
            <p className="text-2xl font-semibold text-slate-900">{summary.complaintsOpen}</p>
          </CardContent>
        </Card>
      </section>

      <section className="mx-auto mt-4 grid max-w-7xl gap-4 px-4 md:grid-cols-[260px_1fr] md:px-8">
        <aside className="space-y-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Menu</CardTitle>
              <CardDescription>Navegue entre as funcionalidades administrativas.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-2">
              <SidebarMenuButton isActive={activeTab === 'billing'} label="Subscriptions & Pagamentos" onClick={() => setActiveTab('billing')} />
              <SidebarMenuButton isActive={activeTab === 'password'} label="Reset de Senha" onClick={() => setActiveTab('password')} />
              <SidebarMenuButton isActive={activeTab === 'complaints'} label="Reclamações" onClick={() => setActiveTab('complaints')} />
              <SidebarMenuButton isActive={activeTab === 'active-users'} label="Usuários Ativos" onClick={() => setActiveTab('active-users')} />
              <Button variant="outline" size="sm" className="w-full justify-start" onClick={() => void loadAdminData()}>
                <RefreshCcw className="mr-2 size-4" />
                Recarregar
              </Button>
            </CardContent>
          </Card>
        </aside>

        <div className="space-y-4">

        {feedbackMessage ? (
          <div className="flex items-center gap-2 rounded-md border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-700">
            <CheckCircle2 className="size-4" />
            {feedbackMessage}
          </div>
        ) : null}

        {errorMessage ? (
          <div className="flex items-center gap-2 rounded-md border border-rose-200 bg-rose-50 p-3 text-sm text-rose-700">
            <AlertCircle className="size-4" />
            {errorMessage}
          </div>
        ) : null}

        {loadingAdminData ? <div className="text-sm text-slate-500">Carregando dados...</div> : null}

        {activeTab === 'billing' ? (
          <div className="grid gap-4 xl:grid-cols-[1fr_1.3fr]">
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2"><CreditCard className="size-5" />Novo plano</CardTitle>
                <CardDescription>Criação rápida para operação manual no MVP.</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-3" onSubmit={handleCreatePlan}>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="plan-code">Código</Label>
                      <Input id="plan-code" value={newPlan.code} onChange={(event) => setNewPlan((current) => ({ ...current, code: event.target.value }))} required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="plan-name">Nome</Label>
                      <Input id="plan-name" value={newPlan.name} onChange={(event) => setNewPlan((current) => ({ ...current, name: event.target.value }))} required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="plan-amount">Valor (centavos)</Label>
                      <Input id="plan-amount" value={newPlan.amountCents} onChange={(event) => setNewPlan((current) => ({ ...current, amountCents: event.target.value }))} type="number" min={0} required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="plan-currency">Moeda</Label>
                      <Input id="plan-currency" value={newPlan.currency} onChange={(event) => setNewPlan((current) => ({ ...current, currency: event.target.value }))} required />
                    </div>
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="plan-interval">Intervalo</Label>
                    <select
                      id="plan-interval"
                      className="h-10 w-full rounded-md border border-slate-300 bg-white px-3 text-sm"
                      value={newPlan.interval}
                      onChange={(event) => setNewPlan((current) => ({ ...current, interval: event.target.value as 'monthly' | 'yearly' }))}
                    >
                      <option value="monthly">Mensal</option>
                      <option value="yearly">Anual</option>
                    </select>
                  </div>
                  <Button type="submit" className="w-full">Criar plano</Button>
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Planos cadastrados</CardTitle>
                <CardDescription>{plans.length} plano(s)</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {plans.length === 0 ? <p className="text-sm text-slate-500">Nenhum plano cadastrado ainda.</p> : null}
                {plans.map((plan) => (
                  <div key={plan.planId} className="rounded-lg border border-slate-200 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-slate-900">{plan.name}</p>
                        <p className="text-xs text-slate-500">{plan.code}</p>
                      </div>
                      <Badge variant={plan.isActive ? 'success' : 'neutral'}>{plan.isActive ? 'ativo' : 'inativo'}</Badge>
                    </div>
                    <p className="mt-2 text-sm text-slate-700">{formatCurrency(plan.amountCents, plan.currency)} / {plan.interval === 'monthly' ? 'mês' : 'ano'}</p>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle>Subscriptions</CardTitle>
                <CardDescription>Atualize status, renove ou cancele manualmente.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {subscriptions.length === 0 ? <p className="text-sm text-slate-500">Nenhuma subscription disponível.</p> : null}
                {subscriptions.map((subscription) => (
                  <div key={subscription.subscriptionId} className="grid gap-3 rounded-lg border border-slate-200 p-3 md:grid-cols-[1.4fr_1fr_auto] md:items-center">
                    <div>
                      <p className="font-medium text-slate-900">{subscription.subscriptionId}</p>
                      <p className="text-xs text-slate-500">Conta: {subscription.accountId} | Plano: {subscription.planId}</p>
                      <p className="text-xs text-slate-500">Período até {new Date(subscription.currentPeriodEnd).toLocaleDateString('pt-BR')}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={statusBadgeVariant(subscription.status)}>{subscription.status}</Badge>
                      <select
                        className="h-9 rounded-md border border-slate-300 px-2 text-sm"
                        value={subscription.status}
                        onChange={(event) =>
                          void handleSubscriptionAction(
                            subscription.subscriptionId,
                            'status',
                            event.target.value as SubscriptionStatus,
                          )
                        }
                      >
                        <option value="active">active</option>
                        <option value="paused">paused</option>
                        <option value="canceled">canceled</option>
                        <option value="past_due">past_due</option>
                      </select>
                    </div>
                    <div className="flex gap-2">
                      <Button size="sm" variant="secondary" onClick={() => void handleSubscriptionAction(subscription.subscriptionId, 'renew')}>Renovar</Button>
                      <Button size="sm" variant="destructive" onClick={() => void handleSubscriptionAction(subscription.subscriptionId, 'cancel')}>Cancelar</Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>

            <Card className="xl:col-span-2">
              <CardHeader>
                <CardTitle>Invoices</CardTitle>
                <CardDescription>Controle manual de pagamentos no MVP.</CardDescription>
              </CardHeader>
              <CardContent className="space-y-3">
                {invoices.length === 0 ? <p className="text-sm text-slate-500">Nenhuma invoice cadastrada.</p> : null}
                {invoices.map((invoice) => (
                  <div key={invoice.invoiceId} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-slate-200 p-3">
                    <div>
                      <p className="font-medium text-slate-900">{invoice.invoiceId}</p>
                      <p className="text-xs text-slate-500">Conta {invoice.accountId} | Sub {invoice.subscriptionId}</p>
                      <p className="text-sm text-slate-700">{formatCurrency(invoice.amountDueCents, invoice.currency)} - vencimento {new Date(invoice.dueAt).toLocaleDateString('pt-BR')}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge variant={invoice.status === 'paid' ? 'success' : invoice.status === 'open' ? 'warning' : 'neutral'}>{invoice.status}</Badge>
                      {invoice.status === 'open' ? (
                        <Button size="sm" onClick={() => void handleMarkInvoicePaid(invoice.invoiceId)}>Marcar como paga</Button>
                      ) : null}
                    </div>
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        ) : null}

        {activeTab === 'password' ? (
          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader>
                <CardTitle>Forgot Password</CardTitle>
                <CardDescription>Dispara o fluxo de recuperação sem enumeração de email.</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-3" onSubmit={handleForgotPassword}>
                  <div className="space-y-2">
                    <Label htmlFor="forgot-email">Email</Label>
                    <Input id="forgot-email" type="email" value={forgotEmail} onChange={(event) => setForgotEmail(event.target.value)} required />
                  </div>
                  <Button type="submit">Solicitar reset</Button>
                  {forgotResult ? <p className="rounded-md bg-slate-100 p-3 text-sm text-slate-700">{forgotResult}</p> : null}
                </form>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Reset Password</CardTitle>
                <CardDescription>Executa a troca de senha com token temporário.</CardDescription>
              </CardHeader>
              <CardContent>
                <form className="space-y-3" onSubmit={handleResetPassword}>
                  <div className="space-y-2">
                    <Label htmlFor="reset-email">Email</Label>
                    <Input id="reset-email" type="email" value={resetForm.email} onChange={(event) => setResetForm((current) => ({ ...current, email: event.target.value }))} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reset-token">Token</Label>
                    <Input id="reset-token" value={resetForm.token} onChange={(event) => setResetForm((current) => ({ ...current, token: event.target.value }))} required />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="reset-password">Nova senha</Label>
                    <Input id="reset-password" type="password" autoComplete="new-password" value={resetForm.newPassword} onChange={(event) => setResetForm((current) => ({ ...current, newPassword: event.target.value }))} required minLength={8} />
                  </div>
                  <Button type="submit">Redefinir senha</Button>
                </form>
              </CardContent>
            </Card>
          </div>
        ) : null}

        {activeTab === 'complaints' ? (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2"><MessageSquareWarning className="size-5" />Inbox de reclamações</CardTitle>
              <CardDescription>Triagem administrativa com resposta e mudança de status.</CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {complaints.length === 0 ? <p className="text-sm text-slate-500">Nenhuma reclamação recebida.</p> : null}
              {complaints.map((complaint) => {
                const draft = ensureComplaintDraft(complaint)
                return (
                  <div key={complaint.complaintId} className="rounded-lg border border-slate-200 p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <p className="font-medium text-slate-900">{complaint.subject}</p>
                        <p className="text-xs text-slate-500">Conta {complaint.accountId} | {complaint.complaintId}</p>
                      </div>
                      <Badge variant={statusBadgeVariant(complaint.status)}>{complaint.status}</Badge>
                    </div>

                    <p className="mt-3 text-sm text-slate-700">{complaint.message}</p>

                    <div className="mt-3 grid gap-3 md:grid-cols-[180px_1fr_auto] md:items-start">
                      <select
                        className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
                        value={draft.status}
                        onChange={(event) =>
                          setComplaintDrafts((current) => ({
                            ...current,
                            [complaint.complaintId]: {
                              ...draft,
                              status: event.target.value as ComplaintStatus,
                            },
                          }))
                        }
                      >
                        <option value="open">open</option>
                        <option value="in_review">in_review</option>
                        <option value="resolved">resolved</option>
                        <option value="rejected">rejected</option>
                      </select>
                      <Textarea
                        value={draft.adminResponse}
                        onChange={(event) =>
                          setComplaintDrafts((current) => ({
                            ...current,
                            [complaint.complaintId]: {
                              ...draft,
                              adminResponse: event.target.value,
                            },
                          }))
                        }
                        placeholder="Resposta administrativa para o usuário"
                      />
                      <Button type="button" onClick={() => void handleUpdateComplaint(complaint)}>
                        Salvar
                      </Button>
                    </div>
                  </div>
                )
              })}
            </CardContent>
          </Card>
        ) : null}

        {activeTab === 'active-users' ? (
          <div className="space-y-4">
            <Card className="border-sky-200 bg-[linear-gradient(135deg,#ecfeff_0%,#eff6ff_55%,#f8fafc_100%)]">
              <CardHeader className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
                <div>
                  <CardTitle className="flex items-center gap-2 text-slate-950"><Users className="size-5 text-sky-700" />Dashboard de Usuários Ativos</CardTitle>
                  <CardDescription>
                    Visão combinada por atividade real do app, assinatura ativa e sessão vigente. Última atualização em {activeUsersDashboard ? formatDateTime(activeUsersDashboard.generatedAt) : '--'}.
                  </CardDescription>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <select
                    className="h-10 rounded-md border border-slate-300 bg-white px-3 text-sm"
                    value={activityWindowDays}
                    onChange={(event) => setActivityWindowDays(Number(event.target.value) as 7 | 30 | 90)}
                  >
                    <option value={7}>Últimos 7 dias</option>
                    <option value={30}>Últimos 30 dias</option>
                    <option value={90}>Últimos 90 dias</option>
                  </select>
                  <Button variant="outline" type="button" onClick={() => void loadActiveUsersDashboard()}>
                    <RefreshCcw className="mr-2 size-4" />Atualizar agora
                  </Button>
                  <Button variant="secondary" type="button" onClick={handleExportActiveUsersCsv} disabled={filteredActiveUsers.length === 0}>
                    <Download className="mr-2 size-4" />Exportar CSV
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
                <div className="rounded-xl border border-sky-200/80 bg-white/90 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Usuários ativos</p>
                  <p className="mt-2 text-3xl font-semibold text-slate-950">{activeUsersDashboard?.kpis.activeUsers ?? 0}</p>
                </div>
                <div className="rounded-xl border border-slate-200 bg-white/90 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Eventos</p>
                  <p className="mt-2 text-3xl font-semibold text-slate-950">{activeUsersDashboard?.kpis.totalEvents ?? 0}</p>
                </div>
                <div className="rounded-xl border border-emerald-200 bg-white/90 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Assinantes ativos</p>
                  <p className="mt-2 text-3xl font-semibold text-slate-950">{activeUsersDashboard?.kpis.activeSubscribers ?? 0}</p>
                </div>
                <div className="rounded-xl border border-violet-200 bg-white/90 p-4">
                  <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Sessões vigentes</p>
                  <p className="mt-2 text-3xl font-semibold text-slate-950">{activeUsersDashboard?.kpis.currentSessions ?? 0}</p>
                </div>
              </CardContent>
            </Card>

            <div className="grid gap-4 xl:grid-cols-[1.35fr_0.95fr]">
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2"><Activity className="size-5 text-sky-700" />Tendência de atividade</CardTitle>
                  <CardDescription>Usuários únicos ativos por dia na janela selecionada.</CardDescription>
                </CardHeader>
                <CardContent>
                  {loadingActiveUsersDashboard ? <p className="text-sm text-slate-500">Atualizando dashboard...</p> : null}
                  {!activeUsersDashboard ? <p className="text-sm text-slate-500">Abra a aba para carregar os dados de atividade.</p> : null}
                  {activeUsersDashboard ? (
                    <div className="space-y-3">
                      <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                        {activeUsersDashboard.trend.slice(-4).map((item) => (
                          <div key={item.date} className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                            <p className="text-xs uppercase tracking-wide text-slate-500">{new Date(item.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</p>
                            <p className="mt-2 text-xl font-semibold text-slate-950">{item.activeUsers}</p>
                            <p className="text-xs text-slate-500">{item.totalEvents} eventos</p>
                          </div>
                        ))}
                      </div>
                      <div className="flex h-52 items-end gap-2 rounded-xl border border-slate-200 bg-white p-4">
                        {activeUsersDashboard.trend.map((item) => (
                          <div key={item.date} className="flex min-w-0 flex-1 flex-col items-center gap-2">
                            <div
                              className="w-full rounded-t-md bg-gradient-to-t from-sky-600 to-cyan-400"
                              style={{ height: `${Math.max(10, Math.round((item.activeUsers / trendPeak) * 100))}%` }}
                              title={`${item.activeUsers} usuários ativos em ${item.date}`}
                            />
                            <span className="text-[10px] text-slate-500">{new Date(item.date).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>
                          </div>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Filtros operacionais</CardTitle>
                  <CardDescription>Refine a leitura para operação, suporte e growth.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div className="space-y-2">
                    <Label htmlFor="active-users-search">Buscar usuário</Label>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                      <Input
                        id="active-users-search"
                        className="pl-9"
                        value={activeUsersSearch}
                        onChange={(event) => setActiveUsersSearch(event.target.value)}
                        placeholder="Nome, email, conta ou evento"
                      />
                    </div>
                  </div>
                  <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    <span>Somente assinantes ativos</span>
                    <input type="checkbox" checked={onlySubscribers} onChange={(event) => setOnlySubscribers(event.target.checked)} />
                  </label>
                  <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    <span>Somente com sessão vigente</span>
                    <input type="checkbox" checked={onlyCurrentSessions} onChange={(event) => setOnlyCurrentSessions(event.target.checked)} />
                  </label>
                  <label className="flex items-center justify-between gap-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-700">
                    <span>Auto refresh a cada 30s</span>
                    <input type="checkbox" checked={autoRefreshDashboard} onChange={(event) => setAutoRefreshDashboard(event.target.checked)} />
                  </label>
                  <div className="rounded-lg border border-dashed border-slate-300 bg-white p-3 text-sm text-slate-600">
                    <p className="font-medium text-slate-900">Resultado filtrado</p>
                    <p className="mt-1">{filteredActiveUsers.length} usuário(s) no recorte atual.</p>
                  </div>
                </CardContent>
              </Card>
            </div>

            <div className="grid gap-4 xl:grid-cols-[1.45fr_0.85fr]">
              <Card>
                <CardHeader>
                  <CardTitle>Lista de usuários</CardTitle>
                  <CardDescription>Ordenada por atividade mais recente dentro da janela selecionada.</CardDescription>
                </CardHeader>
                <CardContent className="space-y-3">
                  {filteredActiveUsers.length === 0 ? <p className="text-sm text-slate-500">Nenhum usuário encontrado com os filtros atuais.</p> : null}
                  {filteredActiveUsers.map((user) => (
                    <button
                      key={user.accountId}
                      type="button"
                      className={`grid w-full gap-3 rounded-xl border p-4 text-left transition ${selectedActiveUser?.accountId === user.accountId ? 'border-sky-400 bg-sky-50/80' : 'border-slate-200 bg-white hover:border-slate-300'}`}
                      onClick={() => setSelectedActiveUserId(user.accountId)}
                    >
                      <div className="flex flex-wrap items-start justify-between gap-3">
                        <div>
                          <p className="font-medium text-slate-950">{user.name ?? 'Usuário sem nome'}</p>
                          <p className="text-sm text-slate-600">{user.email ?? user.accountId}</p>
                          <p className="text-xs text-slate-500">Conta {user.accountId}</p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant={user.hasActiveSubscription ? 'success' : 'neutral'}>{user.hasActiveSubscription ? 'assinante ativo' : 'sem assinatura ativa'}</Badge>
                          <Badge variant={user.hasCurrentSession ? 'info' : 'neutral'}>{user.hasCurrentSession ? 'sessão vigente' : 'sem sessão atual'}</Badge>
                        </div>
                      </div>
                      <div className="grid gap-2 text-sm text-slate-600 md:grid-cols-3">
                        <div>
                          <p className="text-xs uppercase tracking-wide text-slate-400">Última atividade</p>
                          <p>{formatDateTime(user.lastActivityAt)}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-wide text-slate-400">Último evento</p>
                          <p>{activityEventLabel(user.lastEventType)}</p>
                        </div>
                        <div>
                          <p className="text-xs uppercase tracking-wide text-slate-400">Eventos na janela</p>
                          <p>{user.eventCount}</p>
                        </div>
                      </div>
                    </button>
                  ))}
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Detalhe do usuário</CardTitle>
                  <CardDescription>Resumo rápido do item selecionado para suporte e leitura operacional.</CardDescription>
                </CardHeader>
                <CardContent>
                  {!selectedActiveUser ? <p className="text-sm text-slate-500">Selecione um usuário na lista para ver o detalhe.</p> : null}
                  {selectedActiveUser ? (
                    <div className="space-y-4">
                      <div>
                        <p className="text-lg font-semibold text-slate-950">{selectedActiveUser.name ?? 'Usuário sem nome'}</p>
                        <p className="text-sm text-slate-600">{selectedActiveUser.email ?? 'Sem email público'}</p>
                        <p className="text-xs text-slate-500">{selectedActiveUser.accountId}</p>
                      </div>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <p className="text-xs uppercase tracking-wide text-slate-400">Última atividade</p>
                          <p className="mt-1 text-sm font-medium text-slate-900">{formatDateTime(selectedActiveUser.lastActivityAt)}</p>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <p className="text-xs uppercase tracking-wide text-slate-400">Último evento</p>
                          <p className="mt-1 text-sm font-medium text-slate-900">{activityEventLabel(selectedActiveUser.lastEventType)}</p>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <p className="text-xs uppercase tracking-wide text-slate-400">Eventos no período</p>
                          <p className="mt-1 text-sm font-medium text-slate-900">{selectedActiveUser.eventCount}</p>
                        </div>
                        <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
                          <p className="text-xs uppercase tracking-wide text-slate-400">Status operacional</p>
                          <div className="mt-2 flex flex-wrap gap-2">
                            <Badge variant={selectedActiveUser.hasActiveSubscription ? 'success' : 'neutral'}>{selectedActiveUser.hasActiveSubscription ? 'assinatura ativa' : 'sem assinatura ativa'}</Badge>
                            <Badge variant={selectedActiveUser.hasCurrentSession ? 'info' : 'neutral'}>{selectedActiveUser.hasCurrentSession ? 'sessão vigente' : 'sessão encerrada'}</Badge>
                          </div>
                        </div>
                      </div>
                      <div className="rounded-xl border border-dashed border-slate-300 bg-white p-4 text-sm text-slate-600">
                        <p className="font-medium text-slate-900">Leitura operacional</p>
                        <p className="mt-2">
                          {selectedActiveUser.hasCurrentSession
                            ? 'Usuário potencialmente online agora. Bom candidato para suporte proativo ou observação de uso ao vivo.'
                            : 'Usuário sem sessão atual, mas com atividade registrada na janela. Útil para leitura de retenção e recência.'}
                        </p>
                      </div>
                    </div>
                  ) : null}
                </CardContent>
              </Card>
            </div>
          </div>
        ) : null}
        </div>
      </section>
    </main>
  )
}

export default App
