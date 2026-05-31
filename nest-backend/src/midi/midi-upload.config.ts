import { BadRequestException } from '@nestjs/common';
import { MulterOptions } from '@nestjs/platform-express/multer/interfaces/multer-options.interface';
import { existsSync, mkdirSync } from 'fs';
import { diskStorage } from 'multer';
import { UPLOADS_DIR } from '../config/paths';

const ALLOWED_EXTENSIONS = ['mid', 'midi'];

/** Strips path separators and unusual characters, à la werkzeug secure_filename. */
function secureFilename(name: string): string {
  return name
    .replace(/[^A-Za-z0-9_.-]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 200);
}

export const midiUploadOptions: MulterOptions = {
  storage: diskStorage({
    destination: (_req, _file, cb) => {
      if (!existsSync(UPLOADS_DIR)) {
        mkdirSync(UPLOADS_DIR, { recursive: true });
      }
      cb(null, UPLOADS_DIR);
    },
    filename: (_req, file, cb) => {
      const prefix = Math.floor(Math.random() * 1_000_000);
      cb(null, `${prefix}_${secureFilename(file.originalname)}`);
    },
  }),
  fileFilter: (_req, file, cb) => {
    const ext = file.originalname.split('.').pop()?.toLowerCase() ?? '';
    if (!ALLOWED_EXTENSIONS.includes(ext)) {
      cb(new BadRequestException('Only .mid/.midi files are allowed'), false);
      return;
    }
    cb(null, true);
  },
};
