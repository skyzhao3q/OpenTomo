import appIcon from "@/assets/app-icon.png"

interface OpenTomoAppIconProps {
  className?: string
  size?: number
}

/**
 * OpenTomoAppIcon - Displays the OpenTomo logo (colorful "C" icon)
 */
export function OpenTomoAppIcon({ className, size = 64 }: OpenTomoAppIconProps) {
  return (
    <img
      src={appIcon}
      alt="OpenTomo"
      width={size}
      height={size}
      className={className}
    />
  )
}
