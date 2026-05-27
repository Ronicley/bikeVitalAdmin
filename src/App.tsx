import { useEffect, useMemo, useState } from 'react'
import { AlertCircle, CheckCircle2, CreditCard, LogOut, MessageSquareWarning, RefreshCcw, ShieldCheck } from 'lucide-react'
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

interface ApiFailure {
  error?: {
    message?: string
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
    throw new Error(message)
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

function TabButton(props: { isActive: boolean; label: string; onClick: () => void }) {
  return (
    <Button
      variant={props.isActive ? 'default' : 'outline'}
      size="sm"
      onClick={props.onClick}
      className="min-w-36"
      type="button"
    >
      {props.label}
    </Button>
  )
}

function App() {
  const [session, setSession] = useState<SessionResponse | null>(null)
  const [activeTab, setActiveTab] = useState<'billing' | 'password' | 'complaints'>('billing')
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

    void loadAdminData(token)
  }, [token])

  async function loadAdminData(accessToken: string): Promise<void> {
    setLoadingAdminData(true)
    setErrorMessage(null)

    try {
      const [plansResponse, subscriptionsResponse, invoicesResponse, complaintsResponse] = await Promise.all([
        apiRequest<{ plans: Plan[] }>('/v1/admin/plans', { method: 'GET' }, accessToken),
        apiRequest<{ subscriptions: Subscription[] }>('/v1/admin/subscriptions', { method: 'GET' }, accessToken),
        apiRequest<{ invoices: Invoice[] }>('/v1/admin/invoices', { method: 'GET' }, accessToken),
        apiRequest<{ complaints: Complaint[] }>('/v1/admin/complaints', { method: 'GET' }, accessToken),
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
    setSession(null)
    setPlans([])
    setSubscriptions([])
    setInvoices([])
    setComplaints([])
    localStorage.removeItem(SESSION_STORAGE_KEY)
  }

  async function handleCreatePlan(event: React.FormEvent<HTMLFormElement>): Promise<void> {
    event.preventDefault()
    if (!token) {
      return
    }

    setErrorMessage(null)
    setFeedbackMessage(null)

    try {
      const created = await apiRequest<Plan>(
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
        token,
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
    if (!token) {
      return
    }

    setErrorMessage(null)
    setFeedbackMessage(null)

    try {
      let updated: Subscription
      if (action === 'renew') {
        updated = await apiRequest<Subscription>(`/v1/admin/subscriptions/${subscriptionId}/renew`, { method: 'POST' }, token)
      } else if (action === 'cancel') {
        updated = await apiRequest<Subscription>(`/v1/admin/subscriptions/${subscriptionId}/cancel`, { method: 'POST' }, token)
      } else {
        updated = await apiRequest<Subscription>(
          `/v1/admin/subscriptions/${subscriptionId}/status`,
          {
            method: 'PATCH',
            body: JSON.stringify({ status }),
          },
          token,
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
    if (!token) {
      return
    }

    setErrorMessage(null)
    setFeedbackMessage(null)
    try {
      const updated = await apiRequest<Invoice>(`/v1/admin/invoices/${invoiceId}/mark-paid`, { method: 'POST' }, token)
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
    if (!token) {
      return
    }

    const draft = complaintDrafts[complaint.complaintId]
    if (!draft) {
      return
    }

    setErrorMessage(null)
    setFeedbackMessage(null)
    try {
      const updated = await apiRequest<Complaint>(
        `/v1/admin/complaints/${complaint.complaintId}`,
        {
          method: 'PATCH',
          body: JSON.stringify({
            status: draft.status,
            adminResponse: draft.adminResponse,
          }),
        },
        token,
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

      <section className="mx-auto mt-4 max-w-7xl space-y-4 px-4 md:px-8">
        <div className="flex flex-wrap gap-2">
          <TabButton isActive={activeTab === 'billing'} label="Subscriptions & Pagamentos" onClick={() => setActiveTab('billing')} />
          <TabButton isActive={activeTab === 'password'} label="Reset de Senha" onClick={() => setActiveTab('password')} />
          <TabButton isActive={activeTab === 'complaints'} label="Reclamações" onClick={() => setActiveTab('complaints')} />
          <Button variant="ghost" size="sm" onClick={() => token && void loadAdminData(token)}>
            <RefreshCcw className="mr-2 size-4" />
            Recarregar
          </Button>
        </div>

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
                    <Input id="reset-password" type="password" value={resetForm.newPassword} onChange={(event) => setResetForm((current) => ({ ...current, newPassword: event.target.value }))} required minLength={8} />
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
      </section>
    </main>
  )
}

export default App
