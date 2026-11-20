/// <reference types="jest" />

import { envValidationSchema } from '../env.validation';

describe('validação do .env: variáveis da IA', () => {
  const minimo = {
    DATABASE_URL: 'postgresql://u:s@localhost:5432/db',
    JWT_SECRET: 'x'.repeat(32),
    SMTP_HOST: 'smtp.teste.local',
    SMTP_USER: 'u',
    SMTP_PASS: 's',
    SMTP_FROM: 'Nutrify <n@teste.local>',
  };
  const validar = (extra: Record<string, string>) =>
    envValidationSchema.validate(
      { ...minimo, ...extra },
      { allowUnknown: true },
    ).error;

  it.each([
    ['sem as variáveis', {}],
    ['com elas em branco', { OPENAI_API_KEY: '', OPENAI_MODEL: '' }],
    ['preenchidas', { OPENAI_API_KEY: 'sk-x', OPENAI_MODEL: 'outro' }],
  ])('a API sobe %s', (_, extra) => {
    expect(validar(extra)).toBeUndefined();
  });
});
