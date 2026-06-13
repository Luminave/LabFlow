/**
 * afterPack hook for electron-builder
 * Runs rcedit to embed the application icon into the exe
 * (bypasses signAndEditExecutable: false which skips rcedit)
 */
const { rcedit } = require('rcedit')
const path = require('path')
const fs = require('fs')

module.exports = async function(context) {
  // Only run on Windows
  if (context.electronPlatformName !== 'win32') return

  const productName = context.packager.config.productName || 'LabFlow'
  const exePath = path.join(context.appOutDir, productName + '.exe')
  const iconPath = path.resolve(__dirname, '..', 'build', 'icon.ico')

  // Verify files exist
  if (!fs.existsSync(exePath)) {
    console.error(`[afterPack] Exe not found: ${exePath}`)
    return
  }
  if (!fs.existsSync(iconPath)) {
    console.error(`[afterPack] Icon not found: ${iconPath}`)
    return
  }

  console.log(`[afterPack] Embedding icon: ${iconPath}`)
  console.log(`[afterPack] Target exe: ${exePath}`)

  try {
    await rcedit(exePath, {
      icon: iconPath,
      'file-version': context.packager.config.extraMetadata?.version || '0.0.0',
      'product-version': context.packager.config.extraMetadata?.version || '0.0.0',
      'version-string': {
        FileDescription: productName,
        ProductName: productName,
        CompanyName: productName,
      }
    })
    console.log('[afterPack] Icon embedded successfully!')
  } catch (error) {
    console.error('[afterPack] Failed to embed icon:', error.message)
  }
}
