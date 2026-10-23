/** Building blocks for the filterable tables (Best value, Listings): filter boxes, sortable headings and a column chooser. */
import { ArrowDown, ArrowUp, Columns3, Search } from 'lucide-react'
import type { ReactNode } from 'react'
import { Button } from '@/components/ui/button'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { TableHead } from '@/components/ui/table'
import { cn } from '@/lib/utils'

const NO_SPINNER = '[appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none'

const FIELD =
  'h-7 w-full min-w-0 bg-transparent px-1.5 text-xs font-normal text-foreground tabular-nums outline-none placeholder:text-muted-foreground'
const BOX =
  'flex h-7 items-center rounded-md border border-input bg-transparent focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50 dark:bg-input/30'

/** A joined lower–upper pair in one box, so it reads as a single range. Sits centred under its heading; `narrow` for 4-digit values (years). */
export function RangeInput({
  label,
  from,
  to,
  onFrom,
  onTo,
  narrow = false,
}: {
  label: string
  from: string
  to: string
  onFrom: (v: string) => void
  onTo: (v: string) => void
  narrow?: boolean
}) {
  return (
    <div className={cn(BOX, 'mx-auto', narrow ? 'w-24' : 'w-28')}>
      <input className={cn(FIELD, NO_SPINNER, 'text-center')} type="number" inputMode="numeric" placeholder="from" aria-label={`${label} from`} value={from} onChange={(e) => onFrom(e.target.value)} />
      <span className="text-muted-foreground" aria-hidden>
        –
      </span>
      <input className={cn(FIELD, NO_SPINNER, 'text-center')} type="number" inputMode="numeric" placeholder="to" aria-label={`${label} to`} value={to} onChange={(e) => onTo(e.target.value)} />
    </div>
  )
}

/** A single filter box: a number (centred under its heading) or a text search (left, under Car). */
export function FilterInput({
  label,
  value,
  onChange,
  placeholder,
  numeric = true,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  placeholder: string
  numeric?: boolean
}) {
  return (
    <div className={cn(BOX, numeric ? 'mx-auto w-16' : 'w-36')}>
      {!numeric && <Search className="ml-2 size-3.5 shrink-0 text-muted-foreground" />}
      <input
        className={cn(FIELD, numeric && cn(NO_SPINNER, 'text-center'))}
        type={numeric ? 'number' : 'text'}
        inputMode={numeric ? 'numeric' : undefined}
        placeholder={placeholder}
        aria-label={label}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  )
}

export interface Sort<K extends string> {
  key: K
  dir: 1 | -1
}

/** A clickable column heading; centred unless `left`. The sort arrow hangs off the right so the label stays centred. */
export function SortHead<K extends string>({
  k,
  sort,
  onSort,
  left,
  className,
  children,
}: {
  k: K
  sort: Sort<K>
  onSort: (k: K) => void
  left?: boolean
  className?: string
  children: ReactNode
}) {
  const Arrow = sort.dir === 1 ? ArrowUp : ArrowDown
  return (
    <TableHead className={cn(!left && 'text-center', className)}>
      <button className={cn('relative inline-flex items-center hover:text-foreground', sort.key === k && 'text-foreground')} onClick={() => onSort(k)}>
        {children}
        {sort.key === k && <Arrow className="absolute left-full ml-0.5 size-3" />}
      </button>
    </TableHead>
  )
}

/** Header cell holding a column's filter box(es); centred unless `left`. */
export function FilterHead({ left, children }: { left?: boolean; children?: ReactNode }) {
  return <TableHead className={cn('py-1.5', !left && 'text-center')}>{children}</TableHead>
}

/** "Columns" button with a checkbox per optional column. */
export function ColumnChooser<K extends string>({
  columns,
  shown,
  onToggle,
}: {
  columns: { key: K; label: string }[]
  shown: (k: K) => boolean
  onToggle: (k: K) => void
}) {
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="sm" variant="outline" title="Choose columns">
          <Columns3 /> Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Show columns</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuCheckboxItem checked disabled>
          Car
        </DropdownMenuCheckboxItem>
        {columns.map((c) => (
          <DropdownMenuCheckboxItem
            key={c.key}
            checked={shown(c.key)}
            onCheckedChange={() => onToggle(c.key)}
            onSelect={(e) => e.preventDefault()} // keep the menu open to tick several
          >
            {c.label}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
