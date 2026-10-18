/**
 * Shared Image Resolver for Menu Items and Gallery Photos.
 * Ensures all images resolve reliably to local bundled assets in /images/food/
 * without any external network or dead Supabase bucket dependency.
 */

export const LOCAL_MENU_FILENAMES: Record<string, string> = {
  'Samosa': 'Samosa.jpg',
  'Chicken Wings': 'Chicken Wings.jpg',
  'Grilled Chicken': 'Grilled Chicken.jpg',
  'Beef Steak': 'Beef Steak.jpg',
  'Chicken Burger': 'Chicken Burger.jpg',
  'Beef Burger': 'Beef Burger.jpg',
  'Coke': 'Coke.jpg',
  'Fresh Passion Juice': 'Passion Juice.jpg',
  'Passion Juice': 'Passion Juice.jpg',
  'Chocolate Cake': 'Chocolate Cake.jpg',
};

export const resolveImageUrl = (img?: string | null, name?: string | null): string => {
  if (img) {
    // If it's already a clean local image path, return it directly
    if (img.startsWith('/images/')) return img;

    // If it's an old dead Supabase URL, extract the filename and redirect to local
    if (img.includes('supabase.co') || img.includes('menu-images/')) {
      const parts = img.split('/');
      const last = parts[parts.length - 1]?.split('?')[0];
      const decoded = last ? decodeURIComponent(last) : '';
      if (decoded && Object.values(LOCAL_MENU_FILENAMES).includes(decoded)) {
        return `/images/food/${encodeURIComponent(decoded)}`;
      }
      if (name && LOCAL_MENU_FILENAMES[name]) {
        return `/images/food/${encodeURIComponent(LOCAL_MENU_FILENAMES[name])}`;
      }
      if (decoded) {
        return `/images/food/${encodeURIComponent(decoded)}`;
      }
    }

    return img;
  }

  // If no image was provided on the item but we have the item name, map to local image
  if (name && LOCAL_MENU_FILENAMES[name]) {
    return `/images/food/${encodeURIComponent(LOCAL_MENU_FILENAMES[name])}`;
  }

  return '';
};

export const getGalleryFallback = () => [
  { id: 'g1', title: 'Grilled Chicken', category: 'dishes' as const, image: '/images/food/Grilled%20Chicken.jpg', description: 'Melio signature grilled chicken.' },
  { id: 'g2', title: 'Beef Steak', category: 'dishes' as const, image: '/images/food/Beef%20Steak.jpg', description: 'Tender beef steak served with chips and salad.' },
  { id: 'g3', title: 'Beef Burger', category: 'dishes' as const, image: '/images/food/Beef%20Burger.jpg', description: 'Melio gourmet beef burger.' },
  { id: 'g4', title: 'Chicken Burger', category: 'dishes' as const, image: '/images/food/Chicken%20Burger.jpg', description: 'Grilled chicken burger with house sauce.' },
  { id: 'g5', title: 'Chicken Wings', category: 'dishes' as const, image: '/images/food/Chicken%20Wings.jpg', description: 'Spicy grilled chicken wings.' },
  { id: 'g6', title: 'Chocolate Cake', category: 'dishes' as const, image: '/images/food/Chocolate%20Cake.jpg', description: 'Rich chocolate layer cake.' },
];
