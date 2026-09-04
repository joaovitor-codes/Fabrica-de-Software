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
import { RestricaoAlimentarModule } from './restricao-alimentar/restricao-alimentar.module';

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
    ReceitaModule,
    ProfissionalModule,
    IngredienteModule,
    UnidadeMedidaModule,
    ClinicasModule,
    PrismaModule,
    EnderecoModule,
    TelefoneModule,
    RestricaoAlimentarModule,
  ],
  controllers: [],
  providers: [PrismaService],
})
export class AppModule {}
