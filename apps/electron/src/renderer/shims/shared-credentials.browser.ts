// Browser stub for @opentomo/shared/credentials
// This prevents bundling Node-only crypto/fs code into the renderer.
// If any renderer code accidentally imports the credentials module, we throw
// with a clear error to guide developers.

export class CredentialManagerStub {
  constructor() {
    throw new Error(
      "@opentomo/shared/credentials is not available in the renderer. " +
      "Use main-process IPC to access credential storage."
    )
  }
}

export function getCredentialManager(): never {
  throw new Error(
    "getCredentialManager() cannot be used in the renderer. " +
    "Access credentials via main process APIs."
  )
}

export type CredentialId = never
export type CredentialType = never
export type StoredCredential = never