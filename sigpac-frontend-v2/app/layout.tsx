import type { Metadata } from 'next'
import './globals.css'

export const metadata: Metadata = {
  title: 'SIGPAC · Visor de Índices',
  description: 'Selecciona una parcela en el mapa y calcula índices espectrales Sentinel-2',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  )
}
