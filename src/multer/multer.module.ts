import { BadRequestException, Module } from "@nestjs/common";
import { MulterModule } from "@nestjs/platform-express";
import { randomUUID } from "crypto";
import { existsSync, mkdirSync } from "fs";
import { diskStorage } from "multer";
import { join } from "path";

@Module({
  imports: [
    MulterModule.register({
      storage: diskStorage({
        destination: (req, file, callback) => {
          let destination: string;
    
          if (file.fieldname === 'image') {
            destination = join(
              process.cwd(),
              'uploads',
              'receitas',
              'images',
            );
          } else if (file.fieldname === 'video') {
            destination = join(
              process.cwd(),
              'uploads',
              'receitas',
              'videos',
            );
          } else if (file.fieldname === 'avatar') {
            destination = join(
              process.cwd(),
              'uploads',
              'avatars',
            );
          } else {
            return callback(
              new BadRequestException('Invalid file field'),
              '',
            );
          }
    
          if (!existsSync(destination)) {
            mkdirSync(destination, { recursive: true });
          }
    
          callback(null, destination);
        },
    
        filename: (_req, file, callback) => {
          const filename = `${randomUUID()}-${Date.now()}-${file.originalname.toLowerCase()}`;
    
          callback(null, filename);
        },
      }),
    }),
  ],
  controllers: [],
  providers: [],
})
export class Multer {}