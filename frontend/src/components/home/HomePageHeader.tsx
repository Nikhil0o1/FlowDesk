interface Props {
  title: string
  description?: string
  action?: React.ReactNode
}

/** Consistent page title block shared by the Home shortcut pages. */
export function HomePageHeader({ title, description, action }: Props) {
  return (
    <div className="mb-6 flex items-start justify-between gap-3">
      <div>
        <h1 className="text-xl font-bold text-fg">{title}</h1>
        {description && <p className="mt-0.5 text-sm text-fg-secondary">{description}</p>}
      </div>
      {action}
    </div>
  )
}
