import { Module } from '@nestjs/common';
import { AuthModule } from './auth/auth.module';
import { PrismaService } from './common/prisma/prisma.service';
import { envValidationSchema } from './common/config/env.validation';
import { ConfigModule } from '@nestjs/config';
import { UsuarioModule } from './modules/identidade/usuario/usuario.module';
import { PacientesModule } from './modules/identidade/pacientes/pacientes.module';
import { ReceitaModule } from './modules/receitas/receita/receita.module';
import { ProfissionalModule } from './modules/identidade/profissional/profissional.module';
import { IngredienteModule } from './modules/nutricao/ingrediente/ingrediente.module';
import { UnidadeMedidaModule } from './modules/nutricao/unidade-medida/unidade-medida.module';
import { ClinicasModule } from './modules/identidade/clinicas/clinicas.module';
import { PrismaModule } from './common/prisma/prisma.module';
import { EnderecoModule } from './modules/identidade/endereco/endereco.module';
import { TelefoneModule } from './modules/identidade/telefone/telefone.module';
import { MailerConfigModule } from './common/mailer/mailer.module';
import { RestricaoAlimentarModule } from './modules/nutricao/restricao-alimentar/restricao-alimentar.module';
import { PacienteRestricaoModule } from './modules/nutricao/paciente-restricao/paciente-restricao.module';
import { IngredienteRestricaoModule } from './modules/nutricao/ingrediente-restricao/ingrediente-restricao.module';
import { CacheModule } from './common/cache/cache.module';
import { MulterConfigModule } from './common/multer/multer.module';
import { ThrottlerConfigModule } from './common/throttler/throttler.module';
import { IaModule } from './modules/ia/ia.module';
import { AnamneseModule } from './modules/acompanhamento/anamnese/anamnese.module';
import { TagSintomasModule } from './modules/acompanhamento/tag-sintomas/tag-sintomas.module';
import { PlanoAlimentarModule } from './modules/acompanhamento/plano-alimentar/plano-alimentar.module';
import { DiarioDeSintomasModule } from './modules/acompanhamento/diario-de-sintomas/diario-de-sintomas.module';
import { PontosTransacaoModule } from './modules/receitas/pontos-transacao/pontos-transacao.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      validationSchema: envValidationSchema,
      validationOptions: {
        abortEarly: false,
      },
    }),
    ThrottlerConfigModule,
    MulterConfigModule,
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
    MailerConfigModule,
    RestricaoAlimentarModule,
    PacienteRestricaoModule,
    IngredienteRestricaoModule,
    IaModule,
    AnamneseModule,
    TagSintomasModule,
    PlanoAlimentarModule,
    DiarioDeSintomasModule,
    PontosTransacaoModule,
  ],
  controllers: [],
  providers: [PrismaService],
})
export class AppModule {}
