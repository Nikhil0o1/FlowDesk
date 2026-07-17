import { Navigate, useSearchParams } from 'react-router-dom'

/** Legacy `/app/list` URLs redirect into the My Tasks section. */
export default function ListPage() {
  const [params] = useSearchParams()
  const qs = params.toString()
  return <Navigate to={qs ? `/app/my-tasks/assigned?${qs}` : '/app/my-tasks/assigned'} replace />
}
