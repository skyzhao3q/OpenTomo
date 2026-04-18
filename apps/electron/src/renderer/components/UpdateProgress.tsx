import { motion } from 'motion/react'

interface UpdateProgressProps {
  version: string
  progress: number
  isDownloading: boolean
}

/**
 * UpdateProgress - Displays update download progress
 *
 * Shows version number and progress bar for downloading updates.
 * Used in splash screen during app launch.
 */
export function UpdateProgress({ version, progress, isDownloading }: UpdateProgressProps) {
  if (!isDownloading) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, y: -10 }}
      transition={{ duration: 0.3 }}
      className="flex flex-col items-center gap-3 mt-8"
    >
      {/* Update message */}
      <div className="text-sm text-muted-foreground">
        Downloading update v{version}
      </div>

      {/* Progress bar */}
      <div className="w-64 h-1.5 bg-border rounded-full overflow-hidden">
        <motion.div
          className="h-full bg-accent rounded-full"
          initial={{ width: 0 }}
          animate={{ width: `${progress}%` }}
          transition={{ duration: 0.2 }}
        />
      </div>

      {/* Progress percentage */}
      <div className="text-xs text-muted-foreground tabular-nums">
        {Math.round(progress)}%
      </div>
    </motion.div>
  )
}
