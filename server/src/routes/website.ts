import { Router } from 'express';
import multer from 'multer';
import { adminWebsiteRouter, publicWebsiteController } from '../controllers/websiteController';
import { createGalleryItem } from '../services/websiteService';
import { authenticate, authorize } from '../middleware/auth';
import { safeRouter } from '../utils/safeRouter';
const router=safeRouter(); const galleryUpload=multer({storage:multer.memoryStorage(),limits:{fileSize:6*1024*1024}}); router.get('/public',publicWebsiteController); router.post('/gallery/upload',authenticate,authorize('OWNER','ADMIN','MANAGER'),galleryUpload.single('image'),createGalleryItem); router.use('/',adminWebsiteRouter); export default router;
