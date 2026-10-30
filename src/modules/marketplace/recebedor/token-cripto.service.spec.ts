/// <reference types="jest" />

import { ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { TokenCriptoService } from './token-cripto.service';

function criarService(chave?: string) {
  return new TokenCriptoService({
    get: () => chave,
  } as unknown as ConfigService);
}

describe('TokenCriptoService', () => {
  const service = criarService('chave_de_teste_com_mais_de_32_caracteres');

  it('decifra o que cifrou', () => {
    const cifrado = service.cifrar('APP_USR-token-do-vendedor');

    expect(service.decifrar(cifrado)).toBe('APP_USR-token-do-vendedor');
  });

  it('não grava o token em claro e muda a cada cifragem', () => {
    const a = service.cifrar('segredo');
    const b = service.cifrar('segredo');

    expect(a).not.toContain('segredo');
    expect(a).not.toBe(b);
    expect(a.startsWith('v1:')).toBe(true);
  });

  it('recusa conteúdo adulterado', () => {
    const [versao, iv, tag, conteudo] = service.cifrar('segredo').split(':');
    const adulterado = [versao, iv, tag, conteudo.slice(0, -2) + 'AA'].join(
      ':',
    );

    expect(() => service.decifrar(adulterado)).toThrow();
  });

  it('não decifra com outra chave', () => {
    const cifrado = service.cifrar('segredo');
    const outra = criarService('outra_chave_com_mais_de_32_caracteres__');

    expect(() => outra.decifrar(cifrado)).toThrow();
  });

  it('responde 503 sem RECEBEDOR_TOKEN_KEY', () => {
    expect(() => criarService(undefined).cifrar('x')).toThrow(
      ServiceUnavailableException,
    );
  });
});
