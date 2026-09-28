import React, { useEffect, useRef, useState, useCallback } from 'react';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import { MapPin, Navigation, Search, Check, AlertCircle, RefreshCw } from 'lucide-react';

interface DeliveryLocationPickerProps {
  value: string;
  onChange: (val: string, coords?: { lat: number; lng: number }) => void;
  defaultCoords?: { lat: number; lng: number };
}

// Custom SVG Liquid Glass Pin Marker
const createCustomPinIcon = () => {
  return L.divIcon({
    className: 'custom-map-pin',
    html: `
      <div style="position: relative; display: flex; flex-direction: column; align-items: center; transform: translate(-50%, -100%);">
        <div style="
          width: 36px;
          height: 36px;
          background: linear-gradient(135deg, #f97316 0%, #ea580c 100%);
          border: 2px solid rgba(255, 255, 255, 0.9);
          box-shadow: 0 8px 24px rgba(234, 88, 12, 0.45), 0 2px 6px rgba(0,0,0,0.3);
          border-radius: 50% 50% 50% 0;
          transform: rotate(-45deg);
          display: flex;
          align-items: center;
          justify-content: center;
          cursor: grab;
          transition: transform 0.2s;
        ">
          <div style="
            transform: rotate(45deg);
            width: 12px;
            height: 12px;
            background: #ffffff;
            border-radius: 50%;
            box-shadow: 0 1px 3px rgba(0,0,0,0.2);
          "></div>
        </div>
        <div style="
          width: 14px;
          height: 4px;
          background: rgba(0, 0, 0, 0.25);
          border-radius: 50%;
          filter: blur(1.5px);
          margin-top: 2px;
        "></div>
      </div>
    `,
    iconSize: [36, 42],
    iconAnchor: [18, 42],
  });
};

// Default fallback coordinates: Nairobi, Kenya (-1.2921, 36.8219)
const DEFAULT_CENTER = { lat: -1.2921, lng: 36.8219 };

export default function DeliveryLocationPicker({
  value,
  onChange,
  defaultCoords = DEFAULT_CENTER,
}: DeliveryLocationPickerProps) {
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapInstanceRef = useRef<L.Map | null>(null);
  const markerRef = useRef<L.Marker | null>(null);

  const [coords, setCoords] = useState<{ lat: number; lng: number }>(() => {
    // Check if value has embedded coords: [geo:-1.23,36.45]
    const match = value.match(/\[geo:([-\d.]+),\s*([-\d.]+)\]/);
    if (match) {
      return { lat: parseFloat(match[1]), lng: parseFloat(match[2]) };
    }
    return defaultCoords;
  });

  const [isLocating, setIsLocating] = useState(false);
  const [isGeocoding, setIsGeocoding] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [addressFeedback, setAddressFeedback] = useState<string>('');

  // Reverse geocode via OpenStreetMap Nominatim
  const reverseGeocode = useCallback(
    async (lat: number, lng: number) => {
      setIsGeocoding(true);
      try {
        const res = await fetch(
          `https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=18&addressdetails=1`,
          {
            headers: {
              'Accept-Language': 'en',
            },
          }
        );
        if (res.ok) {
          const data = await res.json();
          if (data && data.display_name) {
            // Build a human-friendly address string
            const parts = [
              data.address?.building || data.address?.house_number,
              data.address?.road || data.address?.pedestrian,
              data.address?.suburb || data.address?.neighbourhood || data.address?.residential,
              data.address?.city || data.address?.town || data.address?.county,
            ].filter(Boolean);

            const readableAddress = parts.length > 0 ? parts.join(', ') : data.display_name;
            const fullAddress = `${readableAddress} [geo:${lat.toFixed(6)},${lng.toFixed(6)}]`;

            setAddressFeedback(readableAddress);
            onChange(fullAddress, { lat, lng });
          }
        }
      } catch (err) {
        console.warn('Reverse geocoding error:', err);
      } finally {
        setIsGeocoding(false);
      }
    },
    [onChange]
  );

  // Initialize Leaflet Map
  useEffect(() => {
    if (!mapContainerRef.current) return;
    if (mapInstanceRef.current) return;

    const initialLat = coords.lat;
    const initialLng = coords.lng;

    const map = L.map(mapContainerRef.current, {
      center: [initialLat, initialLng],
      zoom: 15,
      zoomControl: false,
    });

    L.control.zoom({ position: 'bottomright' }).addTo(map);

    // OpenStreetMap Tile Layer
    L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', {
      maxZoom: 19,
      attribution: '© OpenStreetMap contributors',
    }).addTo(map);

    // Marker
    const marker = L.marker([initialLat, initialLng], {
      icon: createCustomPinIcon(),
      draggable: true,
    }).addTo(map);

    markerRef.current = marker;
    mapInstanceRef.current = map;

    // Handle marker drag
    marker.on('dragend', () => {
      const pos = marker.getLatLng();
      setCoords({ lat: pos.lat, lng: pos.lng });
      reverseGeocode(pos.lat, pos.lng);
    });

    // Handle map click to reposition pin
    map.on('click', (e: L.LeafletMouseEvent) => {
      marker.setLatLng(e.latlng);
      setCoords({ lat: e.latlng.lat, lng: e.latlng.lng });
      reverseGeocode(e.latlng.lat, e.latlng.lng);
    });

    return () => {
      map.remove();
      mapInstanceRef.current = null;
      markerRef.current = null;
    };
  }, []);

  // Update marker position if coords state changes externally
  useEffect(() => {
    if (markerRef.current && mapInstanceRef.current) {
      markerRef.current.setLatLng([coords.lat, coords.lng]);
    }
  }, [coords]);

  // "Use My GPS Location" Handler
  const handleLocateMe = () => {
    if (!navigator.geolocation) {
      alert('Geolocation is not supported by your browser.');
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setIsLocating(false);
        const { latitude, longitude } = pos.coords;
        const newCoords = { lat: latitude, lng: longitude };
        setCoords(newCoords);

        if (mapInstanceRef.current && markerRef.current) {
          mapInstanceRef.current.flyTo([latitude, longitude], 16, { duration: 1.2 });
          markerRef.current.setLatLng([latitude, longitude]);
        }

        reverseGeocode(latitude, longitude);
      },
      (err) => {
        setIsLocating(false);
        console.warn('Geolocation error:', err);
        alert('Could not determine your location. Please pin manually on the map.');
      },
      { enableHighAccuracy: true, timeout: 10000 }
    );
  };

  // Search Address on Nominatim
  const handleSearchAddress = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!searchQuery.trim()) return;

    setSearching(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(
          searchQuery
        )}&limit=1`
      );
      if (res.ok) {
        const results = await res.json();
        if (results && results.length > 0) {
          const lat = parseFloat(results[0].lat);
          const lng = parseFloat(results[0].lon);
          const newCoords = { lat, lng };

          setCoords(newCoords);
          if (mapInstanceRef.current && markerRef.current) {
            mapInstanceRef.current.flyTo([lat, lng], 16, { duration: 1.2 });
            markerRef.current.setLatLng([lat, lng]);
          }

          reverseGeocode(lat, lng);
        } else {
          alert('Location not found. Try dragging the pin on the map instead.');
        }
      }
    } catch (err) {
      console.warn('Search geocoding error:', err);
    } finally {
      setSearching(false);
    }
  };

  // Strip [geo:...] from text for user typing
  const cleanAddressText = value.replace(/\s*\[geo:[-\d.]+,\s*[-\d.]+\]/, '');

  return (
    <div className="space-y-3">
      {/* Search & Locate Toolbar */}
      <div className="flex flex-col sm:flex-row gap-2">
        <form onSubmit={handleSearchAddress} className="relative flex-1">
          <input
            type="text"
            placeholder="Search neighborhood, street, or landmark..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full rounded-xl bg-zinc-900/90 dark:bg-black/40 backdrop-blur-md border border-white/10 px-3.5 py-2 pl-9 text-xs sm:text-sm text-white placeholder:text-gray-500 focus:border-orange-500 focus:outline-none transition-all"
          />
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400" />
          <button
            type="submit"
            disabled={searching}
            className="absolute right-1.5 top-1/2 -translate-y-1/2 px-2.5 py-1 rounded-lg bg-orange-500 hover:bg-orange-600 text-[11px] font-bold text-white transition disabled:opacity-50"
          >
            {searching ? 'Finding...' : 'Find'}
          </button>
        </form>

        <button
          type="button"
          onClick={handleLocateMe}
          disabled={isLocating}
          className="inline-flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl bg-gradient-to-r from-orange-500/20 to-amber-500/20 border border-orange-500/40 text-orange-400 hover:bg-orange-500/30 text-xs font-semibold backdrop-blur-md transition disabled:opacity-50 shrink-0"
        >
          <Navigation size={13} className={isLocating ? 'animate-spin' : ''} />
          <span>{isLocating ? 'Locating...' : 'Use My GPS'}</span>
        </button>
      </div>

      {/* Map Container with Liquid Glass Frame */}
      <div className="relative rounded-2xl overflow-hidden border border-white/15 dark:border-white/10 shadow-2xl bg-zinc-950/80 backdrop-blur-xl">
        <div
          ref={mapContainerRef}
          className="w-full h-52 sm:h-64 z-0"
          style={{ minHeight: '210px' }}
        />

        {/* Live Pin Instruction Badge */}
        <div className="absolute top-2.5 left-2.5 z-[400] pointer-events-none">
          <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/75 backdrop-blur-md border border-white/15 text-[11px] font-medium text-white shadow-lg">
            <span className="h-1.5 w-1.5 rounded-full bg-orange-500 animate-ping" />
            <span>Tap map or drag pin to position</span>
          </div>
        </div>

        {/* Geocoding indicator */}
        {isGeocoding && (
          <div className="absolute bottom-2.5 left-2.5 z-[400]">
            <div className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-orange-500/90 backdrop-blur-md text-[11px] font-semibold text-white shadow-lg">
              <RefreshCw size={11} className="animate-spin" />
              <span>Updating address...</span>
            </div>
          </div>
        )}
      </div>

      {/* Detailed Address Text Input */}
      <div>
        <div className="flex items-center justify-between mb-1">
          <label className="text-xs font-semibold text-gray-300 flex items-center gap-1.5">
            <MapPin size={13} className="text-orange-400" />
            Delivery Address & Specific Directions
          </label>
          {coords && (
            <span className="text-[10px] text-gray-400 font-mono">
              GPS: {coords.lat.toFixed(4)}, {coords.lng.toFixed(4)}
            </span>
          )}
        </div>
        <textarea
          rows={2}
          required
          placeholder="e.g. Apartment 4B, 3rd Floor, Valley View Estate, Westlands Road"
          value={cleanAddressText}
          onChange={(e) => {
            const raw = e.target.value;
            const updated = coords
              ? `${raw} [geo:${coords.lat.toFixed(6)},${coords.lng.toFixed(6)}]`
              : raw;
            onChange(updated, coords);
          }}
          className="w-full rounded-xl bg-zinc-900/90 dark:bg-black/40 backdrop-blur-md border border-white/10 px-3.5 py-2 text-base sm:text-sm text-white placeholder:text-gray-500 focus:border-orange-500 focus:outline-none transition-all"
        />
        <p className="text-[11px] text-gray-400 mt-1 flex items-center gap-1">
          <Check size={12} className="text-emerald-400 shrink-0" />
          <span>Pinned location will be sent directly to your delivery driver's map.</span>
        </p>
      </div>
    </div>
  );
}
