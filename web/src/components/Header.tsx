import { READ_ONLY } from '@/lib/api'
import { Gauge, Monitor, Moon, SlidersHorizontal, Sun } from 'lucide-react'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { APP_NAME, TAGLINE } from '@/lib/config'
import { relTime } from '@/lib/format'
import { type ThemeChoice, useTheme } from '@/lib/theme-context'
import type { Meta } from '@/lib/types'

export function Header({
  meta,
  car,
  onCar,
  onOpenFilters,
  activeFilters,
}: {
  meta: Meta | null
  car: string | null
  onCar: (id: string) => void
  onOpenFilters: () => void
  activeFilters: number
}) {
  const { theme, resolved, setTheme } = useTheme()
  const latest = meta?.runs.find((r) => r.finished_at) ?? null
  const running = meta?.runs.find((r) => !r.finished_at && !r.complete)
  const ThemeIcon = theme === 'system' ? Monitor : resolved === 'dark' ? Moon : Sun

  return (
    <header className="sticky top-0 z-30 border-b bg-background/90 backdrop-blur">
      <div className="flex h-14 items-center gap-3 px-4">
        <Button variant="outline" size="icon" className="lg:hidden" onClick={onOpenFilters} aria-label="Filters">
          <SlidersHorizontal />
        </Button>
        <div className="flex min-w-0 items-center gap-2">
          <Gauge className="size-5 shrink-0 text-primary" />
          <span className="font-heading text-lg font-semibold tracking-tight">{APP_NAME}</span>
          <span className="hidden truncate text-sm text-muted-foreground md:inline">{TAGLINE}</span>
        </div>
        {activeFilters > 0 && (
          <Badge variant="secondary" className="lg:hidden">
            {activeFilters}
          </Badge>
        )}
        <div className="ml-auto flex items-center gap-2">
          {meta && meta.cars.length > 0 && (
            <Select value={car ?? undefined} onValueChange={onCar}>
              <SelectTrigger size="sm" className="w-[11rem] sm:w-[14rem]" aria-label="Car">
                <SelectValue placeholder="Choose a car" />
              </SelectTrigger>
              <SelectContent>
                {meta.cars.map((c) => (
                  <SelectItem key={c.id} value={c.id}>
                    {c.label} <span className="text-muted-foreground tabular-nums">{c.n_listings.toLocaleString()}</span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          {READ_ONLY && (
            <span
              className="rounded-md border px-1.5 py-0.5 text-xs text-muted-foreground"
              title="A published, read-only snapshot of the data. Marking and saving need the local app."
            >
              Read-only snapshot
            </span>
          )}
          <span className="hidden text-xs text-muted-foreground sm:inline" title={latest?.finished_at ?? ''}>
            {running ? 'Scrape running…' : latest ? `Updated ${relTime(latest.finished_at)}` : ''}
          </span>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button variant="ghost" size="icon" aria-label="Theme">
                <ThemeIcon />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end">
              <DropdownMenuRadioGroup value={theme} onValueChange={(v) => setTheme(v as ThemeChoice)}>
                <DropdownMenuRadioItem value="light">
                  <Sun /> Light
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="dark">
                  <Moon /> Dark
                </DropdownMenuRadioItem>
                <DropdownMenuRadioItem value="system">
                  <Monitor /> System
                </DropdownMenuRadioItem>
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>
    </header>
  )
}
