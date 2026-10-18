import { Badge } from '@/components/ui/badge'
import { levelLabel } from '@/lib/dims'
import type { Row } from '@/lib/types'

export function WriteoffBadge({ writeoff }: { writeoff: string | null }) {
  if (!writeoff) return null
  return (
    <Badge variant="destructive" className="font-mono text-[10px]" title="Insurance write-off category">
      {writeoff}
    </Badge>
  )
}

export function StatusBadges({ row }: { row: Row }) {
  return (
    <>
      {row.status === 'delisted' && <Badge variant="secondary">Sold</Badge>}
      {row.reserved && <Badge variant="outline">Reserved</Badge>}
      <WriteoffBadge writeoff={row.writeoff} />
      {row.errata?.length > 0 && (
        <Badge variant="outline" title={row.errata.map((e) => `${e.field}: ${String(e.before)} → ${String(e.after)}. ${e.reason}`).join('\n')}>
          Corrected
        </Badge>
      )}
      {row.price_indicator && (
        <Badge variant="outline" title="AutoTrader's own price rating">
          AT: {levelLabel('rating', row.price_indicator)}
        </Badge>
      )}
    </>
  )
}
