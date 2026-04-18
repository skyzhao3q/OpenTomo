import appIcon from "@/assets/app-icon.png"

interface OpenTomoSymbolProps {
  className?: string
}

/**
 * OpenTomo app icon
 */
export function OpenTomoSymbol({ className }: OpenTomoSymbolProps) {
  return (
    <img
      src={appIcon}
      alt="OpenTomo"
      className={className}
      draggable={false}
    />
  )
}
