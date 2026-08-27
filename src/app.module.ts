import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { PrismaService } from './prisma/prisma.service';
import { envValidationSchema } from './config/env.validation';
import { ConfigModule } from '@nestjs/config';
import { UsuarioModule } from './usuario/usuario.module';
import { PacientesModule } from './pacientes/pacientes.module';

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
    UsuarioModule,
    PacientesModule,
  ],
  controllers: [],
  providers: [PrismaService],
})
export class AppModule {}
