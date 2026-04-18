import appIcon from "@/assets/app-icon.png"

interface OpenTomoAgentsSymbolProps {
  className?: string
}

/**
 * OpenTomo Agents app icon
 */
export function OpenTomoAgentsSymbol({ className }: OpenTomoAgentsSymbolProps) {
  return (
    <img
      src={appIcon}
      alt="OpenTomo"
      className={className}
      draggable={false}
    />
  )
}
