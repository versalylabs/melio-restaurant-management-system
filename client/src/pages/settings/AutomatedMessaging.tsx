import React, { useState, useEffect, useCallback } from 'react';
import {
  Mail,
  MessageSquare,
  Sparkles,
  Send,
  Eye,
  CheckCircle,
  AlertCircle,
  RefreshCw,
  Sliders,
  Bell,
  Smartphone,
  Check,
  X,
  ChevronDown,
  Info,
} from 'lucide-react';
import { automatedMessagingApi } from '../../services/api';
import { useAuth } from '../../contexts/AuthContext';

interface Template {
  action: string;
  name: string;
  description: string;
  channel: 'EMAIL' | 'SMS' | 'BOTH';
  enabled: boolean;
  subject: string;
  template: string;
  placeholders: string[];
}

export default function AutomatedMessaging() {
  const { user } = useAuth();
  const [templates, setTemplates] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingAction, setSavingAction] = useState<string | null>(null);
  const [testingAction, setTestingAction] = useState<string | null>(null);
  const [previewTemplate, setPreviewTemplate] = useState<Template | null>(null);
  const [testModalTemplate, setTestModalTemplate] = useState<Template | null>(null);
  const [testEmail, setTestEmail] = useState(user?.email || '');
  const [testPhone, setTestPhone] = useState('+254 700 000 000');
  const [statusMessage, setStatusMessage] = useState<{ type: 'success' | 'error'; text: string } | null>(null);

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await automatedMessagingApi.getTemplates();
      if (res.data?.success) {
        setTemplates(res.data.data?.templates || []);
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err.response?.data?.message || 'Failed to load message templates',
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchTemplates();
  }, [fetchTemplates]);

  const handleFieldChange = (action: string, field: keyof Template, value: any) => {
    setTemplates((prev) =>
      prev.map((t) => (t.action === action ? { ...t, [field]: value } : t))
    );
  };

  const handleInsertPlaceholder = (action: string, tag: string) => {
    const target = templates.find((t) => t.action === action);
    if (!target) return;
    const updated = target.template + ` ${tag}`;
    handleFieldChange(action, 'template', updated);
  };

  const handleSave = async (action: string) => {
    const target = templates.find((t) => t.action === action);
    if (!target) return;

    setSavingAction(action);
    setStatusMessage(null);
    try {
      await automatedMessagingApi.updateTemplate(action, {
        enabled: target.enabled,
        channel: target.channel,
        subject: target.subject,
        template: target.template,
      });
      setStatusMessage({
        type: 'success',
        text: `Automated message for "${target.name}" saved successfully!`,
      });
      setTimeout(() => setStatusMessage(null), 4000);
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err.response?.data?.message || 'Failed to save template',
      });
    } finally {
      setSavingAction(null);
    }
  };

  const handleSendTest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testModalTemplate) return;

    setTestingAction(testModalTemplate.action);
    setStatusMessage(null);
    try {
      const res = await automatedMessagingApi.sendTest({
        action: testModalTemplate.action,
        recipientEmail: testEmail,
        recipientPhone: testPhone,
      });
      if (res.data?.success) {
        setStatusMessage({
          type: 'success',
          text: `Test message dispatched to ${testEmail}! Check your inbox.`,
        });
        setTestModalTemplate(null);
        setTimeout(() => setStatusMessage(null), 5000);
      }
    } catch (err: any) {
      setStatusMessage({
        type: 'error',
        text: err.response?.data?.message || 'Failed to send test message',
      });
    } finally {
      setTestingAction(null);
    }
  };

  // Build sample preview text
  const renderPreviewContent = (tmpl: Template) => {
    const sampleContext: Record<string, string> = {
      restaurantName: 'Melio Restaurant',
      customerName: 'Alex Mercer',
      orderNumber: '#1042',
      status: tmpl.action.replace('ORDER_', ''),
      totalAmount: 'KES 3,450',
      trackingLink: 'https://melio.co/online-order/track-9941',
      deliveryAddress: 'Apartment 4B, 123 Westlands Road, Nairobi',
      reference: 'RES-8821',
      guestCount: '4',
      branchName: 'Kilimani Main',
      reservationDate: 'Tonight',
      reservationTime: '7:30 PM',
    };

    let subject = tmpl.subject;
    let body = tmpl.template;
    for (const [key, val] of Object.entries(sampleContext)) {
      subject = subject.split(`{${key}}`).join(val);
      body = body.split(`{${key}}`).join(val);
    }
    return { subject, body };
  };

  return (
    <div className="min-h-full space-y-6 p-4 sm:p-6 pb-24">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-2xl bg-gradient-to-tr from-orange-500 to-amber-500 text-white shadow-lg shadow-orange-500/25">
              <Sparkles size={24} />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-gray-100 flex items-center gap-2">
                Automated Messaging
                <span className="text-xs font-semibold px-2.5 py-0.5 rounded-full bg-orange-500/10 border border-orange-500/30 text-orange-500">
                  Customer Email & SMS
                </span>
              </h1>
              <p className="text-xs sm:text-sm text-gray-500 dark:text-gray-400">
                Customize automatic emails & SMS sent to customers after key events like placing an order.
              </p>
            </div>
          </div>
        </div>

        <button
          onClick={fetchTemplates}
          className="inline-flex items-center gap-2 rounded-xl bg-white/10 dark:bg-white/5 border border-white/20 dark:border-white/10 px-4 py-2 text-xs sm:text-sm font-semibold text-gray-700 dark:text-gray-200 hover:bg-white/20 dark:hover:bg-white/10 transition shadow-sm backdrop-blur-md"
        >
          <RefreshCw size={14} className="text-orange-500" />
          <span>Reload Templates</span>
        </button>
      </div>

      {/* Status banner */}
      {statusMessage && (
        <div
          className={`rounded-2xl border p-4 text-xs sm:text-sm flex items-center gap-2.5 backdrop-blur-md animate-fadeIn ${
            statusMessage.type === 'success'
              ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
              : 'border-red-500/30 bg-red-500/10 text-red-600 dark:text-red-400'
          }`}
        >
          {statusMessage.type === 'success' ? <CheckCircle size={16} /> : <AlertCircle size={16} />}
          <span className="font-medium">{statusMessage.text}</span>
        </div>
      )}

      {/* Guide Banner */}
      <div className="rounded-3xl border border-orange-500/20 bg-gradient-to-r from-orange-500/10 via-amber-500/5 to-transparent p-5 backdrop-blur-xl shadow-lg">
        <div className="flex items-start gap-3">
          <div className="p-2 rounded-xl bg-orange-500/20 text-orange-500 shrink-0">
            <Info size={18} />
          </div>
          <div className="text-xs text-gray-700 dark:text-gray-300 space-y-1">
            <p className="font-bold text-gray-900 dark:text-gray-100 text-sm">
              How Automated Messaging Works
            </p>
            <p className="leading-relaxed">
              Whenever a customer takes an action (such as placing an order on your website or tracking their delivery),
              the system dispatches a personalized email and SMS using the templates configured below.
              You can insert dynamic variables like <code className="px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-600 dark:text-orange-400 font-mono text-[11px]">{`{customerName}`}</code> and <code className="px-1.5 py-0.5 rounded bg-orange-500/20 text-orange-600 dark:text-orange-400 font-mono text-[11px]">{`{orderNumber}`}</code> to create personalized messages.
            </p>
          </div>
        </div>
      </div>

      {/* Templates List */}
      {loading ? (
        <div className="py-20 text-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-orange-500 border-t-transparent mx-auto mb-3" />
          <p className="text-xs uppercase tracking-widest text-gray-400">Loading automated triggers...</p>
        </div>
      ) : (
        <div className="space-y-6">
          {templates.map((tmpl) => {
            const isSaving = savingAction === tmpl.action;
            return (
              <div
                key={tmpl.action}
                className="rounded-3xl border border-white/20 dark:border-white/10 bg-white/70 dark:bg-zinc-900/80 backdrop-blur-2xl shadow-xl overflow-hidden transition-all hover:border-orange-500/30"
              >
                {/* Action Card Top Bar */}
                <div className="p-4 sm:p-5 border-b border-orange-500/10 dark:border-white/5 flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-gradient-to-r from-orange-500/5 via-transparent to-transparent">
                  <div className="flex items-center gap-3">
                    <div
                      className={`p-2.5 rounded-2xl ${
                        tmpl.enabled
                          ? 'bg-orange-500 text-white shadow-md shadow-orange-500/30'
                          : 'bg-gray-200 dark:bg-zinc-800 text-gray-400'
                      }`}
                    >
                      <Mail size={18} />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">
                          {tmpl.name}
                        </h3>
                        <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-orange-500/10 border border-orange-500/20 text-orange-500">
                          {tmpl.action}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 dark:text-gray-400 mt-0.5">
                        {tmpl.description}
                      </p>
                    </div>
                  </div>

                  {/* Enable Switch & Channel Selector */}
                  <div className="flex items-center gap-3">
                    <div className="flex items-center gap-2 bg-white/50 dark:bg-black/30 border border-white/15 dark:border-white/10 rounded-2xl p-1 backdrop-blur-md">
                      {(['EMAIL', 'SMS', 'BOTH'] as const).map((ch) => (
                        <button
                          key={ch}
                          type="button"
                          onClick={() => handleFieldChange(tmpl.action, 'channel', ch)}
                          className={`px-2.5 py-1 rounded-xl text-[11px] font-bold transition ${
                            tmpl.channel === ch
                              ? 'bg-orange-500 text-white shadow-sm'
                              : 'text-gray-500 hover:text-gray-800 dark:hover:text-gray-200'
                          }`}
                        >
                          {ch === 'BOTH' ? 'Email & SMS' : ch}
                        </button>
                      ))}
                    </div>

                    <button
                      type="button"
                      onClick={() => handleFieldChange(tmpl.action, 'enabled', !tmpl.enabled)}
                      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none ${
                        tmpl.enabled ? 'bg-orange-500' : 'bg-gray-300 dark:bg-zinc-700'
                      }`}
                    >
                      <span
                        className={`pointer-events-none inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                          tmpl.enabled ? 'translate-x-5' : 'translate-x-0'
                        }`}
                      />
                    </button>
                  </div>
                </div>

                {/* Form Body */}
                <div className="p-4 sm:p-6 space-y-4">
                  {/* Subject */}
                  <div>
                    <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                      Email Subject Line
                    </label>
                    <input
                      type="text"
                      value={tmpl.subject}
                      onChange={(e) => handleFieldChange(tmpl.action, 'subject', e.target.value)}
                      className="w-full rounded-2xl bg-white/60 dark:bg-zinc-800/60 border border-white/20 dark:border-white/10 px-4 py-2.5 text-xs sm:text-sm text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:border-orange-500 focus:outline-none transition shadow-sm backdrop-blur-md"
                    />
                  </div>

                  {/* Body & Placeholders */}
                  <div>
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-1.5">
                      <label className="text-xs font-semibold text-gray-700 dark:text-gray-300">
                        Message Content (Email Body & SMS Text)
                      </label>
                      <div className="flex items-center gap-1 flex-wrap">
                        <span className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold mr-1">
                          Click to insert:
                        </span>
                        {tmpl.placeholders.map((ph) => (
                          <button
                            key={ph}
                            type="button"
                            onClick={() => handleInsertPlaceholder(tmpl.action, ph)}
                            className="px-2 py-0.5 rounded-lg bg-orange-500/10 hover:bg-orange-500/20 text-orange-600 dark:text-orange-400 border border-orange-500/20 text-[10px] font-mono font-medium transition"
                          >
                            +{ph}
                          </button>
                        ))}
                      </div>
                    </div>

                    <textarea
                      rows={6}
                      value={tmpl.template}
                      onChange={(e) => handleFieldChange(tmpl.action, 'template', e.target.value)}
                      className="w-full rounded-2xl bg-white/60 dark:bg-zinc-800/60 border border-white/20 dark:border-white/10 p-4 text-xs sm:text-sm font-sans text-gray-900 dark:text-gray-100 placeholder:text-gray-400 focus:border-orange-500 focus:outline-none transition shadow-sm backdrop-blur-md leading-relaxed"
                    />
                  </div>

                  {/* Card Bottom Actions */}
                  <div className="pt-2 flex flex-wrap items-center justify-between gap-3 border-t border-orange-500/10 dark:border-white/5">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => setPreviewTemplate(tmpl)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white/40 dark:bg-zinc-800/40 border border-white/15 dark:border-white/10 text-xs font-semibold text-gray-700 dark:text-gray-300 hover:bg-white/60 transition"
                      >
                        <Eye size={13} className="text-orange-500" />
                        <span>Preview Message</span>
                      </button>

                      <button
                        type="button"
                        onClick={() => setTestModalTemplate(tmpl)}
                        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-orange-500/10 border border-orange-500/30 text-xs font-semibold text-orange-600 dark:text-orange-400 hover:bg-orange-500/20 transition"
                      >
                        <Send size={13} />
                        <span>Send Test</span>
                      </button>
                    </div>

                    <button
                      type="button"
                      onClick={() => handleSave(tmpl.action)}
                      disabled={isSaving}
                      className="inline-flex items-center gap-2 px-5 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 text-white text-xs font-bold shadow-md shadow-orange-500/25 hover:from-orange-600 hover:to-amber-600 transition disabled:opacity-50"
                    >
                      <Check size={14} />
                      <span>{isSaving ? 'Saving...' : 'Save Template'}</span>
                    </button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Preview Modal */}
      {previewTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <div className="w-full max-w-lg rounded-3xl border border-white/20 bg-white/95 dark:bg-[#111116]/95 backdrop-blur-2xl shadow-2xl overflow-hidden p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-orange-500/10 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-orange-500/15 text-orange-500">
                  <Mail size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                    Customer Message Preview
                  </h3>
                  <p className="text-[11px] text-gray-500">Trigger: {previewTemplate.name}</p>
                </div>
              </div>
              <button
                onClick={() => setPreviewTemplate(null)}
                className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-400 hover:text-gray-600"
              >
                <X size={16} />
              </button>
            </div>

            {/* Mock Email / SMS Shell */}
            {(() => {
              const { subject, body } = renderPreviewContent(previewTemplate);
              return (
                <div className="rounded-2xl border border-orange-500/20 bg-[#faf9f7] dark:bg-black/40 p-4 space-y-3 font-sans text-xs">
                  <div className="border-b border-gray-200 dark:border-zinc-800 pb-2.5">
                    <span className="text-[10px] uppercase font-bold text-gray-400">Subject:</span>
                    <p className="font-bold text-gray-900 dark:text-gray-100 mt-0.5">{subject}</p>
                  </div>
                  <div>
                    <span className="text-[10px] uppercase font-bold text-gray-400">Body Preview:</span>
                    <div className="mt-1 whitespace-pre-wrap text-gray-800 dark:text-gray-200 leading-relaxed font-sans bg-white/60 dark:bg-zinc-900/60 p-3 rounded-xl border border-white/20 dark:border-white/5">
                      {body}
                    </div>
                  </div>
                </div>
              );
            })()}

            <div className="flex justify-end pt-2">
              <button
                type="button"
                onClick={() => setPreviewTemplate(null)}
                className="px-4 py-2 rounded-xl bg-orange-500 text-white text-xs font-bold hover:bg-orange-600 transition"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Test Message Modal */}
      {testModalTemplate && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fadeIn">
          <form
            onSubmit={handleSendTest}
            className="w-full max-w-md rounded-3xl border border-white/20 bg-white/95 dark:bg-[#111116]/95 backdrop-blur-2xl shadow-2xl overflow-hidden p-6 space-y-4"
          >
            <div className="flex items-center justify-between border-b border-orange-500/10 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-xl bg-orange-500/15 text-orange-500">
                  <Send size={16} />
                </div>
                <div>
                  <h3 className="text-sm font-bold text-gray-900 dark:text-gray-100">
                    Send Test Automated Message
                  </h3>
                  <p className="text-[11px] text-gray-500">{testModalTemplate.name}</p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setTestModalTemplate(null)}
                className="p-1.5 rounded-xl hover:bg-gray-100 dark:hover:bg-zinc-800 text-gray-400 hover:text-gray-600"
              >
                <X size={16} />
              </button>
            </div>

            <div className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Recipient Test Email
                </label>
                <input
                  type="email"
                  required
                  placeholder="your-email@example.com"
                  value={testEmail}
                  onChange={(e) => setTestEmail(e.target.value)}
                  className="w-full rounded-2xl bg-white/60 dark:bg-zinc-800/60 border border-white/20 dark:border-white/10 px-3.5 py-2.5 text-xs sm:text-sm text-gray-900 dark:text-gray-100 focus:border-orange-500 focus:outline-none"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-gray-700 dark:text-gray-300 mb-1">
                  Recipient Phone (Optional for SMS test)
                </label>
                <input
                  type="tel"
                  placeholder="+254 700 000 000"
                  value={testPhone}
                  onChange={(e) => setTestPhone(e.target.value)}
                  className="w-full rounded-2xl bg-white/60 dark:bg-zinc-800/60 border border-white/20 dark:border-white/10 px-3.5 py-2.5 text-xs sm:text-sm text-gray-900 dark:text-gray-100 focus:border-orange-500 focus:outline-none"
                />
              </div>
            </div>

            <div className="flex justify-end gap-2 pt-3">
              <button
                type="button"
                onClick={() => setTestModalTemplate(null)}
                className="px-4 py-2 rounded-xl bg-gray-100 dark:bg-zinc-800 text-gray-600 dark:text-gray-300 text-xs font-semibold hover:bg-gray-200"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={testingAction === testModalTemplate.action}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-to-r from-orange-500 to-amber-500 text-white text-xs font-bold shadow-md shadow-orange-500/25 hover:from-orange-600 transition disabled:opacity-50"
              >
                <Send size={13} />
                <span>{testingAction === testModalTemplate.action ? 'Dispatching...' : 'Dispatch Test'}</span>
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
}
