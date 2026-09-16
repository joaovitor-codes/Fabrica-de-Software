import { Module } from '@nestjs/common';
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
import { CacheModule } from './cache/cache.module';
import { Multer } from './multer/multer.module';
import { ThrottlerModul } from './throttler/throttler.module';
import { IaModule } from './ia/ia.module';
import { AnamneseModule } from './anamnese/anamnese.module';
import { TagSintomasModule } from './tag-sintomas/tag-sintomas.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false, 
      },
    }),
    ThrottlerModul,
    Multer,
    CacheModule,
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
    IaModule,
    AnamneseModule,
    TagSintomasModule,
  ],
  controllers: [],
  providers: [PrismaService],
})
export class AppModule {}
