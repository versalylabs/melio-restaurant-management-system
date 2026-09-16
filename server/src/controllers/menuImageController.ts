import { Response as ExpressResponse } from 'express';
import { AuthRequest } from '../middleware/auth';
import prisma from '../config/database';
import { sendError, sendResponse } from '../utils/response';
import { deleteMenuImage, extractMenuImagePath, uploadMenuImage } from '../services/storageService';

export const uploadMenuItemImage = async (req: AuthRequest, res: ExpressResponse) => {
  try {
    const { id } = req.params;
    const file = (req as any).file as Express.Multer.File | undefined;
    const restaurantId = req.user!.restaurantId;

    if (!file) return sendError(res, 'Please select an image to upload.');
    if (!['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.mimetype)) {
      return sendError(res, 'Only JPG, PNG, WEBP and GIF images are supported.');
    }
    if (file.size > 6 * 1024 * 1024) return sendError(res, 'Image must be 6MB or smaller.');

    const item = await prisma.menuItem.findFirst({ where: { id, restaurantId }, select: { id: true, image: true } });
    if (!item) return sendError(res, 'Menu item not found', undefined, 404);

    const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp', 'image/gif': 'gif' } as Record<string, string>)[file.mimetype];
    const path = `${restaurantId}/${id}/${Date.now()}.${ext}`;
    const imageUrl = await uploadMenuImage(path, file.buffer, file.mimetype);

    await prisma.menuItem.update({ where: { id }, data: { image: imageUrl } });

    const oldPath = extractMenuImagePath(item.image);
    if (oldPath && oldPath !== path) {
      try { await deleteMenuImage(oldPath); } catch (cleanupError) { console.warn('Could not remove old menu image:', cleanupError); }
    }

    return sendResponse(res, true, 'Menu image uploaded successfully', { image: imageUrl });
  } catch (error: any) {
    console.error('Menu image upload failed:', error);
    return sendError(res, error?.message || 'Failed to upload menu image');
  }
};

export const removeMenuItemImage = async (req: AuthRequest, res: ExpressResponse) => {
  try {
    const { id } = req.params;
    const restaurantId = req.user!.restaurantId;
    const item = await prisma.menuItem.findFirst({ where: { id, restaurantId }, select: { id: true, image: true } });
    if (!item) return sendError(res, 'Menu item not found', undefined, 404);

    const path = extractMenuImagePath(item.image);
    if (path) {
      try { await deleteMenuImage(path); } catch (cleanupError) { console.warn('Could not remove menu image from storage:', cleanupError); }
    }
    await prisma.menuItem.update({ where: { id }, data: { image: null } });
    return sendResponse(res, true, 'Menu image removed successfully');
  } catch (error: any) {
    console.error('Menu image removal failed:', error);
    return sendError(res, error?.message || 'Failed to remove menu image');
  }
};
