import { useEffect, useState } from 'react';
import { publicPaymentsApi } from '../services/api';

export interface PaymentOptions {
  mpesa: boolean;
  /** Card payments need a hosted card processor; today they exist only in simulation (test) mode. */
  card: boolean;
  simulation: boolean;
}

const DEFAULT_OPTIONS: PaymentOptions = { mpesa: true, card: false, simulation: false };
let cached: Promise<PaymentOptions> | null = null;

function loadPaymentOptions(): Promise<PaymentOptions> {
  if (!cached) {
    cached = publicPaymentsApi
      .getConfig()
      .then((res) => ({ ...DEFAULT_OPTIONS, ...(res.data?.data || {}) }))
      .catch(() => {
        cached = null; // retry on next mount
        return DEFAULT_OPTIONS;
      });
  }
  return cached;
}

/** Which online payment methods the server currently accepts. Card is off until confirmed. */
export function usePaymentOptions(): PaymentOptions {
  const [options, setOptions] = useState<PaymentOptions>(DEFAULT_OPTIONS);
  useEffect(() => {
    let active = true;
    loadPaymentOptions().then((o) => { if (active) setOptions(o); });
    return () => { active = false; };
  }, []);
  return options;
}
