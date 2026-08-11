import { z } from 'zod';

/**
 * Client-side form rules. These mirror the API's Zod schemas so users get
 * instant feedback — the server still re-validates everything.
 */

export const RESERVED_SUBDOMAINS = [
  'admin', 'api', 'app', 'www', 'support', 'billing', 'system', 'company', 'security',
  'mail', 'smtp', 'ftp', 'cdn', 'static', 'assets', 'status', 'dashboard', 'account',
  'accounts', 'login', 'signup', 'register', 'help', 'docs', 'blog', 'store', 'shop',
  'checkout', 'payment', 'payments', 'webhook', 'webhooks', 'internal', 'staging',
  'test', 'dev', 'demo', 'root',
] as const;

export const emailSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(5, 'Enter a valid email address.')
  .max(254, 'Email address is too long.')
  .email('Enter a valid email address.');

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters.')
  .max(200, 'Password is too long.')
  .refine((v) => /[a-z]/.test(v), 'Include at least one lowercase letter.')
  .refine((v) => /[A-Z]/.test(v), 'Include at least one uppercase letter.')
  .refine((v) => /\d/.test(v), 'Include at least one number.')
  .refine((v) => /[^A-Za-z0-9]/.test(v), 'Include at least one symbol.');

export const phoneSchema = z
  .string()
  .trim()
  .min(6, 'Enter a valid phone number.')
  .max(24, 'Enter a valid phone number.')
  .regex(/^\+?[0-9][0-9\s().-]{5,23}$/, 'Enter a valid phone number.');

export const subdomainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(3, 'Use at least 3 characters.')
  .max(40, 'Use at most 40 characters.')
  .regex(/^[a-z0-9-]+$/, 'Only lowercase letters, numbers and hyphens.')
  .refine((v) => !v.startsWith('-') && !v.endsWith('-'), 'Cannot start or end with a hyphen.')
  .refine((v) => !v.includes('--'), 'Cannot contain two hyphens in a row.')
  .refine((v) => !/^\d+$/.test(v), 'Cannot be only numbers.')
  .refine((v) => !(RESERVED_SUBDOMAINS as readonly string[]).includes(v), 'This name is reserved by the platform.');

export const domainSchema = z
  .string()
  .trim()
  .toLowerCase()
  .transform((v) => v.replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, ''))
  .refine(
    (v) => /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))+$/.test(v),
    'Enter a valid domain, for example abcfashion.com',
  );

export const registerSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Enter your full name.').max(120, 'Too long.'),
    email: emailSchema,
    phone: phoneSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    // boolean (not z.literal) so the form can start unchecked and still type-check
    acceptTerms: z.boolean().refine((v) => v === true, 'You must accept the terms to continue.'),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password.'),
  remember: z.boolean().default(false),
});

export const forgotPasswordSchema = z.object({ email: emailSchema });

export const resetPasswordSchema = z
  .object({
    token: z.string().min(1),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

/**
 * Invoice details. Only the name is required — signup asks for that and nothing
 * else, and the rest is filled in from the billing page when it is needed.
 */
export const businessInfoSchema = z.object({
  businessName: z.string().trim().min(2, 'Enter your business name.').max(160, 'Too long.'),
  ownerName: z.string().trim().min(2, 'Enter the owner name.').max(120, 'Too long.'),
  businessEmail: emailSchema,
  businessPhone: z.union([phoneSchema, z.literal('')]).optional(),
  country: z.string().trim().max(60).optional(),
  address: z.string().trim().max(300, 'Too long.').optional(),
  businessType: z
    .enum(['sole_proprietor', 'partnership', 'private_limited', 'public_limited', 'non_profit', 'other'])
    .or(z.literal(''))
    .optional(),
});

/**
 * Website setup — what customers see. Everything else about the storefront is
 * configured inside the store's own admin panel.
 */
export const websiteSetupSchema = z
  .object({
    businessName: z.string().trim().min(2, 'Enter your business name.').max(160, 'Too long.'),
    slug: subdomainSchema,
    domainMode: z.enum(['platform', 'custom']),
    customDomain: z.string().trim().optional(),
  })
  .refine((data) => data.domainMode === 'platform' || domainSchema.safeParse(data.customDomain ?? '').success, {
    message: 'Enter a valid domain, for example abcfashion.com',
    path: ['customDomain'],
  });

/** Admin panel setup — its address, and the login that opens it. */
export const adminPanelSetupSchema = z
  .object({
    domainMode: z.enum(['platform', 'custom']),
    customDomain: z.string().trim().optional(),
    adminEmail: emailSchema,
    adminPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.adminPassword === data.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  })
  .refine((data) => data.domainMode === 'platform' || domainSchema.safeParse(data.customDomain ?? '').success, {
    message: 'Enter a valid domain, for example admin.abcfashion.com',
    path: ['customDomain'],
  });

/**
 * Resetting the store admin panel's password from the dashboard. The passcode
 * travels with the new password — the API refuses one without the other, so a
 * dashboard session on its own cannot change the panel's login.
 */
export const adminPasswordResetSchema = z
  .object({
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export const planSelectionSchema = z.object({
  planId: z.string().uuid('Choose a plan to continue.'),
  billingCycle: z.enum(['monthly', 'yearly']),
  startTrial: z.boolean().default(true),
});

export const profileSchema = z.object({
  fullName: z.string().trim().min(2, 'Enter your full name.').max(120, 'Too long.'),
  phone: phoneSchema,
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password.'),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    message: 'Passwords do not match.',
    path: ['confirmPassword'],
  });

export const addDomainSchema = z.object({
  domain: domainSchema,
  domainType: z.enum(['storefront_custom', 'admin_custom']),
});

export const supportTicketSchema = z.object({
  subject: z.string().trim().min(4, 'Enter a subject.').max(160, 'Too long.'),
  priority: z.enum(['low', 'normal', 'high', 'urgent']),
  message: z.string().trim().min(10, 'Describe the issue in a little more detail.').max(5000, 'Too long.'),
});

export const supportReplySchema = z.object({
  message: z.string().trim().min(1, 'Write a reply.').max(5000, 'Too long.'),
});

export const contactSchema = z.object({
  name: z.string().trim().min(2, 'Enter your name.').max(120),
  email: emailSchema,
  company: z.string().trim().max(160).optional(),
  message: z.string().trim().min(10, 'Tell us a little more.').max(2000, 'Too long.'),
});

export type RegisterInput = z.input<typeof registerSchema>;
export type LoginInput = z.input<typeof loginSchema>;
export type BusinessInfoInput = z.input<typeof businessInfoSchema>;
export type WebsiteSetupInput = z.input<typeof websiteSetupSchema>;
export type AdminPanelSetupInput = z.input<typeof adminPanelSetupSchema>;
export type AdminPasswordResetInput = z.input<typeof adminPasswordResetSchema>;
export type PlanSelectionInput = z.input<typeof planSelectionSchema>;
export type AddDomainInput = z.input<typeof addDomainSchema>;
export type SupportTicketInput = z.input<typeof supportTicketSchema>;
