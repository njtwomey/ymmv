import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select'
import { COLOUR_BY, type Dim, dimLabel } from '@/lib/dims'

export function ColourBySelect({ value, onChange }: { value: Dim; onChange: (d: Dim) => void }) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as Dim)}>
      <SelectTrigger size="sm" className="w-[16rem] max-w-full" aria-label="Colour by">
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {COLOUR_BY.map((d) => (
          <SelectItem key={d} value={d}>
            Colour: {dimLabel(d)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
