'use client'

import dynamic from 'next/dynamic'
import { useState, useEffect, useCallback } from 'react'

const MapView = dynamic(() => import('./components/MapView'), { ssr: false })

const BACKEND = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8000'

const INDICES = [
  { id: 'NDVI', label: 'NDVI', desc: 'Vegetación',     color: '#3ddc6e' },
  { id: 'NDWI', label: 'NDWI', desc: 'Agua',           color: '#4db8ff' },
  { id: 'EVI',  label: 'EVI',  desc: 'Veg. avanzada',  color: '#86efac' },
  { id: 'NDRE', label: 'NDRE', desc: 'Red Edge',       color: '#a3e635' },
  { id: 'SAVI', label: 'SAVI', desc: 'Suelo ajust.',   color: '#fde68a' },
]

type Estado = 'idle' | 'cargando_parcela' | 'parcela_ok' | 'buscando' | 'calculando' | 'done' | 'error'

export default function Home() {
  const [estado, setEstado] = useState<Estado>('idle')
  const [error, setError] = useState('')
  const [backendOk, setBackendOk] = useState<boolean | null>(null)
  const [seleccionando, setSeleccionando] = useState(false)

  const [parcGeojson, setParcGeojson] = useState<any>(null)
  const [parcelaInfo, setParcelaInfo] = useState<any>(null)

  const [fechaInicio, setFechaInicio] = useState('2024-05-01')
  const [fechaFin, setFechaFin] = useState('2024-08-31')
  const [productos, setProductos] = useState<any[]>([])
  const [productoSel, setProductoSel] = useState('')

  const [indice, setIndice] = useState('NDVI')
  const [imagenUrl, setImagenUrl] = useState<string | null>(null)
  const [stats, setStats] = useState<any>(null)

  const indiceActual = INDICES.find(i => i.id === indice)!

  // Health check
  useEffect(() => {
    fetch(`${BACKEND}/health`)
      .then(r => setBackendOk(r.ok))
      .catch(() => setBackendOk(false))
  }, [])

  // Clic en el mapa → busca parcela por punto
  const handleMapClick = useCallback(async (lat: number, lon: number) => {
    setSeleccionando(false)
    setEstado('cargando_parcela')
    setError('')
    setParcGeojson(null)
    setParcelaInfo(null)
    setProductos([])
    setImagenUrl(null)
    setStats(null)

    try {
      const url = `${BACKEND}/sigpac/punto?lat=${lat}&lon=${lon}`
      const r = await fetch(url)
      if (!r.ok) {
        const d = await r.json()
        throw new Error(d.detail || `Error ${r.status}`)
      }
      const data = await r.json()
      setParcGeojson(data)

      // Extrae info de la parcela
      const props = data.features?.[0]?.properties || {}
      setParcelaInfo(props)
      setEstado('parcela_ok')
    } catch (e: any) {
      setEstado('error')
      setError('No se encontró parcela: ' + e.message)
    }
  }, [])

  // Buscar imágenes Sentinel para la parcela seleccionada
  const buscarImagenes = async () => {
    if (!parcGeojson?.features?.length) return
    setEstado('buscando')
    setError('')
    setProductos([])

    try {
      const geom = parcGeojson.features[0].geometry
      const allCoords: number[][] = []
      if (geom.type === 'Polygon') allCoords.push(...geom.coordinates[0])
      else if (geom.type === 'MultiPolygon') geom.coordinates.forEach((p: any) => allCoords.push(...p[0]))

      const lons = allCoords.map(c => c[0])
      const lats = allCoords.map(c => c[1])
      const bbox = `${Math.min(...lons)},${Math.min(...lats)},${Math.max(...lons)},${Math.max(...lats)}`

      const url = `${BACKEND}/sentinel/buscar?bbox=${bbox}&fecha_inicio=${fechaInicio}&fecha_fin=${fechaFin}&max_nubosidad=30`
      const r = await fetch(url)
      if (!r.ok) throw new Error(`Error ${r.status}`)
      const data = await r.json()

      if (!data.productos?.length) {
        setEstado('parcela_ok')
        setError('No hay imágenes disponibles en ese periodo. Prueba otro rango de fechas.')
        return
      }

      setProductos(data.productos)
      setProductoSel(data.productos[0].id)
      setEstado('parcela_ok')
    } catch (e: any) {
      setEstado('error')
      setError('Error buscando imágenes: ' + e.message)
    }
  }

  // Calcular índice
  const calcular = async () => {
    if (!productoSel) { setError('Primero busca imágenes'); return }
    setEstado('calculando')
    setError('')
    setImagenUrl(null)
    setStats(null)

    try {
      const geom = parcGeojson.features[0].geometry
      const allCoords: number[][] = []
      if (geom.type === 'Polygon') allCoords.push(...geom.coordinates[0])
      else if (geom.type === 'MultiPolygon') geom.coordinates.forEach((p: any) => allCoords.push(...p[0]))
      const lons = allCoords.map(c => c[0])
      const lats = allCoords.map(c => c[1])
      const bbox = `${Math.min(...lons)},${Math.min(...lats)},${Math.max(...lons)},${Math.max(...lats)}`

      const base = `${BACKEND}/indice/calcular?producto_id=${productoSel}&indice=${indice}&bbox=${bbox}`

      const [sr, ir] = await Promise.all([
        fetch(`${base}&formato=stats`),
        fetch(`${base}&formato=png`),
      ])

      if (!sr.ok || !ir.ok) throw new Error('Error calculando índice')

      const statsData = await sr.json()
      setStats(statsData)

      const blob = await ir.blob()
      setImagenUrl(URL.createObjectURL(blob))
      setEstado('done')
    } catch (e: any) {
      setEstado('error')
      setError('Error al calcular: ' + e.message)
    }
  }

  const paso = estado === 'idle' || estado === 'cargando_parcela' ? 1
    : estado === 'parcela_ok' && !productos.length ? 2
    : estado === 'parcela_ok' && productos.length ? 3
    : estado === 'calculando' || estado === 'done' ? 4 : 1

  return (
    <div style={{ display: 'flex', height: '100vh', overflow: 'hidden' }}>

      {/* ── SIDEBAR ─────────────────────────────────────────────────── */}
      <aside style={{
        width: 280, height: '100vh', overflowY: 'auto',
        padding: 16, display: 'flex', flexDirection: 'column', gap: 14,
        borderRight: '1px solid var(--border)',
        background: 'var(--surface)', flexShrink: 0,
      }}>

        {/* Header */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 2 }}>
            <span style={{ fontSize: 20 }}>🌱</span>
            <span style={{ fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 12, color: 'var(--green)', letterSpacing: '0.05em' }}>
              SIGPAC · SENTINEL
            </span>
          </div>
          <p style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'var(--mono)' }}>
            Visor de índices espectrales
          </p>
        </div>

        {/* Backend status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
          <span className={backendOk ? 'pulse' : ''} style={{
            width: 7, height: 7, borderRadius: '50%', display: 'inline-block',
            background: backendOk === null ? '#4a7a56' : backendOk ? 'var(--green)' : 'var(--red)',
          }}/>
          <span style={{ fontSize: 10, fontFamily: 'var(--mono)', color: 'var(--muted)' }}>
            {backendOk === null ? 'CONECTANDO...' : backendOk ? 'BACKEND OK' : 'BACKEND OFFLINE'}
          </span>
        </div>

        <hr style={{ borderColor: 'var(--border)', borderWidth: '0 0 1px 0' }} />

        {/* ── PASO 1: Seleccionar parcela ── */}
        <section>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
            <span style={{
              width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              background: paso >= 1 ? 'var(--green)' : 'var(--surface2)',
              fontSize: 10, fontWeight: 700, color: paso >= 1 ? 'var(--bg)' : 'var(--muted)', flexShrink: 0,
            }}>1</span>
            <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--green)', letterSpacing: '0.08em' }}>
              SELECCIONAR PARCELA
            </span>
          </div>

          <button
            onClick={() => setSeleccionando(s => !s)}
            style={{
              width: '100%', padding: '10px', borderRadius: 8,
              background: seleccionando ? 'var(--green)' : 'var(--surface2)',
              border: `1px solid ${seleccionando ? 'var(--green)' : 'var(--border)'}`,
              color: seleccionando ? 'var(--bg)' : 'var(--text)',
              fontFamily: 'var(--mono)', fontSize: 12, fontWeight: 700,
              cursor: 'pointer', letterSpacing: '0.06em',
              display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
              transition: 'all 0.2s',
            }}
          >
            {estado === 'cargando_parcela'
              ? <><span className="spinner"/> BUSCANDO PARCELA...</>
              : seleccionando
              ? '✕ CANCELAR SELECCIÓN'
              : '⊕ CLIC EN EL MAPA'}
          </button>

          {seleccionando && (
            <div style={{
              marginTop: 8, padding: '8px 10px', borderRadius: 6,
              background: 'rgba(77,184,255,0.06)', border: '1px solid rgba(77,184,255,0.2)',
              fontSize: 11, color: 'var(--blue)', fontFamily: 'var(--mono)',
            }}>
              👆 Haz clic sobre una parcela en el mapa
            </div>
          )}

          {parcelaInfo && (
            <div style={{
              marginTop: 8, padding: '10px', borderRadius: 6,
              background: 'var(--green-dim)', border: '1px solid rgba(61,220,110,0.2)',
              fontSize: 11, fontFamily: 'var(--mono)',
            }}>
              <div style={{ color: 'var(--green)', fontWeight: 700, marginBottom: 6 }}>✓ PARCELA SELECCIONADA</div>
              {parcelaInfo.provincia !== undefined && (
                <div style={{ color: 'var(--muted)', lineHeight: 1.8 }}>
                  {parcelaInfo.provincia && <div>Prov: <span style={{ color: 'var(--text)' }}>{parcelaInfo.provincia}</span></div>}
                  {parcelaInfo.municipio && <div>Mun: <span style={{ color: 'var(--text)' }}>{parcelaInfo.municipio}</span></div>}
                  {parcelaInfo.poligono && <div>Pol: <span style={{ color: 'var(--text)' }}>{parcelaInfo.poligono}</span></div>}
                  {parcelaInfo.parcela && <div>Par: <span style={{ color: 'var(--text)' }}>{parcelaInfo.parcela}</span></div>}
                  {parcelaInfo.uso_sigpac && <div>Uso: <span style={{ color: 'var(--text)' }}>{parcelaInfo.uso_sigpac}</span></div>}
                  {parcelaInfo.superficie && <div>Sup: <span style={{ color: 'var(--text)' }}>{Number(parcelaInfo.superficie).toFixed(2)} ha</span></div>}
                </div>
              )}
            </div>
          )}
        </section>

        {/* ── PASO 2: Fechas ── */}
        {parcGeojson && (
          <>
            <hr style={{ borderColor: 'var(--border)', borderWidth: '0 0 1px 0' }} />
            <section>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <span style={{
                  width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: paso >= 2 ? 'var(--green)' : 'var(--surface2)',
                  fontSize: 10, fontWeight: 700, color: paso >= 2 ? 'var(--bg)' : 'var(--muted)', flexShrink: 0,
                }}>2</span>
                <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--green)', letterSpacing: '0.08em' }}>
                  PERIODO
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6, marginBottom: 8 }}>
                {[
                  { label: 'Desde', val: fechaInicio, set: setFechaInicio },
                  { label: 'Hasta', val: fechaFin, set: setFechaFin },
                ].map(f => (
                  <div key={f.label}>
                    <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.1em' }}>{f.label}</div>
                    <input
                      type="date"
                      value={f.val}
                      onChange={e => f.set(e.target.value)}
                      style={{
                        width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)',
                        borderRadius: 5, padding: '5px 6px', color: 'var(--text)', fontSize: 11,
                        fontFamily: 'var(--mono)', outline: 'none',
                      }}
                    />
                  </div>
                ))}
              </div>

              <button
                onClick={buscarImagenes}
                disabled={estado === 'buscando'}
                style={{
                  width: '100%', padding: '8px', borderRadius: 6,
                  background: 'transparent', border: '1px solid var(--blue)',
                  color: 'var(--blue)', fontSize: 11, fontFamily: 'var(--mono)',
                  cursor: estado === 'buscando' ? 'wait' : 'pointer', letterSpacing: '0.06em',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                  transition: 'all 0.15s',
                }}
              >
                {estado === 'buscando'
                  ? <><span className="spinner"/> BUSCANDO...</>
                  : '◎ BUSCAR IMÁGENES'}
              </button>

              {productos.length > 0 && (
                <div style={{ marginTop: 8 }}>
                  <div style={{ fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)', marginBottom: 3, textTransform: 'uppercase', letterSpacing: '0.1em' }}>
                    Imagen ({productos.length} disponibles)
                  </div>
                  <select
                    value={productoSel}
                    onChange={e => setProductoSel(e.target.value)}
                    style={{
                      width: '100%', background: 'var(--surface2)', border: '1px solid var(--border)',
                      borderRadius: 5, padding: '5px 6px', color: 'var(--text)', fontSize: 10,
                      fontFamily: 'var(--mono)', outline: 'none',
                    }}
                  >
                    {productos.map(p => (
                      <option key={p.id} value={p.id}>
                        {p.fecha} · ☁ {p.nubosidad ?? '?'}% · {p.size_mb}MB
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </section>
          </>
        )}

        {/* ── PASO 3: Índice ── */}
        {productos.length > 0 && (
          <>
            <hr style={{ borderColor: 'var(--border)', borderWidth: '0 0 1px 0' }} />
            <section>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10 }}>
                <span style={{
                  width: 20, height: 20, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                  background: 'var(--green)', fontSize: 10, fontWeight: 700, color: 'var(--bg)', flexShrink: 0,
                }}>3</span>
                <span style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--green)', letterSpacing: '0.08em' }}>
                  ÍNDICE ESPECTRAL
                </span>
              </div>

              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5, marginBottom: 10 }}>
                {INDICES.map(idx => (
                  <button
                    key={idx.id}
                    onClick={() => setIndice(idx.id)}
                    style={{
                      padding: '7px 6px', borderRadius: 6,
                      border: `1px solid ${indice === idx.id ? idx.color : 'var(--border)'}`,
                      background: indice === idx.id ? idx.color : 'var(--surface2)',
                      color: indice === idx.id ? 'var(--bg)' : 'var(--muted)',
                      fontFamily: 'var(--mono)', fontSize: 11, cursor: 'pointer',
                      transition: 'all 0.15s', fontWeight: indice === idx.id ? 700 : 400,
                    }}
                  >
                    <div style={{ fontWeight: 700 }}>{idx.label}</div>
                    <div style={{ fontSize: 9, opacity: 0.7, marginTop: 1 }}>{idx.desc}</div>
                  </button>
                ))}
              </div>

              <button
                onClick={calcular}
                disabled={estado === 'calculando'}
                style={{
                  width: '100%', padding: '11px', borderRadius: 8,
                  background: estado === 'calculando' ? 'var(--surface2)' : indiceActual.color,
                  border: 'none', color: 'var(--bg)',
                  fontFamily: 'var(--mono)', fontWeight: 700, fontSize: 13,
                  cursor: estado === 'calculando' ? 'wait' : 'pointer',
                  letterSpacing: '0.08em',
                  display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
                  transition: 'all 0.2s',
                }}
              >
                {estado === 'calculando'
                  ? <><span className="spinner" style={{ borderTopColor: 'var(--bg)' }}/> PROCESANDO...</>
                  : `▶ CALCULAR ${indice}`}
              </button>
            </section>
          </>
        )}

        {/* ── PASO 4: Stats ── */}
        {stats && (
          <>
            <hr style={{ borderColor: 'var(--border)', borderWidth: '0 0 1px 0' }} />
            <section>
              <div style={{ fontSize: 11, fontFamily: 'var(--mono)', color: 'var(--green)', letterSpacing: '0.08em', marginBottom: 8 }}>
                ESTADÍSTICAS · {indice}
              </div>
              {stats.modo && (
                <div style={{
                  padding: '5px 8px', borderRadius: 4, marginBottom: 6,
                  background: 'rgba(251,191,36,0.08)', border: '1px solid rgba(251,191,36,0.2)',
                  fontSize: 10, color: 'var(--amber)', fontFamily: 'var(--mono)',
                }}>⚠ MODO DEMO</div>
              )}
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 5 }}>
                {[
                  { k: 'MÍN', v: stats.min?.toFixed(3) },
                  { k: 'MÁX', v: stats.max?.toFixed(3) },
                  { k: 'MEDIA', v: stats.mean?.toFixed(3) },
                  { k: 'DESV.', v: stats.std?.toFixed(3) },
                ].map(s => (
                  <div key={s.k} style={{
                    background: 'var(--surface2)', border: '1px solid var(--border)',
                    borderRadius: 6, padding: '7px 10px',
                  }}>
                    <div style={{ fontSize: 8, fontFamily: 'var(--mono)', color: 'var(--muted)', textTransform: 'uppercase', letterSpacing: '0.1em' }}>{s.k}</div>
                    <div style={{ fontSize: 15, fontFamily: 'var(--mono)', fontWeight: 700, color: indiceActual.color, marginTop: 2 }}>{s.v}</div>
                  </div>
                ))}
              </div>
            </section>
          </>
        )}

        {/* Error */}
        {error && (
          <div style={{
            padding: '8px 10px', borderRadius: 6,
            background: 'rgba(255,107,107,0.08)', border: '1px solid rgba(255,107,107,0.2)',
            color: '#fca5a5', fontSize: 11, fontFamily: 'var(--mono)',
          }}>
            ⚠ {error}
          </div>
        )}

        {/* Footer */}
        <div style={{ marginTop: 'auto', paddingTop: 8, fontSize: 9, color: 'var(--muted)', fontFamily: 'var(--mono)', lineHeight: 1.7 }}>
          SIGPAC WMS · Copernicus DS<br />
          FastAPI · NumPy · Pillow<br />
          100% FREE & OPEN DATA
        </div>
      </aside>

      {/* ── MAPA ─────────────────────────────────────────────────────── */}
      <div style={{ flex: 1, position: 'relative' }}>
        <MapView
          onParcelaClick={handleMapClick}
          parcGeojson={parcGeojson}
          imagenUrl={imagenUrl}
          indiceColor={indiceActual.color}
          seleccionando={seleccionando}
        />

        {/* Badge índice activo */}
        <div style={{
          position: 'absolute', top: 12, right: 12, zIndex: 1000,
          fontFamily: 'var(--mono)', fontSize: 11,
          background: 'rgba(15,26,18,0.92)', border: '1px solid var(--border)',
          backdropFilter: 'blur(8px)', borderRadius: 6, padding: '6px 12px',
          display: 'flex', alignItems: 'center', gap: 8,
        }}>
          <span style={{ color: 'var(--muted)' }}>ÍNDICE</span>
          <span style={{ color: indiceActual.color, fontWeight: 700 }}>{indice}</span>
          {estado === 'done' && <span style={{ color: 'var(--green)' }}>✓</span>}
        </div>

        {/* Empty state */}
        {estado === 'idle' && !seleccionando && (
          <div style={{
            position: 'absolute', top: '50%', left: '50%',
            transform: 'translate(-50%, -50%)',
            textAlign: 'center', pointerEvents: 'none', zIndex: 500,
          }}>
            <div style={{ fontSize: 56, marginBottom: 14, opacity: 0.2 }}>🌾</div>
            <p style={{ color: 'var(--muted)', fontFamily: 'var(--mono)', fontSize: 13, letterSpacing: '0.08em', lineHeight: 1.8 }}>
              PULSA "CLIC EN EL MAPA"<br />Y SELECCIONA UNA PARCELA
            </p>
          </div>
        )}

        {/* Instrucción seleccionando */}
        {seleccionando && (
          <div style={{
            position: 'absolute', bottom: 40, left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 1000, pointerEvents: 'none',
            background: 'rgba(77,184,255,0.1)', border: '1px solid var(--blue)',
            backdropFilter: 'blur(8px)', borderRadius: 8,
            padding: '10px 20px',
            fontFamily: 'var(--mono)', fontSize: 12, color: 'var(--blue)',
            letterSpacing: '0.06em',
          }}>
            👆 HAZ CLIC SOBRE UNA PARCELA EN EL MAPA
          </div>
        )}
      </div>
    </div>
  )
}
