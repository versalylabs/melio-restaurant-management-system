import { RefreshCw } from 'lucide-react';
import { usePwa } from '../../lib/pwa';

/** A new version of the app has downloaded: offer to switch when it suits staff. */
export default function AppUpdateBanner() {
  const { updateReady, update } = usePwa();
  if (!updateReady) return null;
  return (
    <div role="status" className="fixed bottom-4 left-1/2 z-[60] flex -translate-x-1/2 items-center gap-3 rounded-xl border border-orange-500/30 bg-zinc-900 px-4 py-2.5 text-sm text-white shadow-2xl">
      <span>A new version of Melio is ready.</span>
      <button type="button" onClick={update} className="inline-flex items-center gap-1.5 rounded-lg bg-orange-500 px-3 py-1.5 text-xs font-bold hover:bg-orange-600">
        <RefreshCw className="h-3.5 w-3.5" aria-hidden="true" /> Update
      </button>
    </div>
  );
}
