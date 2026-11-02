/// <reference types="jest" />

import { createHmac } from 'crypto';
import { assinaturaValida, DadosAssinatura } from '../assinatura-webhook';

const SEGREDO = 'segredo-do-painel';
const TS = '1762099200';
const REQUEST_ID = 'req-123';
const DATA_ID = '123456789';

function assinar(manifesto: string, segredo = SEGREDO) {
  return createHmac('sha256', segredo).update(manifesto).digest('hex');
}

function dados(sobrescrever: Partial<DadosAssinatura> = {}): DadosAssinatura {
  const v1 = assinar(`id:${DATA_ID};request-id:${REQUEST_ID};ts:${TS};`);
  return {
    xSignature: `ts=${TS},v1=${v1}`,
    xRequestId: REQUEST_ID,
    dataId: DATA_ID,
    segredo: SEGREDO,
    ...sobrescrever,
  };
}

describe('assinaturaValida', () => {
  it('aceita a assinatura feita com o segredo', () => {
    expect(assinaturaValida(dados())).toBe(true);
  });

  it('aceita espaços depois da vírgula no cabeçalho', () => {
    const v1 = assinar(`id:${DATA_ID};request-id:${REQUEST_ID};ts:${TS};`);
    expect(assinaturaValida(dados({ xSignature: `ts=${TS}, v1=${v1}` }))).toBe(
      true,
    );
  });

  it('usa o data.id em minúsculas no manifesto', () => {
    const v1 = assinar(`id:abc123;request-id:${REQUEST_ID};ts:${TS};`);
    expect(
      assinaturaValida(
        dados({ dataId: 'ABC123', xSignature: `ts=${TS},v1=${v1}` }),
      ),
    ).toBe(true);
  });

  it('recusa assinatura feita com outro segredo', () => {
    expect(assinaturaValida(dados({ segredo: 'outro' }))).toBe(false);
  });

  it('recusa quando o ts foi trocado', () => {
    const { xSignature } = dados();
    expect(
      assinaturaValida(
        dados({ xSignature: xSignature!.replace(TS, '1762099999') }),
      ),
    ).toBe(false);
  });

  it('recusa quando o data.id não é o assinado', () => {
    expect(assinaturaValida(dados({ dataId: '987654321' }))).toBe(false);
  });

  it('recusa quando o x-request-id não é o assinado', () => {
    expect(assinaturaValida(dados({ xRequestId: 'outro' }))).toBe(false);
  });

  it.each([
    ['sem x-signature', { xSignature: undefined }],
    ['sem x-request-id', { xRequestId: undefined }],
    ['sem data.id', { dataId: undefined }],
    ['sem segredo configurado', { segredo: undefined }],
    ['x-signature sem v1', { xSignature: `ts=${TS}` }],
    ['x-signature sem ts', { xSignature: `v1=${'a'.repeat(64)}` }],
    ['v1 que não é hex de 64', { xSignature: `ts=${TS},v1=abc` }],
  ])('recusa %s', (_caso, sobrescrever) => {
    expect(assinaturaValida(dados(sobrescrever))).toBe(false);
  });
});
