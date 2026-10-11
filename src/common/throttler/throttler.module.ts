import { ExecutionContext, Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';

const METODOS_LEITURA = ['GET', 'HEAD', 'OPTIONS'];

function isLeitura(context: ExecutionContext): boolean {
  const request = context.switchToHttp().getRequest<{ method: string }>();
  return METODOS_LEITURA.includes(request.method);
}

// Limite por tipo de rota (D9). Cada requisição passa por só um dos dois,
// conforme o método. O login sobrescreve o de escrita no próprio controller,
// e o webhook do Mercado Pago deve usar @SkipThrottle().
@Global()
@Module({
  imports: [
    ThrottlerModule.forRoot({
      throttlers: [
        {
          name: 'leitura',
          ttl: 60_000,
          limit: 120,
          skipIf: (context) => !isLeitura(context),
        },
        {
          name: 'escrita',
          ttl: 60_000,
          limit: 30,
          skipIf: isLeitura,
        },
      ],
    }),
  ],
  controllers: [],
  providers: [
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
  ],
})
export class ThrottlerConfigModule {}
