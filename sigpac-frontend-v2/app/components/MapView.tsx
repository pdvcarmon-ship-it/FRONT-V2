'use client'

import { useEffect, useRef, useCallback } from 'react'

interface Props {
  onParcelaClick: (lat: number, lon: number) => void
  parcGeojson: any
  imagenUrl: string | null
  indiceColor: string
  seleccionando: boolean
}

export default function MapView({ onParcelaClick, parcGeojson, imagenUrl, indiceColor, seleccionando }: Props) {
  const mapRef = useRef<HTMLDivElement>(null)
  const mapInstanceRef = useRef<any>(null)
  const parcelaLayerRef = useRef<any>(null)
  const imagenLayerRef = useRef<any>(null)
  const clickHandlerRef = useRef<any>(null)

  useEffect(() => {
    if (typeof window === 'undefined' || !mapRef.current || mapInstanceRef.current) return

    const L = require('leaflet')
    require('leaflet/dist/leaflet.css')

    const map = L.map(mapRef.current, {
      center: [40.0, -3.5],
      zoom: 6,
      zoomControl: false,
    })

    // Fondo satélite Esri
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',
      { attribution: '© Esri, Maxar, Earthstar Geographics', maxZoom: 20 }
    ).addTo(map)

    // Capa WMS SIGPAC encima del satélite
    L.tileLayer.wms('https://sigpac-hubcloud.es/wms', {
      layers: 'recintos',
      format: 'image/png',
      transparent: true,
      version: '1.3.0',
      opacity: 0.55,
      attribution: '© FEGA SIGPAC',
      maxZoom: 20,
    }).addTo(map)

    // Labels encima de todo (Esri labels)
    L.tileLayer(
      'https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}',
      { attribution: '', maxZoom: 20, opacity: 0.7 }
    ).addTo(map)

    // Controles
    L.control.zoom({ position: 'bottomright' }).addTo(map)
    L.control.scale({ imperial: false, position: 'bottomright' }).addTo(map)

    mapInstanceRef.current = map
  }, [])

  // Actualiza el cursor y handler de clic según modo selección
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return
    const container = map.getContainer()

    // Limpia handler anterior
    if (clickHandlerRef.current) {
      map.off('click', clickHandlerRef.current)
    }

    if (seleccionando) {
      container.classList.add('selecting')
      const handler = (e: any) => {
        onParcelaClick(e.latlng.lat, e.latlng.lng)
      }
      clickHandlerRef.current = handler
      map.on('click', handler)
    } else {
      container.classList.remove('selecting')
      clickHandlerRef.current = null
    }
  }, [seleccionando, onParcelaClick])

  // Dibuja parcela seleccionada
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return
    const L = require('leaflet')

    if (parcelaLayerRef.current) {
      map.removeLayer(parcelaLayerRef.current)
      parcelaLayerRef.current = null
    }
    if (!parcGeojson) return

    const layer = L.geoJSON(parcGeojson, {
      style: {
        color: indiceColor,
        weight: 3,
        fillColor: indiceColor,
        fillOpacity: 0.12,
        dashArray: '6 3',
      },
    }).addTo(map)

    parcelaLayerRef.current = layer

    try { map.fitBounds(layer.getBounds(), { padding: [60, 60], maxZoom: 18 }) } catch {}
  }, [parcGeojson, indiceColor])

  // Overlay imagen índice
  useEffect(() => {
    const map = mapInstanceRef.current
    if (!map) return
    const L = require('leaflet')

    if (imagenLayerRef.current) {
      map.removeLayer(imagenLayerRef.current)
      imagenLayerRef.current = null
    }
    if (!imagenUrl || !parcGeojson?.features?.length) return

    const geom = parcGeojson.features[0].geometry
    const allCoords: number[][] = []
    const extractCoords = (g: any) => {
      if (g.type === 'Polygon') allCoords.push(...g.coordinates[0])
      else if (g.type === 'MultiPolygon') g.coordinates.forEach((p: any) => allCoords.push(...p[0]))
    }
    extractCoords(geom)

    if (!allCoords.length) return
    const lons = allCoords.map(c => c[0])
    const lats = allCoords.map(c => c[1])

    const bounds: [[number, number], [number, number]] = [
      [Math.min(...lats), Math.min(...lons)],
      [Math.max(...lats), Math.max(...lons)],
    ]

    imagenLayerRef.current = L.imageOverlay(imagenUrl, bounds, { opacity: 0.82 }).addTo(map)
  }, [imagenUrl, parcGeojson])

  return <div ref={mapRef} style={{ width: '100%', height: '100%' }} />
}
