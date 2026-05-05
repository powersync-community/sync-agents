import { motion } from 'motion/react'
import craftLogo from '@/assets/craft_logo_c.svg'

interface SplashScreenProps {
  isExiting: boolean
  onExitComplete?: () => void
}

/**
 * SplashScreen - Shows the Craft Agent logo during app initialization
 *
 * Displays centered logo on app background, fades out when app is fully ready.
 * On exit, the logo scales up and fades out quickly while the background fades slower.
 */
export function SplashScreen({ isExiting, onExitComplete }: SplashScreenProps) {
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
        <img src={craftLogo} alt="Craft Agent" className="h-10 w-10 object-contain" />
      </motion.div>
    </motion.div>
  )
}
