import { createHmac, timingSafeEqual } from 'crypto';

export interface DadosAssinatura {
  /** Cabeçalho x-signature: "ts=<timestamp>,v1=<hmac hex>". */
  xSignature?: string;
  /** Cabeçalho x-request-id. */
  xRequestId?: string;
  /** `data.id` da query string da notificação. */
  dataId?: string;
  /** MP_WEBHOOK_SECRET: a assinatura secreta do painel de Webhooks. */
  segredo?: string;
}

/**
 * Confere a assinatura de um aviso do Mercado Pago. O HMAC-SHA256 é feito
 * sobre "id:<data.id>;request-id:<x-request-id>;ts:<ts>;", com o data.id em
 * minúsculas. Qualquer peça faltando (inclusive o segredo) recusa o aviso.
 */
export function assinaturaValida({
  xSignature,
  xRequestId,
  dataId,
  segredo,
}: DadosAssinatura): boolean {
  if (!xSignature || !xRequestId || !dataId || !segredo) return false;

  const partes = new Map(
    xSignature.split(',').map((parte) => {
      const [chave, ...valor] = parte.split('=');
      return [chave.trim(), valor.join('=').trim()] as const;
    }),
  );
  const ts = partes.get('ts');
  const v1 = partes.get('v1');
  if (!ts || !v1 || !/^[0-9a-f]{64}$/i.test(v1)) return false;

  const manifesto = `id:${dataId.toLowerCase()};request-id:${xRequestId};ts:${ts};`;
  const esperado = createHmac('sha256', segredo).update(manifesto).digest();

  return timingSafeEqual(esperado, Buffer.from(v1, 'hex'));
}
