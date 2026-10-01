import React, { useState, useEffect } from 'react';
import { X, Calendar, Clock, Users, CheckCircle, Sparkles, AlertCircle, BookmarkCheck, Printer, CalendarPlus, Copy, Check } from 'lucide-react';
import { publicOrderingApi } from '../../../services/api';
import { printReservationReceipt, downloadReservationIcs } from '../../../utils/reservationReceipt';

type Branch = { id: string; name: string; city?: string; address?: string; phone?: string };

interface ReservationModalProps {
  isOpen: boolean;
  onClose: () => void;
  branches: Branch[];
  selectedBranchId: string;
  restaurantId?: string;
}

export default function ReservationModal({
  isOpen,
  onClose,
  branches,
  selectedBranchId,
  restaurantId,
}: ReservationModalProps) {
  const [branchId, setBranchId] = useState(selectedBranchId || branches[0]?.id || '');
  const [guestCount, setGuestCount] = useState(2);
  const [date, setDate] = useState(() => {
    const today = new Date();
    today.setDate(today.getDate() + 1);
    return today.toISOString().split('T')[0];
  });
  const [time, setTime] = useState('19:00');
  const [seating, setSeating] = useState('MAIN_DINING');
  const [customerName, setCustomerName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [specialRequests, setSpecialRequests] = useState('');
  const [submittedData, setSubmittedData] = useState<any>(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (selectedBranchId) setBranchId(selectedBranchId);
    else if (branches[0]) setBranchId(branches[0].id);
  }, [selectedBranchId, branches]);

  if (!isOpen) return null;

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      const payload = {
        restaurantId: restaurantId || '',
        branchId: branchId || branches[0]?.id || '',
        customerName,
        phone,
        email,
        partySize: guestCount,
        date,
        time,
        seatingArea: seating,
        specialRequests,
      };

      const res = await publicOrderingApi.createReservation(payload);
      setSubmittedData(res.data.data);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Unable to complete your table reservation. Please try another time.');
    } finally {
      setLoading(false);
    }
  };

  const handleReset = () => {
    setSubmittedData(null);
    setError('');
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/85 backdrop-blur-md p-4 overflow-y-auto animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg rounded-3xl bg-zinc-950 border border-orange-500/20 text-white shadow-2xl p-6 sm:p-8">
        <button
          onClick={handleReset}
          className="absolute top-5 right-5 text-gray-400 hover:text-white transition"
          aria-label="Close modal"
        >
          <X size={20} />
        </button>

        {submittedData ? (
          <div className="py-2 space-y-4">
            <div className="text-center space-y-2">
              <div className="mx-auto flex h-14 w-14 items-center justify-center rounded-full bg-emerald-500/20 text-emerald-400">
                <CheckCircle size={32} />
              </div>
              <h3 className="font-serif text-2xl font-bold text-white">Table Booking Confirmed!</h3>
              <p className="text-xs text-gray-300 max-w-sm mx-auto">
                Thank you, <span className="text-orange-400 font-semibold">{submittedData.customerName}</span>. Your reservation has been recorded in our system.
              </p>
            </div>

            {/* Receipt Card Style Container */}
            <div className="rounded-2xl bg-zinc-900/90 border border-orange-500/20 p-4 text-xs space-y-3 relative overflow-hidden shadow-inner">
              <div className="absolute top-0 right-0 w-32 h-32 bg-orange-500/5 rounded-full blur-2xl pointer-events-none" />

              {/* Reference Header */}
              <div className="flex items-center justify-between border-b border-white/10 pb-3">
                <div>
                  <span className="text-[10px] uppercase font-bold text-gray-400 tracking-wider">Booking Reference</span>
                  <div className="font-mono text-base font-extrabold text-orange-400 tracking-wider">
                    {submittedData.reservationCode}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    navigator.clipboard.writeText(submittedData.reservationCode);
                    setCopied(true);
                    setTimeout(() => setCopied(false), 2500);
                  }}
                  className="inline-flex items-center gap-1 rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] font-semibold text-gray-300 hover:text-white hover:bg-white/10 transition"
                  title="Copy reference code"
                >
                  {copied ? <Check size={12} className="text-emerald-400" /> : <Copy size={12} />}
                  <span>{copied ? 'Copied!' : 'Copy Ref'}</span>
                </button>
              </div>

              {/* Key Details Grid */}
              <div className="grid grid-cols-2 gap-2.5 py-1">
                <div className="p-2.5 rounded-xl bg-black/40 border border-white/5">
                  <span className="text-[10px] text-gray-400 uppercase font-semibold">Date & Time</span>
                  <p className="font-bold text-white text-xs mt-0.5">
                    {submittedData.date} at {submittedData.time}
                  </p>
                </div>
                <div className="p-2.5 rounded-xl bg-black/40 border border-white/5">
                  <span className="text-[10px] text-gray-400 uppercase font-semibold">Party Size</span>
                  <p className="font-bold text-white text-xs mt-0.5">
                    {submittedData.partySize} {submittedData.partySize === 1 ? 'Guest' : 'Guests'}
                  </p>
                </div>
                <div className="p-2.5 rounded-xl bg-black/40 border border-white/5">
                  <span className="text-[10px] text-gray-400 uppercase font-semibold">Venue / Branch</span>
                  <p className="font-bold text-white text-xs mt-0.5 truncate">
                    {submittedData.branch?.name || 'Melio Fine Dining'}
                  </p>
                </div>
                <div className="p-2.5 rounded-xl bg-black/40 border border-white/5">
                  <span className="text-[10px] text-gray-400 uppercase font-semibold">Table Allocation</span>
                  <p className="font-bold text-orange-400 text-xs mt-0.5">
                    {submittedData.tableNumber ? `Table #${submittedData.tableNumber}` : 'Host stand assignment'}
                  </p>
                </div>
              </div>

              {/* Contact and Status */}
              <div className="space-y-1.5 pt-1 text-[11px] border-t border-white/5">
                <div className="flex justify-between text-gray-300">
                  <span className="text-gray-400">Confirmation Sent To:</span>
                  <span className="font-mono font-medium text-white">{phone || email || 'Provided Contact'}</span>
                </div>
                {submittedData.notes && (
                  <div className="flex justify-between text-gray-300">
                    <span className="text-gray-400">Special Notes:</span>
                    <span className="text-amber-400/90 text-right truncate max-w-[200px]">{submittedData.notes}</span>
                  </div>
                )}
                <div className="flex justify-between">
                  <span className="text-gray-400">Arrival Notice:</span>
                  <span className="text-emerald-400 font-semibold">Tables held for 15 mins past time</span>
                </div>
              </div>
            </div>

            {/* Receipt Actions */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-1">
              <button
                type="button"
                onClick={() =>
                  printReservationReceipt({
                    reservationCode: submittedData.reservationCode,
                    customerName: submittedData.customerName,
                    partySize: submittedData.partySize,
                    date: submittedData.date,
                    time: submittedData.time,
                    startAt: submittedData.startAt,
                    status: submittedData.status,
                    branch: submittedData.branch,
                    tableNumber: submittedData.tableNumber,
                    notes: submittedData.notes,
                    phone,
                    email,
                  })
                }
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 px-4 py-2.5 text-xs font-bold text-white hover:from-orange-600 hover:to-amber-600 transition shadow-lg shadow-orange-500/25"
              >
                <Printer size={14} />
                <span>Print Receipt / PDF</span>
              </button>

              <button
                type="button"
                onClick={() =>
                  downloadReservationIcs({
                    reservationCode: submittedData.reservationCode,
                    customerName: submittedData.customerName,
                    partySize: submittedData.partySize,
                    date: submittedData.date,
                    time: submittedData.time,
                    startAt: submittedData.startAt,
                    status: submittedData.status,
                    branch: submittedData.branch,
                    tableNumber: submittedData.tableNumber,
                    notes: submittedData.notes,
                  })
                }
                className="inline-flex items-center justify-center gap-2 rounded-xl border border-white/15 bg-white/5 px-4 py-2.5 text-xs font-semibold text-gray-200 hover:bg-white/10 hover:text-white transition"
              >
                <CalendarPlus size={14} />
                <span>Add to Calendar</span>
              </button>
            </div>

            <button
              type="button"
              onClick={handleReset}
              className="w-full rounded-xl border border-white/10 py-2.5 text-xs font-semibold text-gray-400 hover:text-white hover:bg-white/5 transition"
            >
              Done & Return to Site
            </button>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="flex items-center gap-2 text-orange-400 text-xs font-bold uppercase tracking-widest">
              <Sparkles size={14} /> Fine Dining Table Booking
            </div>
            <h2 className="font-serif text-2xl font-bold text-white">Reserve Your Table</h2>
            <p className="text-xs text-gray-400">
              Experience exceptional culinary craft. Secure your table in advance with instant slot confirmation.
            </p>

            {error && (
              <div className="flex items-center gap-2 rounded-xl border border-red-500/40 bg-red-950/50 p-3 text-xs text-red-300">
                <AlertCircle size={16} className="shrink-0 text-red-400" />
                <span>{error}</span>
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Branch</label>
                <select
                  value={branchId}
                  onChange={(e) => setBranchId(e.target.value)}
                  className="w-full rounded-xl bg-zinc-900 border border-white/10 px-3 py-2.5 text-sm text-white focus:border-orange-500 focus:outline-none"
                >
                  {branches.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name} {b.city ? `(${b.city})` : ''}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Guests</label>
                <div className="relative flex items-center">
                  <Users size={16} className="absolute left-3.5 text-gray-400 pointer-events-none" />
                  <select
                    value={guestCount}
                    onChange={(e) => setGuestCount(Number(e.target.value))}
                    className="w-full rounded-xl bg-zinc-900 border border-white/10 pl-10 pr-4 py-2.5 text-sm text-white focus:border-orange-500 focus:outline-none"
                  >
                    {[1, 2, 3, 4, 5, 6, 7, 8, 10, 12, 16, 20].map((num) => (
                      <option key={num} value={num}>
                        {num} {num === 1 ? 'Guest' : 'Guests'}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Date</label>
                <div className="relative flex items-center">
                  <Calendar size={16} className="absolute left-3.5 text-gray-400 pointer-events-none" />
                  <input
                    type="date"
                    required
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="w-full rounded-xl bg-zinc-900 border border-white/10 pl-10 pr-4 py-2 text-sm text-white focus:border-orange-500 focus:outline-none"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Time</label>
                <div className="relative flex items-center">
                  <Clock size={16} className="absolute left-3.5 text-gray-400 pointer-events-none" />
                  <select
                    value={time}
                    onChange={(e) => setTime(e.target.value)}
                    className="w-full rounded-xl bg-zinc-900 border border-white/10 pl-10 pr-4 py-2 text-sm text-white focus:border-orange-500 focus:outline-none"
                  >
                    {['12:00', '12:30', '13:00', '13:30', '14:00', '18:00', '18:30', '19:00', '19:30', '20:00', '20:30', '21:00', '21:30'].map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </select>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Guest Full Name</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. John Doe"
                  value={customerName}
                  onChange={(e) => setCustomerName(e.target.value)}
                  className="w-full rounded-xl bg-zinc-900 border border-white/10 px-3 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-orange-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-300 mb-1">Phone Number</label>
                <input
                  type="tel"
                  required
                  placeholder="+254 700 000000"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  className="w-full rounded-xl bg-zinc-900 border border-white/10 px-3 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-orange-500 focus:outline-none"
                />
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Email Address</label>
              <input
                type="email"
                placeholder="john@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full rounded-xl bg-zinc-900 border border-white/10 px-3 py-2.5 text-sm text-white placeholder:text-gray-500 focus:border-orange-500 focus:outline-none"
              />
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Seating Preference</label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'MAIN_DINING', label: 'Main Hall' },
                  { id: 'TERRACE', label: 'Terrace' },
                  { id: 'VIP_BOOTH', label: 'VIP Booth' },
                ].map((area) => (
                  <button
                    type="button"
                    key={area.id}
                    onClick={() => setSeating(area.id)}
                    className={`rounded-xl py-2 text-xs font-semibold transition border ${
                      seating === area.id
                        ? 'bg-orange-500 text-white border-orange-500 shadow-md shadow-orange-500/20'
                        : 'bg-zinc-900 text-gray-400 border-white/10 hover:border-orange-500/40'
                    }`}
                  >
                    {area.label}
                  </button>
                ))}
              </div>
            </div>

            <div>
              <label className="block text-xs font-semibold text-gray-300 mb-1">Special Occasion or Dietary Notes</label>
              <textarea
                rows={2}
                placeholder="Birthday celebration, high chair needed, window table request..."
                value={specialRequests}
                onChange={(e) => setSpecialRequests(e.target.value)}
                className="w-full rounded-xl bg-zinc-900 border border-white/10 px-3 py-2 text-sm text-white placeholder:text-gray-500 focus:border-orange-500 focus:outline-none"
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="mt-4 w-full rounded-xl bg-orange-500 py-3.5 text-sm font-bold text-white hover:bg-orange-400 transition shadow-xl shadow-orange-500/25 disabled:opacity-50"
            >
              {loading ? 'Checking Availability & Booking...' : 'Confirm Table Booking'}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
