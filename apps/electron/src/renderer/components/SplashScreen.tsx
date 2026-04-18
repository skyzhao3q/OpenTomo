import { motion } from 'motion/react'
import { OpenTomoSymbol } from './icons/OpenTomoSymbol'
import { UpdateProgress } from './UpdateProgress'

interface SplashScreenProps {
  isExiting: boolean
  onExitComplete?: () => void
  /** Update download info (optional) */
  updateInfo?: {
    version: string
    progress: number
    isDownloading: boolean
  }
}

/**
 * SplashScreen - Shows OpenTomo symbol during app initialization
 *
 * Displays centered symbol on app background, fades out when app is fully ready.
 * On exit, the symbol scales up and fades out quickly while the background fades slower.
 * Optionally shows update download progress if an update is being downloaded.
 */
export function SplashScreen({ isExiting, onExitComplete, updateInfo }: SplashScreenProps) {
  return (
    <motion.div
      className="fixed inset-0 z-splash flex items-center justify-center bg-background"
      initial={{ opacity: 1 }}
      animate={{ opacity: isExiting ? 0 : 1 }}
      transition={{ duration: 0.5, ease: 'easeOut' }}
      onAnimationComplete={() => {
        if (isExiting && onExitComplete) {
          onExitComplete()
        }
      }}
    >
      <div className="flex flex-col items-center">
        <motion.div
          initial={{ scale: 1.5, opacity: 1 }}
          animate={{
            scale: isExiting ? 3 : 1.5,
            opacity: isExiting ? 0 : 1
          }}
          transition={{
            duration: 0.2,
            ease: [0.16, 1, 0.3, 1] // Exponential out curve
          }}
        >
          <OpenTomoSymbol className="size-40 text-accent" />
        </motion.div>

        {/* Show update progress if downloading */}
        {updateInfo && !isExiting && (
          <UpdateProgress
            version={updateInfo.version}
            progress={updateInfo.progress}
            isDownloading={updateInfo.isDownloading}
          />
        )}
      </div>
    </motion.div>
  )
}
