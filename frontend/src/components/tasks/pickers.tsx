import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Check, Flag, X } from 'lucide-react'

import { api, errorMessage } from '../../lib/api'
import { useStatuses } from '../../lib/queries'
import type { CustomStatus, Priority, Task } from '../../lib/types'
import { cn, PRIORITY_COLORS, PRIORITY_LABELS } from '../../lib/utils'
import { toast } from '../../stores/toast'
import { Avatar } from '../ui/Avatar'
import { Dropdown } from '../ui/Dropdown'
import type { OrgMember } from '../../lib/types'

export function StatusPicker({
  projectId,
  value,
  onChange,
  children,
}: {
  projectId: string
  value: CustomStatus | null
  onChange: (statusId: string) => void
  children: React.ReactNode
}) {
  const statuses = useStatuses(projectId)
  return (
    <Dropdown trigger={children} width="w-48">
      {(close) =>
        (statuses.data ?? []).map((status) => (
          <button
            key={status.id}
            className="menu-item"
            onClick={() => {
              onChange(status.id)
              close()
            }}
          >
            <span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: status.color }} />
            <span className="flex-1">{status.name}</span>
            {value?.id === status.id && <Check size={14} className="text-brand" />}
          </button>
        ))
      }
    </Dropdown>
  )
}

export function PriorityPicker({
  value,
  onChange,
  children,
}: {
  value: Priority | null
  onChange: (p: Priority | null) => void
  children: React.ReactNode
}) {
  const options: Priority[] = ['urgent', 'high', 'normal', 'low']
  return (
    <Dropdown trigger={children} width="w-40">
      {(close) => (
        <>
          {options.map((p) => (
            <button
              key={p}
              className="menu-item"
              onClick={() => {
                onChange(p)
                close()
              }}
            >
              <Flag size={13} style={{ color: PRIORITY_COLORS[p] }} fill={PRIORITY_COLORS[p]} />
              <span className="flex-1">{PRIORITY_LABELS[p]}</span>
              {value === p && <Check size={14} className="text-brand" />}
            </button>
          ))}
          <div className="my-1 h-px bg-ink-700" />
          <button
            className="menu-item"
            onClick={() => {
              onChange(null)
              close()
            }}
          >
            <X size={13} className="text-fg-muted" />
            <span>Clear</span>
          </button>
        </>
      )}
    </Dropdown>
  )
}

export function DatePicker({
  value,
  onChange,
  children,
}: {
  value: string | null
  onChange: (date: string | null) => void
  children: React.ReactNode
}) {
  return (
    <Dropdown trigger={children} width="w-56">
      {(close) => (
        <div className="p-2">
          <input
            type="date"
            defaultValue={value ?? ''}
            onChange={(e) => {
              onChange(e.target.value || null)
              close()
            }}
            className="input-dark"
          />
          <button
            className="btn-ghost mt-1.5 w-full text-xs"
            onClick={() => {
              onChange(null)
              close()
            }}
          >
            Clear due date
          </button>
        </div>
      )}
    </Dropdown>
  )
}

/** Picks assignees from project members; assigns/unassigns via API. */
export function AssigneePicker({ task, children }: { task: Task; children: React.ReactNode }) {
  const queryClient = useQueryClient()
  const members = useQuery({
    queryKey: ['project-members', task.project_id],
    queryFn: () => api.get<OrgMember[]>(`/projects/${task.project_id}/members`),
  })

  const assignedIds = new Set(task.assignees.map((a) => a.id))

  const toggle = async (userId: string) => {
    try {
      if (assignedIds.has(userId)) {
        await api.delete(`/tasks/${task.id}/assignees/${userId}`)
      } else {
        await api.post(`/tasks/${task.id}/assignees`, { user_ids: [userId] })
      }
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      void queryClient.invalidateQueries({ queryKey: ['task', task.id] })
    } catch (err) {
      toast.error(errorMessage(err))
    }
  }

  return (
    <Dropdown trigger={children} width="w-64">
      {() => (
        <>
          <p className="px-3 pb-1 pt-2 text-[11px] font-semibold uppercase tracking-wider text-fg-muted">
            Assignees
          </p>
          {(members.data ?? []).map((member) => (
            <button key={member.user_id} className="menu-item" onClick={() => toggle(member.user_id)}>
              <Avatar
                name={member.user?.full_name || member.user?.email || '?'}
                src={member.user?.avatar_url}
                size={22}
              />
              <span className="flex-1 truncate">{member.user?.full_name || member.user?.email}</span>
              <span
                className={cn(
                  'flex h-4 w-4 items-center justify-center rounded border',
                  assignedIds.has(member.user_id)
                    ? 'border-brand bg-brand text-white'
                    : 'border-ink-600',
                )}
              >
                {assignedIds.has(member.user_id) && <Check size={11} />}
              </span>
            </button>
          ))}
          {(members.data ?? []).length === 0 && (
            <p className="px-3 py-3 text-xs text-fg-muted">No project members</p>
          )}
        </>
      )}
    </Dropdown>
  )
}
