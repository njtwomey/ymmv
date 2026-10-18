import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'

/** Multi-select chips. An empty selection means "all". */
export function ChipGroup({
  options,
  value,
  onChange,
  label = (v) => v,
}: {
  options: { value: string; count: number }[]
  value: string[]
  onChange: (v: string[]) => void
  label?: (v: string) => string
}) {
  if (!options.length) return <p className="text-xs text-muted-foreground">None in this data</p>
  return (
    <ToggleGroup type="multiple" variant="outline" size="sm" value={value} onValueChange={onChange} className="flex flex-wrap justify-start" spacing={1}>
      {options.map((o) => (
        <ToggleGroupItem key={o.value} value={o.value} className="h-7 px-2 text-xs data-[state=on]:bg-primary data-[state=on]:text-primary-foreground">
          {label(o.value)}
          <span className="ml-1 tabular-nums opacity-60">{o.count}</span>
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
