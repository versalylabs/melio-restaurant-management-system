import React, { useEffect, useState, useCallback } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  Clock,
  MapPin,
  Phone,
  CheckCircle2,
  AlertCircle,
  ShoppingBag,
  Sparkles,
  ArrowRight,
  CreditCard,
  Smartphone,
  ShieldCheck,
  ChevronRight,
  UtensilsCrossed,
  X,
  RefreshCw,
  Truck,
} from 'lucide-react';
import { publicOrderingApi, publicPaymentsApi } from '../../services/api';
import { useRealtimeEvents } from '../../hooks/useRealtimeEvents';

const STATUS_ORDER = ['SUBMITTED', 'PREPARING', 'READY', 'OUT_FOR_DELIVERY', 'COMPLETED'];

const normalizeTrackingStatus = (status: string) => status === 'SERVED' ? 'COMPLETED' : status;

const STATUS_DETAILS: Record<
  string,
  { label: string; desc: string; icon: any; color: string }
> = {
  SUBMITTED: {
    label: 'Order Confirmed',
    desc: 'The restaurant has received your order and transmitted it to the kitchen.',
    icon: Sparkles,
    color: 'text-amber-400',
  },
  PREPARING: {
    label: 'Culinary Preparation',
    desc: 'Executive chefs are freshly preparing and plating your gourmet selections.',
    icon: UtensilsCrossed,
    color: 'text-orange-400',
  },
  READY: {
    label: 'Order Ready',
    desc: 'Your order is hot, packaged with care, and ready at the service station.',
    icon: CheckCircle2,
    color: 'text-emerald-400',
  },
  OUT_FOR_DELIVERY: {
    label: 'Out for Delivery',
    desc: 'Our dedicated courier is en route to your provided street address.',
    icon: Truck,
    color: 'text-sky-400',
  },
  COMPLETED: {
    label: 'Order Fulfilled',
    desc: 'Your culinary experience has been delivered. Bon appétit!',
    icon: CheckCircle2,
    color: 'text-emerald-400',
  },
  CANCELLED: {
    label: 'Order Cancelled',
    desc: 'This order was cancelled. Please contact the branch for assistance.',
    icon: AlertCircle,
    color: 'text-red-400',
  },
};

const money = (val: number, currency = 'KES') =>
  new Intl.NumberFormat('en-KE', { style: 'currency', currency, maximumFractionDigits: 0 }).format(val);

export default function OnlineOrderTracking() {
  const { trackingToken = '' } = useParams<{ trackingToken: string }>();
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Payment Modal States
  const [paymentModalType, setPaymentModalType] = useState<'MPESA' | 'CARD' | null>(null);
  const [mpesaPhone, setMpesaPhone] = useState('');
  const [mpesaLoading, setMpesaLoading] = useState(false);
  const [mpesaSuccess, setMpesaSuccess] = useState(false);
  const [mpesaError, setMpesaError] = useState('');
  const [checkoutRequestId, setCheckoutRequestId] = useState('');

  // Card Form State
  const [cardForm, setCardForm] = useState({
    cardNumber: '',
    cardExp: '',
    cardCvc: '',
    cardName: '',
  });
  const [cardLoading, setCardLoading] = useState(false);
  const [cardError, setCardError] = useState('');

  const fetchOrder = useCallback(async () => {
    if (!trackingToken) return;
    try {
      const res = await publicOrderingApi.getOrder(trackingToken);
      if (res.data.success) {
        setData(res.data.data);
        if (res.data.data?.contactPhone && !mpesaPhone) {
          setMpesaPhone(res.data.data.contactPhone);
        }
      }
      setError('');
    } catch (err: any) {
      setError(err.response?.data?.message || 'Unable to locate order.');
    } finally {
      setLoading(false);
    }
  }, [trackingToken, mpesaPhone]);

  // Real-time Event Subscription for this specific order
  const { isConnected, subscribe } = useRealtimeEvents({
    url: `/api/realtime/public/track/${trackingToken}`,
    enabled: !!trackingToken,
  });

  useEffect(() => {
    fetchOrder();
  }, [fetchOrder]);

  useEffect(() => {
    const unsubStatus = subscribe('order_status_updated', (payload: any) => {
      if (payload.status) {
        setData((prev: any) => (prev ? { ...prev, status: normalizeTrackingStatus(payload.status) } : prev));
      }
    });

    const unsubPayment = subscribe('payment_confirmed', (_payload: any) => {
      setData((prev: any) =>
        prev
          ? {
              ...prev,
              paymentState: 'PAID',
              paymentStatus: 'PAID',
            }
          : prev
      );
      setPaymentModalType(null);
    });

    return () => {
      unsubStatus();
      unsubPayment();
    };
  }, [subscribe]);

  // SSE is the primary live channel. Polling is a lightweight fallback so a
  // customer's stage still refreshes when a corporate/mobile network blocks
  // long-lived EventSource connections.
  useEffect(() => {
    if (!trackingToken) return;
    const timer = window.setInterval(() => {
      if (!data || ['COMPLETED', 'CANCELLED'].includes(normalizeTrackingStatus(data.status || 'SUBMITTED'))) return;
      fetchOrder();
    }, 8000);
    return () => window.clearInterval(timer);
  }, [trackingToken, data?.status, fetchOrder]);

  const handleMpesaSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setMpesaError('');
    setMpesaLoading(true);

    try {
      const res = await publicPaymentsApi.initiateMpesaStkPush({
        trackingToken,
        phoneNumber: mpesaPhone,
      });

      if (res.data.success) {
        setCheckoutRequestId(res.data.data.checkoutRequestId);
        setMpesaSuccess(true);
      }
    } catch (err: any) {
      setMpesaError(err.response?.data?.message || 'Failed to initiate M-Pesa payment');
    } finally {
      setMpesaLoading(false);
    }
  };

  const handleMpesaSimulateConfirm = async () => {
    if (!checkoutRequestId) return;
    setMpesaLoading(true);
    try {
      const res = await publicPaymentsApi.confirmMpesaPayment({
        checkoutRequestId,
      });
      if (res.data.success) {
        setData((prev: any) => ({ ...prev, paymentState: 'PAID', paymentStatus: 'PAID' }));
        setPaymentModalType(null);
      }
    } catch (err: any) {
      setMpesaError(err.response?.data?.message || 'Failed to verify M-Pesa payment');
    } finally {
      setMpesaLoading(false);
    }
  };

  const handleCardSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setCardError('');
    setCardLoading(true);

    try {
      const res = await publicPaymentsApi.processCardPayment({
        trackingToken,
        cardNumber: cardForm.cardNumber,
        cardExp: cardForm.cardExp,
        cardCvc: cardForm.cardCvc,
        cardName: cardForm.cardName,
      });

      if (res.data.success) {
        setData((prev: any) => ({ ...prev, paymentState: 'PAID', paymentStatus: 'PAID' }));
        setPaymentModalType(null);
      }
    } catch (err: any) {
      setCardError(err.response?.data?.message || 'Failed to process card payment');
    } finally {
      setCardLoading(false);
    }
  };

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-[#0d0d11] text-orange-400">
        <div className="flex flex-col items-center gap-3">
          <div className="h-10 w-10 animate-spin rounded-full border-4 border-orange-500 border-t-transparent" />
          <span className="text-xs font-serif tracking-widest uppercase text-gray-300">
            Locating Your Order...
          </span>
        </div>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="min-h-screen bg-[#0d0d11] flex items-center justify-center p-6 text-white">
        <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl p-8 max-w-md text-center shadow-2xl">
          <div className="h-14 w-14 rounded-2xl bg-red-500/10 border border-red-500/30 text-red-400 flex items-center justify-center mx-auto mb-4">
            <AlertCircle size={28} />
          </div>
          <h1 className="text-2xl font-serif font-bold">Order Not Found</h1>
          <p className="mt-2 text-sm text-gray-400">{error || 'This order reference could not be verified.'}</p>
          <Link
            to="/order-online"
            className="mt-6 inline-flex items-center gap-2 rounded-xl bg-orange-500 px-6 py-3 text-xs font-bold uppercase tracking-wider text-white hover:bg-orange-600 transition"
          >
            Explore Menu & Order <ArrowRight size={14} />
          </Link>
        </div>
      </div>
    );
  }

  const currentStatus = normalizeTrackingStatus(data.status || 'SUBMITTED');
  const isCancelled = currentStatus === 'CANCELLED';
  const currentStepIndex = STATUS_ORDER.indexOf(currentStatus);
  const statusMeta = STATUS_DETAILS[currentStatus] || STATUS_DETAILS.SUBMITTED;
  const StatusIcon = statusMeta.icon;
  const isPaid = data.paymentState === 'PAID' || data.paymentStatus === 'PAID';

  return (
    <div className="min-h-screen bg-[#0d0d11] text-gray-100 antialiased selection:bg-orange-500 selection:text-white pb-16">
      {/* Top Navigation */}
      <header className="border-b border-white/10 bg-black/40 backdrop-blur-xl sticky top-0 z-30">
        <div className="mx-auto flex max-w-4xl items-center justify-between px-6 py-4">
          <Link to="/" className="flex items-center gap-2 text-white hover:text-orange-400 transition">
            <div className="grid h-8 w-8 place-items-center rounded-lg bg-orange-500 text-white shadow-lg shadow-orange-500/20">
              <UtensilsCrossed size={16} />
            </div>
            <span className="font-serif font-bold tracking-wide">{data.restaurant?.name || 'Melio'}</span>
          </Link>

          <div className="flex items-center gap-3">
            {isConnected ? (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-500/10 border border-emerald-500/30 px-3 py-1 text-xs font-semibold text-emerald-400">
                <span className="h-2 w-2 rounded-full bg-emerald-500 animate-pulse" />
                Live Tracking
              </span>
            ) : (
              <span className="inline-flex items-center gap-1.5 rounded-full bg-amber-500/10 border border-amber-500/30 px-3 py-1 text-xs font-semibold text-amber-400">
                Connecting...
              </span>
            )}
            <button
              onClick={fetchOrder}
              className="p-2 rounded-xl bg-white/5 border border-white/10 text-gray-300 hover:text-white hover:bg-white/10 transition"
              title="Refresh order"
            >
              <RefreshCw size={14} />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-4 pt-8">
        {/* Main Status Hero Card */}
        <div className="rounded-3xl border border-white/10 bg-gradient-to-b from-white/10 to-white/5 backdrop-blur-2xl p-6 sm:p-8 shadow-2xl relative overflow-hidden">
          <div className="absolute top-0 right-0 w-96 h-96 bg-orange-500/10 rounded-full blur-3xl pointer-events-none -mr-20 -mt-20" />

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-6 border-b border-white/10">
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-orange-400 font-bold mb-1">
                {data.fulfillmentType === 'DELIVERY' ? 'Doorstep Delivery' : 'Curbside / Branch Pickup'}
              </div>
              <h1 className="text-3xl font-serif font-bold text-white tracking-tight">
                Order {data.orderNumber}
              </h1>
              <p className="text-xs text-gray-400 mt-1">
                Placed at {new Date(data.placedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })} •{' '}
                {new Date(data.placedAt).toLocaleDateString()}
              </p>
            </div>

            {/* Payment Badge */}
            <div>
              {isPaid ? (
                <div className="inline-flex items-center gap-2 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 px-4 py-2 text-xs font-bold uppercase tracking-wider text-emerald-400">
                  <ShieldCheck size={16} /> Paid in Full
                </div>
              ) : (
                <div className="flex flex-col items-end gap-2">
                  <div className="inline-flex items-center gap-2 rounded-2xl bg-amber-500/10 border border-amber-500/30 px-4 py-2 text-xs font-bold uppercase tracking-wider text-amber-400">
                    <Clock size={16} /> Payment Pending
                  </div>
                  {data.paymentState !== 'PAY_AT_PICKUP' && (
                    <div className="flex gap-2">
                      <button
                        onClick={() => setPaymentModalType('MPESA')}
                        className="rounded-xl bg-emerald-600 hover:bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white shadow-lg shadow-emerald-600/20 transition flex items-center gap-1.5"
                      >
                        <Smartphone size={14} /> Pay M-Pesa
                      </button>
                      <button
                        onClick={() => setPaymentModalType('CARD')}
                        className="rounded-xl bg-white/10 hover:bg-white/20 px-3 py-1.5 text-xs font-bold text-white border border-white/10 transition flex items-center gap-1.5"
                      >
                        <CreditCard size={14} /> Card
                      </button>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Current Status Banner */}
          <div className="my-8 flex items-start gap-4 p-5 rounded-2xl bg-white/5 border border-white/10">
            <div className={`p-3 rounded-xl bg-orange-500/10 border border-orange-500/30 ${statusMeta.color}`}>
              <StatusIcon size={28} />
            </div>
            <div>
              <h2 className="text-xl font-bold text-white">{statusMeta.label}</h2>
              <p className="text-sm text-gray-300 mt-0.5">{statusMeta.desc}</p>
            </div>
          </div>

          {/* Progress Timeline Stepper */}
          {!isCancelled && (
            <div className="mt-8 pt-4">
              <div className="grid grid-cols-5 gap-2 relative">
                {STATUS_ORDER.map((step, idx) => {
                  const isDone = idx <= currentStepIndex;
                  const isCurrent = idx === currentStepIndex;
                  const stepMeta = STATUS_DETAILS[step];

                  return (
                    <div key={step} className="flex flex-col items-center text-center relative group">
                      <div
                        className={`h-9 w-9 rounded-full flex items-center justify-center text-xs font-bold transition-all duration-300 ${
                          isCurrent
                            ? 'bg-orange-500 text-white ring-4 ring-orange-500/30 scale-110 shadow-lg shadow-orange-500/40'
                            : isDone
                            ? 'bg-emerald-500 text-white'
                            : 'bg-white/10 text-gray-400 border border-white/10'
                        }`}
                      >
                        {isDone ? <CheckCircle2 size={16} /> : idx + 1}
                      </div>
                      <span
                        className={`mt-2.5 text-[11px] font-semibold leading-tight ${
                          isCurrent ? 'text-orange-400 font-bold' : isDone ? 'text-gray-200' : 'text-gray-400'
                        }`}
                      >
                        {stepMeta.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>

        {/* Order Details Grid */}
        <div className="mt-8 grid grid-cols-1 md:grid-cols-3 gap-6">
          {/* Order Items Col (2 Cols) */}
          <div className="md:col-span-2 rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 sm:p-8">
            <h3 className="text-lg font-serif font-bold text-white mb-4 flex items-center gap-2">
              <ShoppingBag size={18} className="text-orange-400" />
              Your Gourmet Selection
            </h3>

            <div className="divide-y divide-white/5">
              {data.items?.map((item: any, idx: number) => (
                <div key={idx} className="py-3.5 flex items-center justify-between text-sm">
                  <div className="flex items-center gap-3">
                    <span className="h-6 w-6 rounded-lg bg-white/10 text-orange-400 font-bold text-xs flex items-center justify-center">
                      {item.quantity}×
                    </span>
                    <span className="text-gray-200 font-medium">{item.name}</span>
                  </div>
                  <span className="font-semibold text-white">{money(item.subtotal)}</span>
                </div>
              ))}
            </div>

            <div className="mt-6 pt-4 border-t border-white/10 space-y-2 text-xs">
              <div className="flex justify-between text-gray-400">
                <span>Items Subtotal</span>
                <span>{money(data.totalAmount)}</span>
              </div>
              <div className="flex justify-between text-gray-400">
                <span>Taxes & Service</span>
                <span>Included</span>
              </div>
              <div className="flex justify-between text-base font-bold text-white pt-2 border-t border-white/10">
                <span>Grand Total</span>
                <span className="text-orange-400">{money(data.totalAmount)}</span>
              </div>
            </div>
          </div>

          {/* Location / Support Info (1 Col) */}
          <div className="space-y-6">
            <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl p-6">
              <h3 className="text-sm font-bold uppercase tracking-wider text-orange-400 mb-3 flex items-center gap-2">
                <MapPin size={16} /> Preparing Branch
              </h3>
              <div className="text-sm font-bold text-white">{data.branch?.name}</div>
              <div className="text-xs text-gray-400 mt-1">{data.branch?.address || 'City Centre'}</div>

              {data.branch?.phone && (
                <a
                  href={`tel:${data.branch.phone}`}
                  className="mt-4 inline-flex items-center justify-center gap-2 w-full rounded-xl bg-white/10 border border-white/10 py-2.5 text-xs font-bold text-white hover:bg-orange-500 transition"
                >
                  <Phone size={14} /> Call Branch
                </a>
              )}
            </div>

            <div className="rounded-3xl border border-white/10 bg-white/5 backdrop-blur-xl p-6 text-center">
              <h4 className="text-sm font-bold text-white">Need to place another order?</h4>
              <p className="text-xs text-gray-400 mt-1 mb-4">
                Explore our full culinary menu with seasonal specials.
              </p>
              <Link
                to="/order-online"
                className="inline-flex items-center justify-center gap-2 w-full rounded-xl bg-orange-500 py-2.5 text-xs font-bold text-white shadow-lg shadow-orange-500/25 hover:bg-orange-600 transition"
              >
                Start New Order <ArrowRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      </main>

      {/* ======================= M-PESA PAYMENT MODAL ======================= */}
      {paymentModalType === 'MPESA' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="w-full max-w-md rounded-3xl border border-emerald-500/30 bg-zinc-950 p-6 sm:p-8 text-white shadow-2xl relative animate-in fade-in zoom-in-95">
            <button
              onClick={() => {
                setPaymentModalType(null);
                setMpesaSuccess(false);
              }}
              className="absolute top-6 right-6 text-gray-400 hover:text-white"
            >
              <X size={20} />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="h-10 w-10 rounded-xl bg-emerald-500/20 border border-emerald-500/40 text-emerald-400 flex items-center justify-center">
                <Smartphone size={22} />
              </div>
              <div>
                <h3 className="text-lg font-bold">Lipa Na M-Pesa STK Push</h3>
                <p className="text-xs text-emerald-400 font-semibold">Instant Mobile Money Checkout</p>
              </div>
            </div>

            <div className="rounded-2xl bg-white/5 border border-white/10 p-4 mb-5 flex justify-between items-center">
              <span className="text-xs text-gray-400">Total Payable:</span>
              <span className="text-lg font-bold text-white">{money(data.totalAmount)}</span>
            </div>

            {mpesaError && (
              <div className="mb-4 rounded-xl border border-red-500/30 bg-red-950/80 p-3 text-xs text-red-200">
                {mpesaError}
              </div>
            )}

            {!mpesaSuccess ? (
              <form onSubmit={handleMpesaSubmit} className="space-y-4">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-300 mb-1.5">
                    Safaricom Phone Number
                  </label>
                  <input
                    type="tel"
                    required
                    placeholder="e.g. 0712345678 or 254712345678"
                    value={mpesaPhone}
                    onChange={(e) => setMpesaPhone(e.target.value)}
                    className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white placeholder-gray-500 focus:border-emerald-500 focus:outline-none"
                  />
                  <p className="text-[11px] text-gray-400 mt-1">
                    An instant prompt will be sent directly to this handset.
                  </p>
                </div>

                <button
                  type="submit"
                  disabled={mpesaLoading}
                  className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 py-3.5 text-xs font-bold uppercase tracking-wider text-white shadow-lg shadow-emerald-600/30 transition disabled:opacity-50 flex items-center justify-center gap-2"
                >
                  {mpesaLoading ? (
                    <>
                      <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent" />
                      Sending STK Prompt...
                    </>
                  ) : (
                    <>
                      Send STK Push Prompt <ChevronRight size={16} />
                    </>
                  )}
                </button>
              </form>
            ) : (
              <div className="space-y-5 text-center">
                <div className="h-16 w-16 rounded-full bg-emerald-500/10 border-2 border-emerald-500 flex items-center justify-center mx-auto text-emerald-400 animate-pulse">
                  <Smartphone size={32} />
                </div>
                <div>
                  <h4 className="text-base font-bold text-white">Prompt Sent to Handset</h4>
                  <p className="text-xs text-gray-300 mt-1 max-w-xs mx-auto">
                    Please check your phone, enter your M-Pesa PIN, and confirm the transaction of{' '}
                    <strong>{money(data.totalAmount)}</strong>.
                  </p>
                </div>

                <div className="pt-2">
                  <button
                    onClick={handleMpesaSimulateConfirm}
                    disabled={mpesaLoading}
                    className="w-full rounded-xl bg-emerald-600 hover:bg-emerald-500 py-3 text-xs font-bold text-white shadow-lg shadow-emerald-600/25 transition disabled:opacity-50"
                  >
                    {mpesaLoading ? 'Verifying Receipt...' : 'Simulate / Confirm M-Pesa Receipt'}
                  </button>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* ======================= CARD PAYMENT MODAL ======================= */}
      {paymentModalType === 'CARD' && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md p-4">
          <div className="w-full max-w-md rounded-3xl border border-white/15 bg-zinc-950 p-6 sm:p-8 text-white shadow-2xl relative animate-in fade-in zoom-in-95">
            <button
              onClick={() => setPaymentModalType(null)}
              className="absolute top-6 right-6 text-gray-400 hover:text-white"
            >
              <X size={20} />
            </button>

            <div className="flex items-center gap-3 mb-4">
              <div className="h-10 w-10 rounded-xl bg-orange-500/20 border border-orange-500/40 text-orange-400 flex items-center justify-center">
                <CreditCard size={22} />
              </div>
              <div>
                <h3 className="text-lg font-bold">Credit / Debit Card</h3>
                <p className="text-xs text-gray-400">Secure 256-bit Encrypted Checkout</p>
              </div>
            </div>

            <div className="rounded-2xl bg-white/5 border border-white/10 p-4 mb-5 flex justify-between items-center">
              <span className="text-xs text-gray-400">Total Payable:</span>
              <span className="text-lg font-bold text-white">{money(data.totalAmount)}</span>
            </div>

            {cardError && (
              <div className="mb-4 rounded-xl border border-red-500/30 bg-red-950/80 p-3 text-xs text-red-200">
                {cardError}
              </div>
            )}

            <form onSubmit={handleCardSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-300 mb-1.5">
                  Cardholder Name
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. John Doe"
                  value={cardForm.cardName}
                  onChange={(e) => setCardForm({ ...cardForm, cardName: e.target.value })}
                  className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white placeholder-gray-500 focus:border-orange-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-bold uppercase tracking-wider text-gray-300 mb-1.5">
                  Card Number
                </label>
                <input
                  type="text"
                  required
                  placeholder="•••• •••• •••• 4242"
                  value={cardForm.cardNumber}
                  onChange={(e) => setCardForm({ ...cardForm, cardNumber: e.target.value })}
                  className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white placeholder-gray-500 focus:border-orange-500 focus:outline-none"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-300 mb-1.5">
                    Expiry (MM/YY)
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="12/28"
                    value={cardForm.cardExp}
                    onChange={(e) => setCardForm({ ...cardForm, cardExp: e.target.value })}
                    className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white placeholder-gray-500 focus:border-orange-500 focus:outline-none"
                  />
                </div>
                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-300 mb-1.5">
                    CVC
                  </label>
                  <input
                    type="text"
                    required
                    placeholder="123"
                    value={cardForm.cardCvc}
                    onChange={(e) => setCardForm({ ...cardForm, cardCvc: e.target.value })}
                    className="w-full rounded-xl border border-white/15 bg-white/5 px-4 py-3 text-sm text-white placeholder-gray-500 focus:border-orange-500 focus:outline-none"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={cardLoading}
                className="w-full rounded-xl bg-orange-500 hover:bg-orange-600 py-3.5 text-xs font-bold uppercase tracking-wider text-white shadow-lg shadow-orange-500/30 transition disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {cardLoading ? 'Authorizing Payment...' : `Authorize ${money(data.totalAmount)}`}
              </button>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
