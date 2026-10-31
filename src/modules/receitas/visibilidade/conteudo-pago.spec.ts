/// <reference types="jest" />

import { StatusReceita, TipoUsuario } from '@prisma/client';
import { podeAdaptarPaga, veConteudoPago } from './conteudo-pago';

describe('acesso ao conteúdo de receita paga', () => {
  const autor = { id: 'autor', tipoUsuario: TipoUsuario.comum };
  const outro = { id: 'outro', tipoUsuario: TipoUsuario.paciente };
  const admin = { id: 'admin', tipoUsuario: TipoUsuario.admin };
  const nutri = { id: 'nutri', tipoUsuario: TipoUsuario.profissional };

  const aprovada = { criadoPor: autor.id, status: StatusReceita.aprovada };
  const pendente = { criadoPor: autor.id, status: StatusReceita.pendente };

  it.each([
    ['visitante', undefined, aprovada, false],
    ['outro usuário', outro, aprovada, false],
    ['autor', autor, aprovada, true],
    ['admin', admin, aprovada, true],
    ['profissional com a receita aprovada', nutri, aprovada, false],
    ['profissional com a receita na curadoria', nutri, pendente, true],
  ])('veConteudoPago: %s → %p', (_quem, usuario, receita, esperado) => {
    expect(veConteudoPago(receita, usuario)).toBe(esperado);
  });

  it.each([
    ['outro usuário', outro, false],
    ['autor', autor, true],
    ['admin', admin, true],
    // O curador vê para revisar, mas não adapta para paciente.
    ['profissional, mesmo na curadoria', nutri, false],
  ])('podeAdaptarPaga: %s → %p', (_quem, usuario, esperado) => {
    expect(podeAdaptarPaga(pendente, usuario)).toBe(esperado);
  });
});
