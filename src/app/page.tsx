'use client'

import dynamic from 'next/dynamic'

const GameShell = dynamic(() => import('@/components/game/GameShell'), {
  ssr: false,
  loading: () => (
    <div style={{
      position: 'fixed',
      inset: 0,
      background: '#1d201f',
      color: '#9ad',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      fontFamily: 'Times New Roman, serif',
      fontSize: 22,
      letterSpacing: 6,
      fontWeight: 900,
    }}>
      THE BIG CON
    </div>
  ),
})

export default function Home() {
  return <GameShell />
}
