import * as Joi from 'joi';

// O Mercado Pago aceita criar a preferência com um notification_url que ele
// não alcança, mas recusa o pagamento no checkout, sem dizer o motivo. Por
// isso a API não sobe com um endereço que não seja HTTPS e público, só domínio.
const urlPublicaHttps = Joi.string()
  .uri({ scheme: ['https'] })
  .custom((valor: string, helpers) => {
    const url = new URL(valor);
    const soDominio = url.pathname === '/' && !valor.endsWith('/');
    return url.hostname.includes('.') && soDominio
      ? valor
      : helpers.error('any.invalid');
  })
  .messages({
    'any.invalid':
      '{{#label}} precisa ser só o domínio HTTPS público, sem barra no final (ex.: https://abc.ngrok-free.dev)',
  });

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string()
    .valid('development', 'production', 'test')
    .default('development'),
  PORT: Joi.number().default(3000),
  REDIS_URL: Joi.string()
    .uri({ scheme: ['redis', 'rediss'] })
    .default('redis://localhost:6379'),
  DATABASE_URL: Joi.string().required(),
  JWT_SECRET: Joi.string().min(32).required(),
  JWT_EXPIRES_IN: Joi.string().default('1h'),
  JWT_REFRESH_EXPIRES_IN: Joi.string().default('7d'),
  LOGIN_MAX_FAILED_ATTEMPTS: Joi.number().integer().min(1).default(5),
  LOGIN_LOCKOUT_MINUTES: Joi.number().integer().min(1).default(15),
  EMAIL_VERIFICATION_CODE_EXPIRES_MINUTES: Joi.number()
    .integer()
    .min(1)
    .default(15),
  EMAIL_VERIFICATION_MAX_RESEND_ATTEMPTS: Joi.number()
    .integer()
    .min(1)
    .default(3),
  EMAIL_VERIFICATION_RESEND_WINDOW_MINUTES: Joi.number()
    .integer()
    .min(1)
    .default(15),
  SMTP_HOST: Joi.string().required(),
  SMTP_PORT: Joi.number().default(587),
  SMTP_SECURE: Joi.boolean().default(false),
  SMTP_USER: Joi.string().required(),
  SMTP_PASS: Joi.string().required(),
  SMTP_FROM: Joi.string().required(),
  MP_CLIENT_ID: Joi.string().optional(),
  MP_CLIENT_SECRET: Joi.string().optional(),
  MP_REDIRECT_URI: Joi.string().uri().optional(),
  MP_WEBHOOK_SECRET: Joi.string().optional(),
  RECEBEDOR_TOKEN_KEY: Joi.string().min(32).optional(),
  API_URL_PUBLICA: urlPublicaHttps.optional(),
  FRONT_URL: Joi.string().uri().optional(),
  MARKETPLACE_TAXA_PERCENTUAL: Joi.number().min(0).max(100).default(15),
  MARKETPLACE_PRECO_MINIMO: Joi.number().min(0).default(10),
  MARKETPLACE_REEMBOLSO_DIAS: Joi.number().integer().min(0).default(7),
  MARKETPLACE_TERMOS_VERSAO: Joi.string().default('1.0'),

  OPENAI_API_KEY: Joi.string().optional(),
});
