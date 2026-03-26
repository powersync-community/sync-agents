import craftLogo from "@/assets/craft_logo_c.svg"

interface CraftAppIconProps {
  className?: string
  size?: number
}

/**
 * CraftAppIcon - Displays the app logo (colorful "C" icon)
 */
export function CraftAppIcon({ className, size = 64 }: CraftAppIconProps) {
  return (
    <img
      src={craftLogo}
      alt="Sync Agents"
      width={size}
      height={size}
      className={className}
    />
  )
}
