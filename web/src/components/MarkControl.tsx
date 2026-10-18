import { Bookmark, X } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip'
import { READ_ONLY } from '@/lib/api'
import { MARKS, markInfo } from '@/lib/config'
import type { MarkValue } from '@/lib/types'
import { cn } from '@/lib/utils'

/** Compact mark picker: an icon button that opens a menu. */
export function MarkMenu({ mark, onChange }: { mark: MarkValue | null; onChange: (m: MarkValue | null) => void }) {
  const info = markInfo(mark)
  const Icon = info?.icon ?? Bookmark
  if (READ_ONLY)
    return info ? (
      <span className="inline-flex size-7 items-center justify-center" title={`Marked: ${info.label}`} aria-label={`Marked: ${info.label}`}>
        <Icon className={cn('size-4 fill-current', info.className)} />
      </span>
    ) : (
      <span className="inline-block size-7" aria-hidden />
    )
  return (
    <DropdownMenu>
      <Tooltip>
        <TooltipTrigger asChild>
          <DropdownMenuTrigger asChild>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={info ? `Marked: ${info.label}` : 'Mark this car'}
              onClick={(e) => e.stopPropagation()}
            >
              <Icon className={cn(info ? info.className : 'text-muted-foreground/50', info && 'fill-current')} />
            </Button>
          </DropdownMenuTrigger>
        </TooltipTrigger>
        <TooltipContent>{info ? info.label : 'Mark this car'}</TooltipContent>
      </Tooltip>
      <DropdownMenuContent align="start" onClick={(e) => e.stopPropagation()}>
        {MARKS.map((m) => (
          <DropdownMenuItem key={m.value} onSelect={() => onChange(m.value)}>
            <m.icon className={m.className} />
            {m.label}
          </DropdownMenuItem>
        ))}
        {mark && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem onSelect={() => onChange(null)}>
              <X />
              Clear mark
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
