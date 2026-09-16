import { useEffect, useState } from 'react';
import { websiteApi } from '../../services/api';
import Button from '../../components/ui/Button';
import Input from '../../components/ui/Input';
import Modal from '../../components/ui/Modal';
import {
  Globe,
  Sparkles,
  Image as ImageIcon,
  MessageSquare,
  Building2,
  Plus,
  Trash2,
  Edit,
  Star,
  CheckCircle2,
  Share2,
  MapPin
} from 'lucide-react';

interface DiningHours {
  mondayThursday: string;
  fridaySaturday: string;
  sunday: string;
}

const DEFAULT_HOURS: DiningHours = {
  mondayThursday: '11:30 AM – 10:30 PM',
  fridaySaturday: '11:30 AM – 11:30 PM',
  sunday: '10:00 AM – 09:00 PM',
};

const parseHours = (raw: any): DiningHours => {
  if (!raw) return { ...DEFAULT_HOURS };
  if (typeof raw === 'object' && raw !== null) {
    return {
      mondayThursday: raw.mondayThursday || DEFAULT_HOURS.mondayThursday,
      fridaySaturday: raw.fridaySaturday || DEFAULT_HOURS.fridaySaturday,
      sunday: raw.sunday || DEFAULT_HOURS.sunday,
    };
  }
  try {
    const parsed = JSON.parse(raw);
    if (parsed && typeof parsed === 'object') {
      return {
        mondayThursday: parsed.mondayThursday || DEFAULT_HOURS.mondayThursday,
        fridaySaturday: parsed.fridaySaturday || DEFAULT_HOURS.fridaySaturday,
        sunday: parsed.sunday || DEFAULT_HOURS.sunday,
      };
    }
  } catch {}
  return { ...DEFAULT_HOURS };
};

export default function WebsiteManagement() {
  const [data, setData] = useState<any>(null);
  const [featured, setFeatured] = useState('');
  const [filters, setFilters] = useState<any[]>([]);
  const [branches, setBranches] = useState<any[]>([]);
  const [gallery, setGallery] = useState<any[]>([]);
  const [testimonials, setTestimonials] = useState<any[]>([]);
  const [socialLinks, setSocialLinks] = useState({ instagram: '', facebook: '', twitter: '', tripadvisor: '' });
  const [msg, setMsg] = useState('');
  const [savingSettings, setSavingSettings] = useState(false);

  // Gallery state
  const [galleryTitle, setGalleryTitle] = useState('');
  const [galleryCategory, setGalleryCategory] = useState('');
  const [galleryImageUrl, setGalleryImageUrl] = useState('');
  const [galleryFile, setGalleryFile] = useState<File | null>(null);
  const [galleryMode, setGalleryMode] = useState<'upload' | 'url'>('upload');
  const [uploadingGallery, setUploadingGallery] = useState(false);

  // Testimonial Modal State
  const [testimonialModalOpen, setTestimonialModalOpen] = useState(false);
  const [editingTestimonial, setEditingTestimonial] = useState<any>(null);
  const [testimonialForm, setTestimonialForm] = useState({
    name: '',
    role: '',
    rating: 5,
    dateLabel: '',
    text: '',
  });
  const [savingTestimonial, setSavingTestimonial] = useState(false);

  // Branch saving status
  const [savingBranchId, setSavingBranchId] = useState<string | null>(null);

  const showNotification = (message: string) => {
    setMsg(message);
    setTimeout(() => setMsg(''), 4000);
  };

  const load = async () => {
    try {
      const res = await websiteApi.get();
      const x = res.data?.data || {};
      setData(x);
      setFeatured(x.settings?.featuredMenuItemId || '');
      setFilters(Array.isArray(x.filters) && x.filters.length ? x.filters : [
        { id: 'dishes', label: 'Signature Dishes' },
        { id: 'cocktails', label: 'Bar & Cocktails' },
        { id: 'ambience', label: 'Interior & Ambience' },
      ]);
      setBranches(x.branches || []);
      setGallery(x.gallery || []);
      setTestimonials(x.testimonials || []);
      if (x.socialLinks && typeof x.socialLinks === 'object') {
        setSocialLinks({
          instagram: x.socialLinks.instagram || '',
          facebook: x.socialLinks.facebook || '',
          twitter: x.socialLinks.twitter || '',
          tripadvisor: x.socialLinks.tripadvisor || '',
        });
      }
    } catch (err: any) {
      console.error('Failed to load website management data:', err);
    }
  };

  useEffect(() => {
    load();
  }, []);

  if (!data) {
    return (
      <div className="flex min-h-[50vh] items-center justify-center text-gray-500">
        <div className="flex items-center gap-3">
          <div className="h-6 w-6 animate-spin rounded-full border-2 border-orange-500 border-t-transparent" />
          <span>Loading website management...</span>
        </div>
      </div>
    );
  }

  const saveSettings = async () => {
    setSavingSettings(true);
    try {
      await websiteApi.updateSettings({
        featuredMenuItemId: featured || null,
        galleryFilters: filters,
        socialLinks,
      });
      showNotification('Website settings successfully saved!');
    } catch (err: any) {
      showNotification(err.response?.data?.message || 'Failed to save settings.');
    } finally {
      setSavingSettings(false);
    }
  };

  const handleAddGalleryItem = async () => {
    const category = galleryCategory || filters[0]?.id || 'dishes';
    if (!galleryTitle.trim()) {
      alert('Please provide an image title.');
      return;
    }

    if (galleryMode === 'upload' && !galleryFile) {
      alert('Please select an image file to upload.');
      return;
    }

    if (galleryMode === 'url' && !galleryImageUrl.trim()) {
      alert('Please provide an image URL.');
      return;
    }

    setUploadingGallery(true);
    try {
      if (galleryMode === 'upload' && galleryFile) {
        const fd = new FormData();
        fd.append('title', galleryTitle.trim());
        fd.append('category', category);
        fd.append('image', galleryFile);
        await websiteApi.uploadGallery(fd);
      } else {
        await websiteApi.addGallery({
          title: galleryTitle.trim(),
          category,
          image: galleryImageUrl.trim(),
        });
      }
      setGalleryTitle('');
      setGalleryImageUrl('');
      setGalleryFile(null);
      showNotification('Gallery image added successfully.');
      load();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to add gallery item.');
    } finally {
      setUploadingGallery(false);
    }
  };

  const openTestimonialModal = (item?: any) => {
    if (item) {
      setEditingTestimonial(item);
      setTestimonialForm({
        name: item.name || '',
        role: item.role || '',
        rating: item.rating || 5,
        dateLabel: item.dateLabel || '',
        text: item.text || '',
      });
    } else {
      setEditingTestimonial(null);
      setTestimonialForm({
        name: '',
        role: 'Verified Guest',
        rating: 5,
        dateLabel: new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' }).format(new Date()),
        text: '',
      });
    }
    setTestimonialModalOpen(true);
  };

  const handleSaveTestimonial = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testimonialForm.name.trim() || !testimonialForm.text.trim()) {
      alert('Name and testimonial text are required.');
      return;
    }

    setSavingTestimonial(true);
    try {
      if (editingTestimonial) {
        await websiteApi.updateTestimonial(editingTestimonial.id, testimonialForm);
        showNotification('Testimonial updated successfully.');
      } else {
        await websiteApi.addTestimonial(testimonialForm);
        showNotification('Testimonial added successfully.');
      }
      setTestimonialModalOpen(false);
      load();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to save testimonial.');
    } finally {
      setSavingTestimonial(false);
    }
  };

  const handleDeleteTestimonial = async (id: string) => {
    if (!confirm('Are you sure you want to remove this testimonial?')) return;
    try {
      await websiteApi.removeTestimonial(id);
      showNotification('Testimonial removed.');
      load();
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to remove testimonial.');
    }
  };

  const handleSaveBranch = async (b: any) => {
    setSavingBranchId(b.id);
    try {
      const hours = parseHours(b.diningHours);
      await websiteApi.updateBranch(b.id, {
        ...b,
        diningHours: hours,
      });
      showNotification(`${b.name} details saved successfully.`);
    } catch (err: any) {
      alert(err.response?.data?.message || 'Failed to update branch.');
    } finally {
      setSavingBranchId(null);
    }
  };

  return (
    <div className="rms-page max-w-7xl mx-auto space-y-6 pb-12">
      {/* Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2.5">
            <div className="rounded-xl bg-orange-100 dark:bg-orange-500/10 p-2 text-orange-600">
              <Globe size={22} />
            </div>
            <h1 className="text-2xl font-bold tracking-tight text-gray-900 dark:text-white">
              Website Management
            </h1>
          </div>
          <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
            Customize public landing page content, featured signature dishes, testimonials, gallery, and dining hours.
          </p>
        </div>
        <a
          href="/"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-xl border border-orange-200 bg-white px-4 py-2.5 text-xs font-semibold text-orange-700 shadow-sm transition hover:bg-orange-50 dark:border-white/10 dark:bg-[#111116] dark:text-orange-400 dark:hover:bg-[#16161c]"
        >
          View Live Site ↗
        </a>
      </div>

      {msg && (
        <div className="flex items-center gap-2 rounded-xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800 dark:border-emerald-500/20 dark:bg-emerald-500/10 dark:text-emerald-300">
          <CheckCircle2 size={18} className="shrink-0 text-emerald-600 dark:text-emerald-400" />
          <span>{msg}</span>
        </div>
      )}

      {/* 1. Homepage & Signature Dish */}
      <section className="rms-surface p-6">
        <div className="flex items-center gap-2 border-b border-orange-100/60 pb-4 dark:border-white/5">
          <Sparkles className="h-5 w-5 text-orange-500" />
          <h2 className="font-semibold text-gray-900 dark:text-white">Homepage & Featured Signature Dish</h2>
        </div>

        <div className="mt-5 grid gap-6 md:grid-cols-2">
          <div>
            <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1.5">
              Featured Signature Dish
            </label>
            <p className="text-xs text-gray-500 mb-2">
              This dish will be prominently highlighted in the hero spotlight card on the homepage.
            </p>
            <select
              value={featured}
              onChange={(e) => setFeatured(e.target.value)}
              className="w-full rounded-xl border border-gray-200 bg-white p-2.5 text-sm dark:bg-[#111116] dark:border-gray-700 dark:text-gray-100"
            >
              <option value="">Automatic (Top menu item with image)</option>
              {(data.menuItems || []).map((m: any) => (
                <option key={m.id} value={m.id}>
                  {m.name} — KSh {Number(m.sellingPrice || 0).toLocaleString()}
                </option>
              ))}
            </select>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1.5">
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                Gallery Filter Categories (Max 6)
              </label>
              <button
                type="button"
                disabled={filters.length >= 6}
                onClick={() =>
                  setFilters([
                    ...filters,
                    { id: `filter-${filters.length + 1}`, label: `Filter ${filters.length + 1}` },
                  ])
                }
                className="text-xs font-semibold text-orange-600 hover:text-orange-700 disabled:opacity-40"
              >
                + Add Filter
              </button>
            </div>
            <p className="text-xs text-gray-500 mb-2">Filter pills shown in the website culinary gallery.</p>
            <div className="space-y-2">
              {filters.map((f, i) => (
                <div className="flex items-center gap-2" key={i}>
                  <Input
                    id={`f_${i}`}
                    value={f.label}
                    onChange={(e) =>
                      setFilters(
                        filters.map((x, j) => (j === i ? { ...x, label: e.target.value } : x))
                      )
                    }
                    placeholder="Filter label"
                  />
                  <button
                    type="button"
                    onClick={() => setFilters(filters.filter((_, j) => j !== i))}
                    className="p-2 text-gray-400 hover:text-red-500 transition"
                    title="Remove filter"
                  >
                    <Trash2 size={16} />
                  </button>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Social Links */}
        <div className="mt-6 border-t border-orange-100/60 pt-5 dark:border-white/5">
          <div className="flex items-center gap-2 mb-3">
            <Share2 className="h-4 w-4 text-orange-500" />
            <h3 className="text-sm font-semibold text-gray-800 dark:text-gray-200">Social Media & Online Links</h3>
          </div>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Input
              id="soc-ig"
              label="Instagram URL"
              placeholder="https://instagram.com/..."
              value={socialLinks.instagram}
              onChange={(e) => setSocialLinks({ ...socialLinks, instagram: e.target.value })}
            />
            <Input
              id="soc-fb"
              label="Facebook URL"
              placeholder="https://facebook.com/..."
              value={socialLinks.facebook}
              onChange={(e) => setSocialLinks({ ...socialLinks, facebook: e.target.value })}
            />
            <Input
              id="soc-tw"
              label="Twitter / X URL"
              placeholder="https://x.com/..."
              value={socialLinks.twitter}
              onChange={(e) => setSocialLinks({ ...socialLinks, twitter: e.target.value })}
            />
            <Input
              id="soc-ta"
              label="TripAdvisor URL"
              placeholder="https://tripadvisor.com/..."
              value={socialLinks.tripadvisor}
              onChange={(e) => setSocialLinks({ ...socialLinks, tripadvisor: e.target.value })}
            />
          </div>
        </div>

        <div className="mt-6 flex justify-end">
          <Button onClick={saveSettings} loading={savingSettings}>
            Save Website Settings
          </Button>
        </div>
      </section>

      {/* 2. Gallery Images */}
      <section className="rms-surface p-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-orange-100/60 pb-4 dark:border-white/5">
          <div className="flex items-center gap-2">
            <ImageIcon className="h-5 w-5 text-orange-500" />
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-white">Culinary Gallery Images</h2>
              <p className="text-xs text-gray-500">Showcase high-resolution photos of dishes, cocktails, and ambience.</p>
            </div>
          </div>
          <div className="flex items-center gap-2 bg-orange-50 dark:bg-orange-500/10 p-1 rounded-xl">
            <button
              type="button"
              onClick={() => setGalleryMode('upload')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition ${
                galleryMode === 'upload'
                  ? 'bg-white text-orange-700 shadow-sm dark:bg-[#111116] dark:text-orange-400'
                  : 'text-gray-600 dark:text-gray-400 hover:text-orange-600'
              }`}
            >
              Upload File
            </button>
            <button
              type="button"
              onClick={() => setGalleryMode('url')}
              className={`px-3 py-1 text-xs font-semibold rounded-lg transition ${
                galleryMode === 'url'
                  ? 'bg-white text-orange-700 shadow-sm dark:bg-[#111116] dark:text-orange-400'
                  : 'text-gray-600 dark:text-gray-400 hover:text-orange-600'
              }`}
            >
              Image URL
            </button>
          </div>
        </div>

        {/* Add Image Form */}
        <div className="mt-5 rounded-xl border border-orange-100/80 bg-[#faf9f7] p-4 dark:border-white/5 dark:bg-[#111116]/50">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4 items-end">
            <Input
              id="gTitle"
              label="Image Title"
              placeholder="e.g. Signature Ribeye Steak"
              value={galleryTitle}
              onChange={(e) => setGalleryTitle(e.target.value)}
            />
            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Category Filter
              </label>
              <select
                value={galleryCategory || filters[0]?.id || ''}
                onChange={(e) => setGalleryCategory(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white p-2 text-sm dark:bg-[#111116] dark:border-gray-700 dark:text-gray-100"
              >
                {filters.map((f: any) => (
                  <option key={f.id} value={f.id}>
                    {f.label}
                  </option>
                ))}
              </select>
            </div>

            {galleryMode === 'upload' ? (
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Upload Image File
                </label>
                <input
                  type="file"
                  accept="image/jpeg,image/png,image/webp,image/gif"
                  onChange={(e) => setGalleryFile(e.target.files?.[0] || null)}
                  className="w-full text-xs file:mr-2 file:rounded-lg file:border-0 file:bg-orange-500 file:px-3 file:py-2 file:text-xs file:font-semibold file:text-white hover:file:bg-orange-600 cursor-pointer"
                />
              </div>
            ) : (
              <Input
                id="gUrl"
                label="Image URL"
                placeholder="https://..."
                value={galleryImageUrl}
                onChange={(e) => setGalleryImageUrl(e.target.value)}
              />
            )}

            <Button onClick={handleAddGalleryItem} loading={uploadingGallery} className="gap-2">
              <Plus size={16} /> Add Image
            </Button>
          </div>
        </div>

        {/* Gallery Grid */}
        <div className="mt-6 grid gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4">
          {gallery.map((g: any) => (
            <div
              key={g.id}
              className="group relative overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm transition hover:shadow-md dark:border-gray-800 dark:bg-[#111116]"
            >
              <div className="relative h-40 w-full overflow-hidden bg-zinc-900">
                <img
                  src={g.image}
                  alt={g.title}
                  className="h-full w-full object-cover transition duration-300 group-hover:scale-105"
                  onError={(e) => {
                    (e.target as HTMLElement).style.display = 'none';
                  }}
                />
                <span className="absolute top-2 right-2 rounded-full bg-black/60 backdrop-blur-sm px-2.5 py-0.5 text-[10px] font-bold text-white uppercase tracking-wider">
                  {filters.find((f: any) => f.id === g.category)?.label || g.category}
                </span>
              </div>
              <div className="p-3.5 flex items-center justify-between">
                <p className="font-semibold text-sm truncate text-gray-900 dark:text-gray-100">{g.title}</p>
                <button
                  type="button"
                  onClick={async () => {
                    if (confirm(`Remove "${g.title}" from gallery?`)) {
                      await websiteApi.removeGallery(g.id);
                      load();
                    }
                  }}
                  className="text-gray-400 hover:text-red-500 transition p-1"
                  title="Delete image"
                >
                  <Trash2 size={16} />
                </button>
              </div>
            </div>
          ))}
          {gallery.length === 0 && (
            <div className="col-span-full py-8 text-center text-sm text-gray-400">
              No custom gallery images uploaded yet. The website will display fallback signature items.
            </div>
          )}
        </div>
      </section>

      {/* 3. Testimonials & Accolades */}
      <section className="rms-surface p-6">
        <div className="flex items-center justify-between border-b border-orange-100/60 pb-4 dark:border-white/5">
          <div className="flex items-center gap-2">
            <MessageSquare className="h-5 w-5 text-orange-500" />
            <div>
              <h2 className="font-semibold text-gray-900 dark:text-white">Guest Reviews & Testimonials</h2>
              <p className="text-xs text-gray-500">Manage real feedback displayed on the public website.</p>
            </div>
          </div>
          <Button onClick={() => openTestimonialModal()} className="gap-2">
            <Plus size={16} /> Add Testimonial
          </Button>
        </div>

        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-3">
          {testimonials.map((t: any) => (
            <div
              key={t.id}
              className="flex flex-col justify-between rounded-2xl border border-gray-100 bg-white p-5 shadow-sm dark:border-gray-800 dark:bg-[#111116]"
            >
              <div>
                <div className="flex items-center justify-between mb-2">
                  <div className="flex text-orange-400">
                    {Array.from({ length: t.rating || 5 }).map((_, i) => (
                      <Star key={i} size={14} className="fill-orange-400 text-orange-400" />
                    ))}
                  </div>
                  <div className="flex items-center gap-1">
                    <button
                      type="button"
                      onClick={() => openTestimonialModal(t)}
                      className="p-1 text-gray-400 hover:text-orange-600 transition"
                      title="Edit"
                    >
                      <Edit size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteTestimonial(t.id)}
                      className="p-1 text-gray-400 hover:text-red-500 transition"
                      title="Delete"
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                </div>
                <p className="text-sm italic text-gray-700 dark:text-gray-300 leading-relaxed line-clamp-3">
                  "{t.text}"
                </p>
              </div>

              <div className="mt-4 pt-3 border-t border-gray-100 dark:border-gray-800 flex items-center justify-between">
                <div>
                  <div className="font-bold text-sm text-gray-900 dark:text-white">{t.name}</div>
                  <div className="text-xs text-orange-500 font-medium">{t.role || 'Guest'}</div>
                </div>
                {t.dateLabel && (
                  <span className="text-[11px] text-gray-400">{t.dateLabel}</span>
                )}
              </div>
            </div>
          ))}

          {testimonials.length === 0 && (
            <div className="col-span-full py-8 text-center text-sm text-gray-400">
              No custom testimonials added yet. Curated sample testimonials will be shown on the website.
            </div>
          )}
        </div>
      </section>

      {/* 4. Our Establishments & Branch Dining Hours */}
      <section className="rms-surface p-6">
        <div className="flex items-center gap-2 border-b border-orange-100/60 pb-4 dark:border-white/5">
          <Building2 className="h-5 w-5 text-orange-500" />
          <div>
            <h2 className="font-semibold text-gray-900 dark:text-white">Our Establishments & Locations</h2>
            <p className="text-xs text-gray-500">Edit branch contact info, addresses, and dining hours shown on the website.</p>
          </div>
        </div>

        <div className="mt-6 space-y-6">
          {branches.map((b: any) => {
            const h = parseHours(b.diningHours);
            return (
              <div
                key={b.id}
                className="rounded-2xl border border-gray-100 bg-[#faf9f7] p-5 dark:border-gray-800 dark:bg-[#111116]/60 space-y-4"
              >
                <div className="flex items-center justify-between pb-3 border-b border-gray-200 dark:border-gray-700">
                  <div className="flex items-center gap-2">
                    <MapPin className="h-4 w-4 text-orange-500" />
                    <span className="font-bold text-base text-gray-900 dark:text-white">{b.name}</span>
                    <span className="text-xs text-gray-400 font-mono">({b.code})</span>
                  </div>
                  <Button
                    onClick={() => handleSaveBranch(b)}
                    loading={savingBranchId === b.id}
                    size="sm"
                  >
                    Save Branch
                  </Button>
                </div>

                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  <Input
                    id={`bn_${b.id}`}
                    label="Branch Display Name"
                    value={b.name}
                    onChange={(e) =>
                      setBranches(
                        branches.map((x) => (x.id === b.id ? { ...x, name: e.target.value } : x))
                      )
                    }
                  />
                  <Input
                    id={`ba_${b.id}`}
                    label="Physical Address"
                    value={b.address || ''}
                    placeholder="e.g. 12 Riverside Drive, Westlands"
                    onChange={(e) =>
                      setBranches(
                        branches.map((x) => (x.id === b.id ? { ...x, address: e.target.value } : x))
                      )
                    }
                  />
                  <Input
                    id={`bp_${b.id}`}
                    label="Call Branch Number"
                    value={b.callPhone || b.phone || ''}
                    placeholder="+254 700 000000"
                    onChange={(e) =>
                      setBranches(
                        branches.map((x) => (x.id === b.id ? { ...x, callPhone: e.target.value } : x))
                      )
                    }
                  />
                </div>

                <div>
                  <label className="block text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">
                    Operating / Dining Hours
                  </label>
                  <div className="grid gap-3 sm:grid-cols-3">
                    <Input
                      id={`bm_${b.id}`}
                      label="Monday – Thursday"
                      value={h.mondayThursday}
                      placeholder="11:30 AM – 10:30 PM"
                      onChange={(e) =>
                        setBranches(
                          branches.map((x) =>
                            x.id === b.id
                              ? {
                                  ...x,
                                  diningHours: {
                                    ...h,
                                    mondayThursday: e.target.value,
                                  },
                                }
                              : x
                          )
                        )
                      }
                    />
                    <Input
                      id={`bf_${b.id}`}
                      label="Friday – Saturday"
                      value={h.fridaySaturday}
                      placeholder="11:30 AM – 11:30 PM"
                      onChange={(e) =>
                        setBranches(
                          branches.map((x) =>
                            x.id === b.id
                              ? {
                                  ...x,
                                  diningHours: {
                                    ...h,
                                    fridaySaturday: e.target.value,
                                  },
                                }
                              : x
                          )
                        )
                      }
                    />
                    <Input
                      id={`bs_${b.id}`}
                      label="Sunday"
                      value={h.sunday}
                      placeholder="10:00 AM – 09:00 PM"
                      onChange={(e) =>
                        setBranches(
                          branches.map((x) =>
                            x.id === b.id
                              ? {
                                  ...x,
                                  diningHours: {
                                    ...h,
                                    sunday: e.target.value,
                                  },
                                }
                              : x
                          )
                        )
                      }
                    />
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </section>

      {/* Testimonial Modal */}
      {testimonialModalOpen && (
        <Modal
          title={editingTestimonial ? 'Edit Testimonial' : 'Add Guest Testimonial'}
          onClose={() => setTestimonialModalOpen(false)}
        >
          <form onSubmit={handleSaveTestimonial} className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Input
                id="tName"
                label="Guest / Reviewer Name"
                placeholder="e.g. Victoria Montgomery"
                value={testimonialForm.name}
                onChange={(e) => setTestimonialForm({ ...testimonialForm, name: e.target.value })}
                required
              />
              <Input
                id="tRole"
                label="Role or Tagline"
                placeholder="e.g. Food Critic / Verified Guest"
                value={testimonialForm.role}
                onChange={(e) => setTestimonialForm({ ...testimonialForm, role: e.target.value })}
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                  Rating (1 to 5 Stars)
                </label>
                <div className="flex items-center gap-2 mt-1">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setTestimonialForm({ ...testimonialForm, rating: star })}
                      className="p-1 text-orange-400 hover:scale-110 transition"
                    >
                      <Star
                        size={22}
                        className={
                          star <= testimonialForm.rating
                            ? 'fill-orange-400 text-orange-400'
                            : 'text-gray-300 dark:text-gray-600'
                        }
                      />
                    </button>
                  ))}
                  <span className="text-xs font-bold text-orange-600 ml-2">
                    {testimonialForm.rating}.0 / 5.0
                  </span>
                </div>
              </div>

              <Input
                id="tDate"
                label="Date Label (optional)"
                placeholder="e.g. March 2026"
                value={testimonialForm.dateLabel}
                onChange={(e) => setTestimonialForm({ ...testimonialForm, dateLabel: e.target.value })}
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
                Testimonial Text
              </label>
              <textarea
                rows={4}
                required
                value={testimonialForm.text}
                onChange={(e) => setTestimonialForm({ ...testimonialForm, text: e.target.value })}
                placeholder="Share the guest's dining experience, praises, or feedback..."
                className="w-full rounded-xl border border-gray-300 dark:border-gray-600 bg-white dark:bg-[#111116] px-3.5 py-2.5 text-sm dark:text-gray-100 outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20"
              />
            </div>

            <div className="flex justify-end gap-3 pt-3 border-t border-gray-100 dark:border-gray-800">
              <Button
                type="button"
                variant="secondary"
                onClick={() => setTestimonialModalOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit" loading={savingTestimonial}>
                {editingTestimonial ? 'Save Changes' : 'Add Testimonial'}
              </Button>
            </div>
          </form>
        </Modal>
      )}
    </div>
  );
}
