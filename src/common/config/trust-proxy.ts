import { NestExpressApplication } from '@nestjs/platform-express';

/**
 * Quantos proxies à frente da API o Express deve considerar ao ler o IP do
 * cliente no `X-Forwarded-For` (`TRUST_PROXY`). Sem isso, atrás de um proxy
 * (ngrok, Render, Nginx...) toda requisição chega com o IP do proxy e o
 * throttler, que limita por IP, junta todos os usuários num limite só.
 *
 * É um número de saltos, nunca `true`: com `true` o Express confia em
 * qualquer `X-Forwarded-For`, e o cliente escapa do limite forjando o IP.
 * Com 0 (padrão), o cabeçalho é ignorado.
 */
export function configurarTrustProxy(
  app: NestExpressApplication,
  saltos: number,
): void {
  app.set('trust proxy', saltos);
}
