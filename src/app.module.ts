import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { PrismaService } from './prisma/prisma.service';
import { envValidationSchema } from './config/env.validation';
import { ConfigModule } from '@nestjs/config';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false, 
      },
    }),
    AuthModule,
  ],
  controllers: [],
  providers: [PrismaService],
})
export class AppModule {}
