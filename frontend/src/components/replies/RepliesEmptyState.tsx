import { CornerDownLeft } from 'lucide-react'

export function RepliesEmptyState({
  tab,
  onShowRead,
}: {
  tab: 'unread' | 'read'
  onShowRead?: () => void
}) {
  if (tab === 'read') {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
        <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f3f4f6] text-[#6b7280]">
          <CornerDownLeft size={24} strokeWidth={1.75} />
        </div>
        <h2 className="text-[18px] font-semibold text-[#1a1d21]">No read replies yet</h2>
        <p className="mt-1 max-w-sm text-[14px] text-[#6b7280]">
          Replies you have opened will appear here.
        </p>
      </div>
    )
  }

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#f3f4f6] text-[#6b7280]">
        <CornerDownLeft size={24} strokeWidth={1.75} />
      </div>
      <h2 className="text-[18px] font-semibold text-[#1a1d21]">You&apos;re all caught up!</h2>
      <p className="mt-1 max-w-sm text-[14px] text-[#6b7280]">
        Looks like you don&apos;t have any unread replies.
      </p>
      {onShowRead && (
        <button
          onClick={onShowRead}
          className="mt-5 rounded-full border border-[#d1d5db] bg-white px-5 py-2 text-[14px] font-medium text-[#374151] transition-colors hover:bg-[#f9fafb]"
        >
          Read old replies
        </button>
      )}
    </div>
  )
}
