import { X } from 'lucide-react'

export function InboxClearedLearnMore({ open, onClose }: { open: boolean; onClose: () => void }) {
  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={onClose}>
      <div
        className="w-full max-w-md rounded-xl bg-white p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <h3 className="text-[16px] font-semibold text-[#1a1d21]">Cleared notifications</h3>
          <button onClick={onClose} className="rounded p-1 text-[#6b7280] hover:bg-[#f3f4f6]">
            <X size={16} />
          </button>
        </div>
        <div className="space-y-3 text-[14px] leading-relaxed text-[#4b5563]">
          <p>
            When you clear a notification from Primary, Other, or Later, it moves to the{' '}
            <strong className="font-medium text-[#1a1d21]">Cleared</strong> tab.
          </p>
          <p>
            Cleared items stay in your inbox for <strong className="font-medium text-[#1a1d21]">30 days</strong>,
            then are permanently deleted. This cannot be undone after deletion.
          </p>
          <p>
            Snoozed notifications in <strong className="font-medium text-[#1a1d21]">Later</strong> return to Primary
            or Other when the snooze time passes.
          </p>
        </div>
        <button
          onClick={onClose}
          className="mt-5 w-full rounded-lg bg-[#b8956f] py-2 text-[14px] font-medium text-white hover:bg-[#a68462]"
        >
          Got it
        </button>
      </div>
    </div>
  )
}
