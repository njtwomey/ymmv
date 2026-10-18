import { ChevronDown } from 'lucide-react'
import { type ReactNode, useState } from 'react'
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { cn } from '@/lib/utils'

function storedOpen(key: string, fallback: boolean): boolean {
  try {
    const v = localStorage.getItem(key)
    return v === null ? fallback : v === '1'
  } catch {
    return fallback
  }
}

export function ChartCard({
  title,
  description,
  actions,
  children,
  className,
  collapsible = false,
  defaultOpen = true,
}: {
  title: string
  description?: ReactNode
  actions?: ReactNode
  children: ReactNode
  className?: string
  /** Show a chevron that folds the body away; the choice is remembered per title. */
  collapsible?: boolean
  defaultOpen?: boolean
}) {
  const key = `ymmv.card.${title}`
  const [open, setOpen] = useState(() => !collapsible || storedOpen(key, defaultOpen))
  const toggle = () => {
    setOpen((o) => {
      try {
        localStorage.setItem(key, o ? '0' : '1')
      } catch {
        /* storage unavailable */
      }
      return !o
    })
  }

  return (
    <Card className={cn('min-w-0', className)}>
      <CardHeader>
        <CardTitle>
          {collapsible ? (
            <button type="button" className="-ml-1 flex items-center gap-1 rounded px-1 hover:bg-muted" onClick={toggle} aria-expanded={open}>
              <ChevronDown className={cn('size-4 text-muted-foreground transition-transform', !open && '-rotate-90')} />
              {title}
            </button>
          ) : (
            title
          )}
        </CardTitle>
        {description && <CardDescription>{description}</CardDescription>}
        {actions && open && (
          // Below the title on phones, top-right from sm up.
          <CardAction className="col-start-1 row-span-1 row-start-3 flex flex-wrap items-center gap-2 justify-self-start sm:col-start-2 sm:row-span-2 sm:row-start-1 sm:justify-self-end">
            {actions}
          </CardAction>
        )}
      </CardHeader>
      {open && <CardContent className="min-w-0">{children}</CardContent>}
    </Card>
  )
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="flex h-40 items-center justify-center text-sm text-muted-foreground">{children}</div>
}
