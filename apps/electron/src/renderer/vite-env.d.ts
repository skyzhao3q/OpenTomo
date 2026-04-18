/// <reference types="vite/client" />

interface ImportMetaEnv {
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

// Image imports
declare module "*.png" {
  const src: string
  export default src
}

declare module "*.jpg" {
  const src: string
  export default src
}

declare module "*.jpeg" {
  const src: string
  export default src
}

declare module "*.svg" {
  const src: string
  export default src
}

// Electron webview tag (enabled via webviewTag: true in webPreferences)
declare namespace React {
  namespace JSX {
    interface IntrinsicElements {
      webview: React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> & {
        src?: string
        allowpopups?: string
        partition?: string
        nodeintegration?: string
        webpreferences?: string
      }
    }
  }
}
