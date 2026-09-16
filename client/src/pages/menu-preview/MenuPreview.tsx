import { useState, useEffect } from 'react';
import { categoryApi, menuItemApi } from '../../services/api';
import type { Category, MenuItem } from '../../types';
import Button from '../../components/ui/Button';
import Card from '../../components/ui/Card';
import Badge from '../../components/ui/Badge';

export default function MenuPreview() {
  const [categories, setCategories] = useState<Category[]>([]);
  const [items, setItems] = useState<MenuItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    const fetchData = async () => {
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
    fetchData();
  }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-gray-500">Loading menu...</div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center justify-center h-full">
        <div className="text-red-600">{error}</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-gray-50">
      <header className="bg-white border-b border-gray-200">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <h1 className="text-3xl font-bold text-gray-900">MELIO</h1>
          <p className="text-gray-500 mt-1">Our Menu</p>
        </div>
      </header>
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {categories.map((category) => {
          const categoryItems = items.filter((item) => item.categoryId === category.id);
          if (categoryItems.length === 0) return null;
          return (
            <section key={category.id} className="mb-12">
              <h2 className="text-2xl font-bold text-gray-900 mb-6 pb-2 border-b-2 border-gray-200">{category.name}</h2>
              <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {categoryItems.map((item) => (
                  <Card key={item.id} className="h-full flex flex-col">
                    <div className="flex-1">
                      <div className="flex items-start justify-between">
                        <div>
                          <h3 className="text-lg font-semibold text-gray-900">{item.name}</h3>
                          {item.sku && <p className="text-xs text-gray-500 mt-1">SKU: {item.sku}</p>}
                        </div>
                        <span className="text-lg font-bold text-gray-900">KSh {item.sellingPrice.toLocaleString()}</span>
                      </div>
                      {item.description && (
                        <p className="text-sm text-gray-600 mt-2 line-clamp-2">{item.description}</p>
                      )}
                      {item.preparationTime && (
                        <p className="text-xs text-gray-500 mt-2">Prep time: {item.preparationTime} min</p>
                      )}
                    </div>
                    <div className="mt-4 flex items-center justify-between">
                      <Badge variant={item.available ? 'success' : 'danger'}>{item.available ? 'Available' : 'Unavailable'}</Badge>
                      <Button variant="secondary" size="sm">View Item</Button>
                    </div>
                  </Card>
                ))}
              </div>
            </section>
          );
        })}
        {items.length === 0 && (
          <div className="text-center py-12">
            <p className="text-gray-500">No menu items available at the moment.</p>
          </div>
        )}
      </main>
    </div>
  );
}
