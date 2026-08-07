
import { Switch, Tooltip, TooltipContent, TooltipTrigger } from '@matser/ui'
interface HookToggleProps {
  enabled: boolean
  disabled?: boolean
  onToggle: (enabled: boolean) => void
  size?: 'sm' | 'base' | 'lg'
}

// Enable/disable toggle for bound hooks. Used in the Connections tab, Activity log, and inline chat.
export function HookToggle({ enabled, disabled = false, onToggle, size = 'sm' }: HookToggleProps) {
  return (
    <Tooltip>
      <TooltipTrigger render={<span className="inline-flex items-center">
        <Switch
          checked={enabled}
          disabled={disabled}
          size={size === 'base' ? 'md' : size}
          onCheckedChange={(checked) => onToggle(checked)}
          aria-label={enabled ? 'Disable hook' : 'Enable hook'}
        />
      </span>} />
      <TooltipContent>{enabled ? 'Disable this hook.' : 'Enable this hook.'}</TooltipContent>
    </Tooltip>
  )
}
