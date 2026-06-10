import { useMutation, useQueryClient } from '@tanstack/react-query'
import {
  ClipboardCheck,
  ClipboardList,
  Copy,
  MessageSquareHeart,
  MoreHorizontal,
  PenLine,
  Plus,
  Search,
  ShoppingCart,
  Trash2,
} from 'lucide-react'
import { useState } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { api, errorMessage } from '../../lib/api'
import { useCurrentContext, useForms, useProjects, useWorkspaceMembers } from '../../lib/queries'
import type { FormDef, FormField } from '../../lib/types'
import { cn, timeAgo } from '../../lib/utils'
import { useAuthStore } from '../../stores/auth'
import { toast } from '../../stores/toast'
import { Avatar } from '../../components/ui/Avatar'
import { Dropdown } from '../../components/ui/Dropdown'
import { EmptyState } from '../../components/ui/EmptyState'
import { Modal } from '../../components/ui/Modal'
import { CenteredSpinner } from '../../components/ui/Spinner'

interface FormTemplate {
  key: string
  name: string
  description: string
  color: string
  icon: React.ReactNode
  fields: FormField[]
}

const TEMPLATES: FormTemplate[] = [
  {
    key: 'project-intake',
    name: 'Project Intake',
    description: 'Streamline new project requests',
    color: '#E667A8',
    icon: <ClipboardList size={20} />,
    fields: [
      { id: 'title', type: 'text', label: 'Project name', required: true },
      { id: 'goal', type: 'textarea', label: 'Project goal & description', required: true },
      { id: 'priority', type: 'select', label: 'Priority', required: false, options: ['Low', 'Normal', 'High', 'Urgent'] },
      { id: 'start', type: 'date', label: 'Desired start date', required: false },
      { id: 'requester', type: 'email', label: 'Requester email', required: false },
    ],
  },
  {
    key: 'feedback',
    name: 'Feedback Form',
    description: 'Survey and collect feedback',
    color: '#4CB782',
    icon: <MessageSquareHeart size={20} />,
    fields: [
      { id: 'title', type: 'text', label: 'Subject', required: true },
      {
        id: 'rating',
        type: 'select',
        label: 'How satisfied are you?',
        required: true,
        options: ['Very satisfied', 'Satisfied', 'Neutral', 'Unsatisfied', 'Very unsatisfied'],
      },
      { id: 'good', type: 'textarea', label: 'What went well?', required: false },
      { id: 'improve', type: 'textarea', label: 'What could be better?', required: false },
    ],
  },
  {
    key: 'order',
    name: 'Order Form',
    description: 'Capture and process client orders',
    color: '#8C5BFF',
    icon: <ShoppingCart size={20} />,
    fields: [
      { id: 'title', type: 'text', label: 'Order title', required: true },
      { id: 'details', type: 'textarea', label: 'Order details', required: true },
      { id: 'quantity', type: 'text', label: 'Quantity', required: false },
      { id: 'customer', type: 'email', label: 'Customer email', required: true },
      { id: 'needed', type: 'date', label: 'Needed by', required: false },
    ],
  },
]

export default function FormsPage() {
  const { workspace } = useCurrentContext()
  const forms = useForms(workspace?.id)
  const members = useWorkspaceMembers(workspace?.id)
  const user = useAuthStore((s) => s.user)
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [params, setParams] = useSearchParams()
  const [q, setQ] = useState('')
  const [template, setTemplate] = useState<FormTemplate | null>(null)

  const mineOnly = params.get('mine') === '1'
  const createOpen = params.get('new') === '1'

  const visible = (forms.data ?? []).filter(
    (f) =>
      (!mineOnly || f.created_by === user?.id) &&
      (!q.trim() || f.name.toLowerCase().includes(q.trim().toLowerCase())),
  )

  const memberBrief = (userId: string | null) =>
    members.data?.find((m) => m.user_id === userId)?.user ?? null

  const copyLink = async (form: FormDef) => {
    await navigator.clipboard.writeText(`${window.location.origin}/f/${form.public_token}`)
    toast.success('Public link copied')
  }

  const remove = async (form: FormDef) => {
    if (!window.confirm(`Delete form "${form.name}"?`)) return
    try {
      await api.delete(`/forms/${form.id}`)
      toast.success('Form deleted')
      void queryClient.invalidateQueries({ queryKey: ['forms', workspace?.id] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  if (forms.isLoading) return <CenteredSpinner />

  return (
    <div className="mx-auto max-w-6xl px-8 py-7">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-bold text-fg">{mineOnly ? 'My Forms' : 'All Forms'}</h1>
        <button
          className="btn-primary"
          onClick={() => {
            params.set('new', '1')
            setParams(params, { replace: true })
          }}
        >
          <Plus size={15} /> New Form
        </button>
      </div>

      {/* Templates */}
      <p className="mb-2.5 mt-6 text-xs font-semibold uppercase tracking-wider text-fg-muted">Templates</p>
      <div className="grid grid-cols-3 gap-4 max-md:grid-cols-1">
        {TEMPLATES.map((tpl) => (
          <button
            key={tpl.key}
            onClick={() => setTemplate(tpl)}
            className="flex items-center gap-4 rounded-2xl border border-ink-700 bg-ink-850/50 px-5 py-4 text-left transition-colors hover:border-ink-600"
          >
            <span
              className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-white"
              style={{ backgroundColor: `${tpl.color}33`, color: tpl.color }}
            >
              {tpl.icon}
            </span>
            <span className="min-w-0">
              <span className="block text-sm font-semibold text-fg">{tpl.name}</span>
              <span className="block truncate text-xs text-fg-secondary">{tpl.description}</span>
            </span>
          </button>
        ))}
      </div>

      {/* Search + table */}
      <div className="mt-7 flex items-center justify-between">
        <div className="relative">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-fg-muted" />
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search" className="input-dark !w-56 !pl-9" />
        </div>
      </div>

      {visible.length === 0 ? (
        <EmptyState
          icon={ClipboardCheck}
          title={q ? 'No matching forms' : 'No forms yet'}
          description="Create forms to kick off projects, collect feedback, and triage requests — submissions become tasks."
        />
      ) : (
        <div className="mt-4 overflow-hidden rounded-xl border border-ink-700">
          <div
            className="grid items-center gap-2 border-b border-ink-700 bg-ink-850 px-4 py-2 text-[11px] font-medium uppercase tracking-wide text-fg-muted"
            style={{ gridTemplateColumns: 'minmax(220px,1.5fr) minmax(140px,1fr) 110px 110px 110px 40px' }}
          >
            <span>Name</span>
            <span>Location</span>
            <span>Created by</span>
            <span>Submissions</span>
            <span>Updated</span>
            <span />
          </div>
          {visible.map((form) => {
            const creator = memberBrief(form.created_by)
            return (
              <div
                key={form.id}
                className="grid cursor-pointer items-center gap-2 border-b border-ink-700/60 bg-ink-900 px-4 py-2.5 transition-colors last:border-b-0 hover:bg-ink-850"
                style={{ gridTemplateColumns: 'minmax(220px,1.5fr) minmax(140px,1fr) 110px 110px 110px 40px' }}
                onClick={() => navigate(`/app/forms/${form.id}`)}
              >
                <span className="flex min-w-0 items-center gap-2.5">
                  <ClipboardCheck size={15} className={cn('shrink-0', form.is_active ? 'text-brand' : 'text-fg-muted')} />
                  <span className="truncate text-sm font-medium text-fg">{form.name}</span>
                  {!form.is_active && (
                    <span className="rounded bg-ink-750 px-1.5 py-0.5 text-[10px] uppercase text-fg-muted">paused</span>
                  )}
                </span>
                <span className="truncate text-xs text-fg-secondary">⌥ {form.project_name ?? '—'}</span>
                <span>
                  {creator ? (
                    <Avatar name={creator.full_name || creator.email} src={creator.avatar_url} size={24} />
                  ) : (
                    <span className="text-xs text-fg-muted">—</span>
                  )}
                </span>
                <span className="text-xs text-fg-secondary">{form.submission_count}</span>
                <span className="text-xs text-fg-muted">{timeAgo(form.updated_at)}</span>
                <span onClick={(e) => e.stopPropagation()}>
                  <Dropdown
                    align="right"
                    width="w-44"
                    trigger={
                      <button className="rounded-md p-1 text-fg-muted transition-colors hover:bg-ink-750 hover:text-fg">
                        <MoreHorizontal size={15} />
                      </button>
                    }
                  >
                    {(close) => (
                      <>
                        <button className="menu-item" onClick={() => { close(); navigate(`/app/forms/${form.id}/fill`) }}>
                          <PenLine size={14} /> Fill out
                        </button>
                        <button className="menu-item" onClick={() => { close(); navigate(`/app/forms/${form.id}`) }}>
                          <ClipboardCheck size={14} /> Open builder
                        </button>
                        <button className="menu-item" onClick={() => { close(); void copyLink(form) }}>
                          <Copy size={14} /> Copy public link
                        </button>
                        <div className="my-1 h-px bg-ink-700" />
                        <button
                          className="menu-item text-red-400 hover:text-red-300"
                          onClick={() => { close(); void remove(form) }}
                        >
                          <Trash2 size={14} /> Delete
                        </button>
                      </>
                    )}
                  </Dropdown>
                </span>
              </div>
            )
          })}
        </div>
      )}

      <CreateFormModal
        open={createOpen || template !== null}
        template={template}
        onClose={() => {
          params.delete('new')
          setParams(params, { replace: true })
          setTemplate(null)
        }}
      />
    </div>
  )
}

function CreateFormModal({
  open,
  template,
  onClose,
}: {
  open: boolean
  template: FormTemplate | null
  onClose: () => void
}) {
  const { workspace } = useCurrentContext()
  const projects = useProjects(workspace?.id)
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [projectId, setProjectId] = useState('')

  const effectiveName = name || template?.name || ''

  const create = useMutation({
    mutationFn: async () => {
      const form = await api.post<FormDef>(`/workspaces/${workspace!.id}/forms`, {
        name: effectiveName.trim(),
        description: template?.description ?? null,
        project_id: projectId || projects.data?.[0]?.id,
      })
      if (template) {
        await api.patch(`/forms/${form.id}`, { fields: template.fields })
      }
      return form
    },
    onSuccess: (form) => {
      void queryClient.invalidateQueries({ queryKey: ['forms', workspace?.id] })
      setName('')
      onClose()
      navigate(`/app/forms/${form.id}`)
    },
    onError: (err) => toast.error(errorMessage(err)),
  })

  return (
    <Modal open={open} onClose={onClose} title={template ? `New form — ${template.name}` : 'New Form'} width="max-w-md">
      <div className="space-y-3">
        {template && (
          <p className="text-xs text-fg-secondary">
            Starts with {template.fields.length} prefilled fields — you can edit them in the builder.
          </p>
        )}
        <input
          autoFocus
          className="input-dark"
          placeholder="Form name"
          value={effectiveName}
          onChange={(e) => setName(e.target.value)}
        />
        <div>
          <label className="mb-1.5 block text-xs font-medium text-fg-secondary">Submissions create tasks in</label>
          <select className="input-dark" value={projectId} onChange={(e) => setProjectId(e.target.value)}>
            {(projects.data ?? []).map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <button
          className="btn-primary w-full"
          disabled={!effectiveName.trim() || (projects.data ?? []).length === 0 || create.isPending}
          onClick={() => create.mutate()}
        >
          {create.isPending ? 'Creating…' : 'Create form'}
        </button>
      </div>
    </Modal>
  )
}
