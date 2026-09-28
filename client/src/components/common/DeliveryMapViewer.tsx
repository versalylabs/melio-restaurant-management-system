import React, { useEffect, useRef } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { Navigation, MapPin, ExternalLink, Compass } from 'lucide-react';

interface DeliveryMapViewerProps {
  address: string;
  customerName?: string;
  orderNumber?: string;
  branchName?: string;
  branchCoords?: { lat: number; lng: number };
}

// Custom customer pin
const createCustomerPin = () => {
  return L.divIcon({
    className: 'custom-customer-pin',
    html: `
      <div style="position: relative; display: flex; flex-direction: column; align-items: center; transform: translate(-50%, -100%);">
        <div style="
          width: 38px;
          height: 38px;
          background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
          border: 2.5px solid #ffffff;
          box-shadow: 0 8px 24px rgba(234, 88, 12, 0.5), 0 2px 6px rgba(0,0,0,0.3);
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          display: flex;
          align-items: center;
          justify-content: center;
        ">
          <div style="transform: rotate(45deg); color: white; font-weight: bold; font-size: 14px;">📍</div>
        </div>
        <div style="width: 14px; height: 4px; background: rgba(0,0,0,0.3); border-radius: 50%; filter: blur(1.5px); margin-top: 2px;"></div>
      </div>
    `,
    iconSize: [38, 44],
    iconAnchor: [19, 44],
  });
};

// Custom restaurant branch pin
const createBranchPin = () => {
  return L.divIcon({
    className: 'custom-branch-pin',
    html: `
      <div style="position: relative; display: flex; flex-direction: column; align-items: center; transform: translate(-50%, -100%);">
        <div style="
          width: 34px;
          height: 34px;
          background: linear-gradient(135deg, #10b981 0%, #059669 100%);
          border: 2px solid #ffffff;
          box-shadow: 0 6px 18px rgba(16, 185, 129, 0.45);
          border-radius: 50%;
          display: flex;
          align-items: center;
          justify-content: center;
          font-size: 15px;
        ">🍴</div>
        <div style="width: 12px; height: 3px; background: rgba(0,0,0,0.25); border-radius: 50%; filter: blur(1px); margin-top: 2px;"></div>
      </div>
    `,
    iconSize: [34, 38],
    iconAnchor: [17, 38],
  });
};

export default function DeliveryMapViewer({
  address,
  customerName,
  orderNumber,
  branchName = 'Melio Restaurant',
  branchCoords = { lat: -1.2921, lng: 36.8219 },
}: DeliveryMapViewerProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<L.Map | null>(null);

  const safeAddress = typeof address === 'string' ? address : '';

  // Parse [geo:lat,lng] from address string
  let targetCoords: { lat: number; lng: number } | null = null;
  const match = safeAddress.match(/\[(?:geo|Pinned Location):\s*([-\d.]+),\s*([-\d.]+)\]/i);
  if (match) {
    targetCoords = { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
  } else {
    // Check for lat/lng in text
    const latMatch = safeAddress.match(/(?:Lat|lat):\s*([-\d.]+)/);
    const lngMatch = safeAddress.match(/(?:Lng|lng):\s*([-\d.]+)/);
    if (latMatch && lngMatch) {
      targetCoords = { lat: parseFloat(latMatch[1]), lng: parseFloat(lngMatch[2]) };
    }
  }

  // Fallback coords if no GPS attached: slight offset from branch
  const destCoords = targetCoords || {
    lat: branchCoords.lat + 0.012,
    lng: branchCoords.lng + 0.015,
  };

  useEffect(() => {
    if (!containerRef.current) return;
    if (mapRef.current) {
      try {
        mapRef.current.remove();
      } catch (_) {}
      mapRef.current = null;
    }

    try {
      const map = L.map(containerRef.current, {
        center: [destCoords.lat, destCoords.lng],
        zoom: 14,
        zoomControl: false,
      });

      L.control.zoom({ position: 'bottomright' }).addTo(map);

      // OpenStreetMap Tiles
      L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
        maxZoom: 19,
        attribution: '© OpenStreetMap contributors',
      }).addTo(map);

      // Customer Marker
      const customerMarker = L.marker([destCoords.lat, destCoords.lng], {
        icon: createCustomerPin(),
      }).addTo(map);

      customerMarker.bindPopup(`
        <div style="font-family: sans-serif; font-size: 12px; color: #111;">
          <b style="color: #ea580c;">Delivery Destination</b><br/>
          ${customerName ? `<b>Customer:</b> ${customerName}<br/>` : ''}
          ${orderNumber ? `<b>Order:</b> #${orderNumber}<br/>` : ''}
          ${safeAddress.replace(/\s*\[geo:[-\d.]+,\s*[-\d.]+\]/, '')}
        </div>
      `);

    // Branch Marker
    const branchMarker = L.marker([branchCoords.lat, branchCoords.lng], {
      icon: createBranchPin(),
    }).addTo(map);

    branchMarker.bindPopup(`
      <div style="font-family: sans-serif; font-size: 12px; color: #111;">
        <b style="color: #059669;">Kitchen / Branch</b><br/>
        ${branchName}
      </div>
    `);

    // Polyline connecting branch to customer destination
    const pathLine = L.polyline(
      [
        [branchCoords.lat, branchCoords.lng],
        [destCoords.lat, destCoords.lng],
      ],
      {
        color: '#f97316',
        weight: 3.5,
        opacity: 0.85,
        dashArray: '8, 8',
      }
    ).addTo(map);

    // Fit bounds to show both restaurant and customer
    const bounds = L.latLngBounds([
      [branchCoords.lat, branchCoords.lng],
      [destCoords.lat, destCoords.lng],
    ]);
    map.fitBounds(bounds, { padding: [40, 40] });

      mapRef.current = map;
    } catch (err) {
      console.warn('DeliveryMapViewer Leaflet initialization warning:', err);
    }

    return () => {
      if (mapRef.current) {
        try {
          mapRef.current.remove();
        } catch (_) {}
        mapRef.current = null;
      }
    };
  }, [destCoords.lat, destCoords.lng, branchCoords.lat, branchCoords.lng]);

  const googleMapsUrl = `https://www.google.com/maps/dir/?api=1&destination=${destCoords.lat},${destCoords.lng}`;
  const osmUrl = `https://www.openstreetmap.org/directions?engine=fossgis_osrm_car&route=${branchCoords.lat},${branchCoords.lng}%3B${destCoords.lat},${destCoords.lng}`;

  const cleanText = safeAddress.replace(/\s*\[geo:[-\d.]+,\s*[-\d.]+\]/, '');

  return (
    <div className="rounded-2xl overflow-hidden border border-orange-500/20 bg-white/70 dark:bg-[#111116]/80 backdrop-blur-xl shadow-xl transition-all">
      {/* Map Header */}
      <div className="p-3 bg-gradient-to-r from-orange-500/10 via-amber-500/5 to-transparent border-b border-orange-500/15 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="p-1.5 rounded-lg bg-orange-500/15 text-orange-500">
            <MapPin size={16} />
          </div>
          <div className="min-w-0">
            <h4 className="text-xs font-bold text-gray-900 dark:text-gray-100 truncate">
              {customerName ? `${customerName}'s Delivery Location` : 'Customer Delivery Location'}
            </h4>
            <p className="text-[11px] text-gray-500 dark:text-gray-400 truncate">{cleanText}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          <a
            href={googleMapsUrl}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 text-white text-[11px] font-semibold shadow-md shadow-orange-500/25 hover:from-orange-600 hover:to-amber-600 transition"
          >
            <Navigation size={11} />
            <span>Turn-by-Turn GPS</span>
            <ExternalLink size={10} />
          </a>
        </div>
      </div>

      {/* Live Map Canvas */}
      <div className="relative">
        <div ref={containerRef} className="w-full h-48 sm:h-56 z-0" />
        <div className="absolute top-2 left-2 z-[400] pointer-events-none">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/75 backdrop-blur-md text-[10px] font-semibold text-white border border-white/10">
            <Compass size={10} className="text-orange-400 animate-spin" /> Live OpenStreetMap Pin
          </span>
        </div>
      </div>
    </div>
  );
}
