import { BadRequestException, Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { PrismaService } from './prisma/prisma.service';
import { envValidationSchema } from './config/env.validation';
import { ConfigModule } from '@nestjs/config';
import { UsuarioModule } from './usuario/usuario.module';
import { PacientesModule } from './pacientes/pacientes.module';
import { ReceitaModule } from './receita/receita.module';
import { ProfissionalModule } from './profissional/profissional.module';
import { IngredienteModule } from './ingrediente/ingrediente.module';
import { UnidadeMedidaModule } from './unidade-medida/unidade-medida.module';
import { ClinicasModule } from './clinicas/clinicas.module';
import { PrismaModule } from './prisma/prisma.module';
import { EnderecoModule } from './endereco/endereco.module';
import { TelefoneModule } from './telefone/telefone.module';
import { MailerModuleEmail } from './lib/mailer.module';
import { RestricaoAlimentarModule } from './restricao-alimentar/restricao-alimentar.module';
import { PacienteRestricaoModule } from './paciente-restricao/paciente-restricao.module';
import { IngredienteRestricaoModule } from './ingrediente-restricao/ingrediente-restricao.module';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { APP_GUARD } from '@nestjs/core';
import { MulterModule } from '@nestjs/platform-express';
import { diskStorage } from 'multer';
import { randomUUID } from 'crypto';
import { join } from 'path';
import { existsSync, mkdirSync } from 'fs';

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
    ThrottlerModule.forRoot({
      throttlers: [{
        name: 'default',
        ttl: 60_000,
        limit: 10,
      }]
    }),
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
    ReceitaModule,
    ProfissionalModule,
    IngredienteModule,
    UnidadeMedidaModule,
    ClinicasModule,
    PrismaModule,
    EnderecoModule,
    TelefoneModule,
    MailerModuleEmail,
    RestricaoAlimentarModule,
    PacienteRestricaoModule,
    IngredienteRestricaoModule,
  ],
  controllers: [],
  providers: [PrismaService, {
    provide: APP_GUARD,
    useClass: ThrottlerGuard,
  }],
})
export class AppModule {}
