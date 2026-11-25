import { useState, useEffect } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Clock, RefreshCw, X, UtensilsCrossed } from 'lucide-react';
import { categoryApi, menuItemApi } from '../../services/api';
import type { Category, MenuItem } from '../../types';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';
import { OptimizedImage } from '../../components/common/OptimizedImage';
import DialogOverlay from '../../components/ui/DialogOverlay';

export default function MenuPreview() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selectedItem, setSelectedItem] = useState<MenuItem | null>(null);

  const fetchData = async () => {
    setLoading(true);
    setError('');
    try {
      const [catRes, itemRes] = await Promise.all([
        categoryApi.getCategories({ status: 'ACTIVE' }),
        menuItemApi.getMenuItems({ status: 'ACTIVE', available: 'true' }),
      ]);
      if (catRes.data.success) setCategories(catRes.data.data?.categories || []);
      if (itemRes.data.success) setItems(itemRes.data.data?.items || []);
    } catch (err: any) {
      setError(err.response?.data?.message || 'Failed to load menu');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="min-h-screen grid place-items-center bg-[#faf9f7] dark:bg-[#0d0d11] text-orange-500">
        <div className="flex flex-col items-center gap-3">
          <RefreshCw className="h-8 w-8 animate-spin text-orange-500" />
          <p className="text-sm font-medium text-gray-600 dark:text-gray-300">Loading live menu...</p>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="min-h-screen grid place-items-center bg-[#faf9f7] dark:bg-[#0d0d11] p-6">
        <div className="max-w-md w-full text-center space-y-4 rounded-2xl border border-red-500/20 bg-red-500/10 p-6">
          <p className="text-red-500 font-medium">{error}</p>
          <Button variant="primary" onClick={fetchData} className="inline-flex items-center gap-2">
            <RefreshCw className="h-4 w-4" /> Try Again
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[#faf9f7] dark:bg-[#0d0d11] text-gray-900 dark:text-gray-100 transition-colors">
      <header className="sticky top-0 z-30 border-b border-orange-500/10 bg-white/80 dark:bg-[#121218]/80 backdrop-blur-xl">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link
              to="/menu/items"
              className="inline-flex items-center gap-2 rounded-xl border border-orange-500/20 bg-orange-500/10 px-3 py-1.5 text-xs font-semibold text-orange-600 dark:text-orange-400 hover:bg-orange-500/20 transition"
            >
              <ArrowLeft className="h-3.5 w-3.5" /> Back to Menu Items
            </Link>
            <div>
              <h1 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900 dark:text-white">Melio Digital Menu</h1>
              <p className="text-xs text-gray-500 dark:text-gray-400">Live guest & staff catalog preview</p>
            </div>
          </div>
          <Button variant="secondary" size="sm" onClick={fetchData} className="inline-flex items-center gap-1.5">
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
        </div>
      </header>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-12">
        {categories.map((category) => {
          const categoryItems = items.filter((item) => item.categoryId === category.id);
          if (categoryItems.length === 0) return null;
          return (
            <section key={category.id} className="space-y-6">
              <div className="flex items-center gap-3 pb-2 border-b border-orange-500/15 dark:border-white/10">
                <div className="h-2 w-2 rounded-full bg-orange-500" />
                <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-gray-900 dark:text-white">{category.name}</h2>
                <span className="text-xs font-medium text-gray-400 dark:text-gray-500">({categoryItems.length} items)</span>
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6">
                {categoryItems.map((item) => (
                  <Card key={item.id} className="overflow-hidden flex flex-col justify-between hover:border-orange-500/40 transition-all duration-200">
                    <div>
                      <div className="aspect-[16/10] w-full overflow-hidden rounded-t-xl bg-orange-50 dark:bg-[#15151c]">
                        <OptimizedImage
                          src={item.image}
                          alt={item.name}
                          className="h-full w-full object-cover transition-transform duration-300 hover:scale-105"
                        />
                      </div>
                      <div className="p-4 space-y-2">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-base font-bold text-gray-900 dark:text-gray-100">{item.name}</h3>
                          <span className="text-base font-extrabold text-orange-600 dark:text-orange-400 whitespace-nowrap">
                            KSh {(item.sellingPrice ?? 0).toLocaleString()}
                          </span>
                        </div>
                        {item.description && (
                          <p className="text-xs text-gray-600 dark:text-gray-400 line-clamp-2 leading-relaxed">
                            {item.description}
                          </p>
                        )}
                        {item.preparationTime && (
                          <div className="flex items-center gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                            <Clock className="h-3.5 w-3.5 text-orange-500" />
                            <span>{item.preparationTime} min prep</span>
                          </div>
                        )}
                      </div>
                    </div>
                    <div className="p-4 pt-0 flex items-center justify-between border-t border-orange-500/10 dark:border-white/5 mt-3">
                      <Badge variant={item.available ? 'success' : 'danger'}>
                        {item.available ? 'Available' : 'Unavailable'}
                      </Badge>
                      <Button variant="secondary" size="sm" onClick={() => setSelectedItem(item)}>
                        View Item
                      </Button>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          );
        })}

        {items.length === 0 && (
          <div className="text-center py-20 rounded-3xl border border-dashed border-orange-500/20 p-8 space-y-3">
            <UtensilsCrossed className="h-12 w-12 text-orange-400 mx-auto" />
            <p className="text-base font-medium text-gray-600 dark:text-gray-300">No menu items available at the moment.</p>
            <p className="text-xs text-gray-500">Add categories and items from the Menu Items management page.</p>
          </div>
        )}
      </main>

      {/* Item Detail Modal */}
      {selectedItem && (
        <DialogOverlay onClose={() => setSelectedItem(null)} label="Menu item details" className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
          <div className="glass-raised w-full max-w-lg rounded-3xl p-6 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-lg font-bold text-gray-900 dark:text-white">{selectedItem.name}</h2>
              <button aria-label="Close"
                type="button"
                onClick={() => setSelectedItem(null)}
                className="rounded-xl p-1.5 text-gray-400 hover:bg-orange-500/10 hover:text-orange-500"
              >
                <X className="h-5 w-5" aria-hidden="true" />
              </button>
            </div>
            <div className="aspect-[16/10] w-full overflow-hidden rounded-2xl bg-orange-50 dark:bg-[#15151c]">
              <OptimizedImage
                src={selectedItem.image}
                alt={selectedItem.name}
                className="h-full w-full object-cover"
              />
            </div>
            <div className="space-y-2">
              <div className="flex items-center justify-between">
                <span className="text-xl font-bold text-orange-500">
                  KSh {(selectedItem.sellingPrice ?? 0).toLocaleString()}
                </span>
                <Badge variant={selectedItem.available ? 'success' : 'danger'}>
                  {selectedItem.available ? 'Available' : 'Unavailable'}
                </Badge>
              </div>
              <p className="text-sm text-gray-600 dark:text-gray-300 leading-relaxed">
                {selectedItem.description || 'Specialty house dish prepared with fresh local ingredients.'}
              </p>
              {selectedItem.preparationTime && (
                <p className="text-xs text-gray-500 flex items-center gap-1.5">
                  <Clock className="h-3.5 w-3.5 text-orange-500" />
                  Estimated preparation time: {selectedItem.preparationTime} minutes
                </p>
              )}
            </div>
            <div className="pt-2 flex justify-end">
              <Button variant="secondary" onClick={() => setSelectedItem(null)}>
                Close
              </Button>
            </div>
          </div>
        </DialogOverlay>
      )}
    </div>
  );
}
