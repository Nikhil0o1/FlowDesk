import { UserPlus } from 'lucide-react'

import { useOpenInvite } from '../../hooks/useOpenInvite'

export function InboxEmptyState() {
  const openInvite = useOpenInvite()

  return (
    <div className="flex flex-1 flex-col items-center justify-center px-6 py-16 text-center">
      <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-[#ede9fe] text-[#7c3aed]">
        <UserPlus size={24} strokeWidth={1.75} />
      </div>
      <h2 className="text-[18px] font-semibold text-[#1a1d21]">Looking to collaborate?</h2>
      <p className="mt-1 text-[14px] text-[#6b7280]">Collaboration is one invite away.</p>
      <button
        onClick={() => openInvite()}
        className="mt-5 rounded-full bg-[#b8956f] px-5 py-2 text-[14px] font-medium text-white transition-colors hover:bg-[#a68462]"
      >
        Invite people
      </button>
    </div>
  )
}
