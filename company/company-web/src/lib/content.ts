/** Static marketing copy. Pricing is never hard-coded here — it comes from the API. */

export const MAIN_NAV = [
  { label: 'Home', href: '/' },
  { label: 'Features', href: '/features' },
  { label: 'Templates', href: '/templates' },
  { label: 'Pricing', href: '/pricing' },
  { label: 'How It Works', href: '/how-it-works' },
  { label: 'Security', href: '/security' },
  { label: 'Contact', href: '/contact' },
] as const;

export const FOOTER_NAV = {
  Product: [
    { label: 'Features', href: '/features' },
    { label: 'Templates', href: '/templates' },
    { label: 'Pricing', href: '/pricing' },
    { label: 'How It Works', href: '/how-it-works' },
  ],
  Resources: [
    { label: 'Security', href: '/security' },
    { label: 'FAQ', href: '/faq' },
    { label: 'Contact', href: '/contact' },
  ],
  Company: [
    { label: 'Sign In', href: '/sign-in' },
    { label: 'Start Free Trial', href: '/register' },
    { label: 'Support', href: '/contact' },
  ],
  Legal: [
    { label: 'Terms of Service', href: '/legal/terms' },
    { label: 'Privacy Policy', href: '/legal/privacy' },
    { label: 'Refund Policy', href: '/legal/refund' },
  ],
} as const;

export const HERO_HIGHLIGHTS = [
  'Professional Storefront',
  'Custom Domain',
  'Client Admin Panel',
  'Powerful Features',
  'Dedicated Database',
  'Secure & Reliable',
] as const;

/**
 * Capabilities of the store each client receives. These describe the future
 * Client Platform — the company side only provisions it.
 */
export const FEATURES = [
  {
    icon: 'package',
    title: 'Product Management',
    description: 'Add, organise and manage products, categories, brands and variants with ease.',
  },
  {
    icon: 'shopping-cart',
    title: 'Order Management',
    description: 'Process orders, track fulfilment status and manage returns from one place.',
  },
  {
    icon: 'boxes',
    title: 'Inventory Control',
    description: 'Track stock in real time across variants and never oversell an item again.',
  },
  {
    icon: 'users',
    title: 'Customer Management',
    description: 'Manage customers, groups and communication history from the admin panel.',
  },
  {
    icon: 'credit-card',
    title: 'Payments',
    description: 'Accept payments through the gateways your business already uses.',
  },
  {
    icon: 'truck',
    title: 'Shipping',
    description: 'Configure zones, rates and carriers so checkout quotes the right price.',
  },
  {
    icon: 'rotate-ccw',
    title: 'Returns & Refunds',
    description: 'Handle return requests and issue refunds with a clear approval trail.',
  },
  {
    icon: 'bar-chart-3',
    title: 'Reports & Analytics',
    description: 'Get insight into revenue, best sellers and customer behaviour as you grow.',
  },
  {
    icon: 'palette',
    title: 'Store Customisation',
    description: 'Customise your storefront design, banners and pages to match your brand.',
  },
  {
    icon: 'layout-template',
    title: 'Storefront Templates',
    description: 'Six professional templates and eight colour themes — switch whenever you like.',
  },
  {
    icon: 'globe',
    title: 'Custom Domains',
    description: 'Launch on a free platform subdomain, then connect your own domain when ready.',
  },
  {
    icon: 'database',
    title: 'Dedicated Database',
    description: 'Every store gets its own isolated PostgreSQL database. Your data stays yours.',
  },
  {
    icon: 'shield-check',
    title: 'Secure Admin Panel',
    description: 'Role-aware store admin protected by modern authentication and session security.',
  },
  {
    icon: 'zap',
    title: 'Instant Provisioning',
    description: 'Your store, admin panel and database are created automatically after checkout.',
  },
] as const;

export const HOW_IT_WORKS_SHORT = [
  { step: 1, title: 'Create Account', description: 'Sign up and verify your email address.' },
  { step: 2, title: 'Complete Setup', description: 'Enter your business and store details.' },
  { step: 3, title: 'Set Up Billing', description: 'Choose a plan and settle the bill — a trial bills 0.00.' },
  { step: 4, title: 'Launch Store', description: 'Your store is ready. Start selling online.' },
] as const;

export const HOW_IT_WORKS_FULL = [
  { step: 1, title: 'Create Account', description: 'Register with your name, email and phone number.' },
  { step: 2, title: 'Verify Email', description: 'Confirm your address using the secure link we email you.' },
  { step: 3, title: 'Enter Business Information', description: 'Tell us about your business, country and address.' },
  { step: 4, title: 'Set Up Billing', description: 'Pick the plan that matches your catalogue size and team.' },
  { step: 5, title: 'Pay Your Bill', description: 'A trial is billed 0.00 — the bill is settled either way.' },
  { step: 6, title: 'Choose Store Name', description: 'Name the store your customers will see.' },
  { step: 7, title: 'Choose Subdomain', description: 'Claim your free address, e.g. abc-fashion.company.com.' },
  { step: 8, title: 'Store Created Automatically', description: 'We provision your tenant, database and store config.' },
  { step: 9, title: 'Receive Store Website', description: 'Your storefront goes live on your subdomain.' },
  { step: 10, title: 'Receive Client Admin Access', description: 'Sign in to your admin panel and start selling.' },
] as const;

/**
 * The six storefront templates a store owner chooses from in their own admin
 * panel (Website → Design). Keys are the underscore form the commerce platform
 * stores in `storefront_settings.template_key`.
 */
export const TEMPLATES = [
  {
    code: 'marketplace',
    name: 'Marketplace',
    description: 'Multi-category storefront with rich merchandising blocks.',
    accent: 'from-violet-500/25 to-blue-500/10',
  },
  {
    code: 'modern_shop',
    name: 'Modern Shop',
    description: 'Clean, conversion-focused layout for a general store.',
    accent: 'from-sky-500/25 to-cyan-400/10',
  },
  {
    code: 'fashion_boutique',
    name: 'Fashion Boutique',
    description: 'Editorial layout built for apparel and lifestyle brands.',
    accent: 'from-rose-500/25 to-orange-400/10',
  },
  {
    code: 'minimal_store',
    name: 'Minimal Store',
    description: 'Typography-first design for focused, small catalogues.',
    accent: 'from-slate-500/25 to-slate-300/10',
  },
  {
    code: 'electronics',
    name: 'Electronics',
    description: 'Spec-heavy listings with comparison and filter blocks.',
    accent: 'from-blue-500/25 to-indigo-400/10',
  },
  {
    code: 'lifestyle',
    name: 'Lifestyle',
    description: 'Warm, story-driven layout for lifestyle products.',
    accent: 'from-amber-500/25 to-emerald-400/10',
  },
] as const;

/** The eight colour themes, applied on top of whichever template is chosen. */
export const COLOR_THEMES = [
  { code: 'royal_blue', name: 'Royal Blue', swatch: '#2563EB' },
  { code: 'emerald_green', name: 'Emerald Green', swatch: '#059669' },
  { code: 'luxury_black', name: 'Luxury Black', swatch: '#18181B' },
  { code: 'rose_pink', name: 'Rose Pink', swatch: '#DB2777' },
  { code: 'modern_purple', name: 'Modern Purple', swatch: '#7C3AED' },
  { code: 'sunset_orange', name: 'Sunset Orange', swatch: '#EA580C' },
  { code: 'midnight_navy', name: 'Midnight Navy', swatch: '#172554' },
  { code: 'olive_premium', name: 'Olive Premium', swatch: '#46563C' },
] as const;

/** What a store owner can change on top of the chosen template. */
export const STOREFRONT_CUSTOMISATION = [
  {
    icon: 'palette',
    title: 'Colours and typography',
    description: 'Set your brand colours and type so the storefront looks like yours, not like a template.',
  },
  {
    icon: 'layout-template',
    title: 'Homepage sections',
    description: 'Rearrange hero, featured products, categories, promotions and content blocks.',
  },
  {
    icon: 'package',
    title: 'Product presentation',
    description: 'Choose grid density, image ratios and which attributes appear on listings.',
  },
  {
    icon: 'globe',
    title: 'Pages and navigation',
    description: 'Add your own pages — about, shipping, returns — and control the menu structure.',
  },
] as const;

/**
 * What every store gets, shown where a logo wall usually sits. Deliberately not
 * customer names or brands — inventing those would be fabricated social proof.
 * Replace this strip with real customer logos once you have permission to use them.
 */
export const PLATFORM_GUARANTEES = [
  { icon: 'database', label: 'Dedicated database' },
  { icon: 'globe', label: 'Custom domain' },
  { icon: 'shield-check', label: 'SSL included' },
  { icon: 'zap', label: 'Instant provisioning' },
  { icon: 'rotate-ccw', label: 'Automated backups' },
  { icon: 'bar-chart-3', label: 'Reports & analytics' },
] as const;

export const SECURITY_POINTS = [
  {
    title: 'Isolated tenant databases',
    description:
      'Every store runs on its own PostgreSQL database. No shared tables, no cross-tenant queries, no noisy neighbours.',
  },
  {
    title: 'Encryption in transit',
    description: 'TLS everywhere, HSTS enabled, and SSL certificates issued automatically for your domains.',
  },
  {
    title: 'Modern authentication',
    description:
      'Passwords hashed with Argon2id, HttpOnly session cookies, rate limiting and failed-login tracking on every entry point.',
  },
  {
    title: 'Verified payments only',
    description:
      'Subscriptions activate only after a signature-verified gateway webhook. Card details never touch our servers.',
  },
  {
    title: 'Audit trail',
    description: 'Sensitive platform actions are recorded with actor, IP, timestamp and before/after values.',
  },
  {
    title: 'Regular backups',
    description: 'Automated backups run on a schedule so your catalogue and orders can always be restored.',
  },
] as const;

export const TRUST_BADGES = [
  '99.9% Uptime Guarantee',
  'SSL Security Included',
  'Regular Backups',
  '24/7 Monitoring',
] as const;

export const FAQS = [
  {
    question: 'How does the free trial work?',
    answer:
      'The trial is a plan of its own: 7 days of the premium features, taken once per account. You still complete billing first — the bill simply comes to 0.00 — which authorises a card and is what lets us build your store. The clock starts only once your store has finished provisioning, so you never lose days to setup, and we remind you 3 days and 1 day before it ends. Nothing is charged automatically when it does: your store pauses until you choose a paid plan, and nothing is deleted.',
  },
  {
    question: 'Can I use my own domain?',
    answer:
      'Yes. Every store launches on a free subdomain such as abc-fashion.company.com. When you are ready, add your own domain from the account area, point the DNS records we show you, and we verify and activate it.',
  },
  {
    question: 'Can I change my plan later?',
    answer:
      'You can upgrade at any time and the change applies immediately. Downgrades are checked against your current usage first so you never lose data — if your catalogue exceeds the smaller plan, we tell you before the change.',
  },
  {
    question: 'Is my data secure?',
    answer:
      'Each store has a dedicated PostgreSQL database, so your products, orders and customers are never stored alongside another business. Access is protected with modern authentication, rate limiting and full audit logging.',
  },
  {
    question: 'Do I need technical skills?',
    answer:
      'No. There is no server to configure and no code to write. Register, complete onboarding, and your storefront, admin panel and database are created for you automatically.',
  },
  {
    question: 'What payment methods do you accept?',
    answer:
      'Subscriptions are billed through our payment gateway and support major cards. Your own store can separately accept payments from your customers through the gateways you configure.',
  },
  {
    question: 'What happens when my trial ends?',
    answer:
      'Your store is paused until you subscribe — nothing is deleted. Choose a plan, complete payment, and your storefront and admin panel are reactivated immediately.',
  },
  {
    question: 'Can I cancel at any time?',
    answer:
      'Yes. Cancel from the account area and your subscription stays active until the end of the paid period. We never delete your data automatically when a subscription ends.',
  },
] as const;

/**
 * Non-attributed statements about what the platform does. These are claims we
 * can stand behind, not quotes from customers who do not exist. When you have
 * real, permissioned testimonials, swap this array for them.
 */
export const VALUE_STATEMENTS = [
  {
    title: 'Launch in an afternoon, not a quarter',
    body: 'Register, complete onboarding, and your storefront, admin panel and database are provisioned automatically — there is no server to set up and no code to write.',
  },
  {
    title: 'Your catalogue can grow without a migration',
    body: 'Every store runs on its own PostgreSQL database, so your products and orders are never competing with another business for the same tables.',
  },
  {
    title: 'Your domain, your brand',
    body: 'Start on a free platform subdomain and connect your own domain whenever you are ready. We show you the exact DNS records and verify them for you.',
  },
] as const;

export const COUNTRIES = [
  'Bangladesh', 'India', 'Pakistan', 'United States', 'United Kingdom', 'Canada', 'Australia',
  'United Arab Emirates', 'Saudi Arabia', 'Malaysia', 'Singapore', 'Germany', 'France', 'Netherlands',
  'Spain', 'Italy', 'Turkey', 'Indonesia', 'Philippines', 'Nepal', 'Sri Lanka', 'Other',
] as const;

export const BUSINESS_TYPES = [
  { value: 'sole_proprietor', label: 'Sole Proprietor' },
  { value: 'partnership', label: 'Partnership' },
  { value: 'private_limited', label: 'Private Limited Company' },
  { value: 'public_limited', label: 'Public Limited Company' },
  { value: 'non_profit', label: 'Non-Profit' },
  { value: 'other', label: 'Other' },
] as const;

export const CURRENCIES = [
  { value: 'USD', label: 'USD — US Dollar' },
  { value: 'EUR', label: 'EUR — Euro' },
  { value: 'GBP', label: 'GBP — British Pound' },
  { value: 'BDT', label: 'BDT — Bangladeshi Taka' },
  { value: 'INR', label: 'INR — Indian Rupee' },
  { value: 'AED', label: 'AED — UAE Dirham' },
  { value: 'CAD', label: 'CAD — Canadian Dollar' },
  { value: 'AUD', label: 'AUD — Australian Dollar' },
] as const;

export const LANGUAGES = [
  { value: 'en', label: 'English' },
  { value: 'bn', label: 'Bengali' },
  { value: 'ar', label: 'Arabic' },
  { value: 'es', label: 'Spanish' },
  { value: 'fr', label: 'French' },
  { value: 'de', label: 'German' },
  { value: 'hi', label: 'Hindi' },
] as const;

export const TIMEZONES = [
  'Asia/Dhaka', 'Asia/Kolkata', 'Asia/Karachi', 'Asia/Dubai', 'Asia/Singapore', 'Asia/Kuala_Lumpur',
  'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Europe/Madrid', 'Europe/Istanbul',
  'America/New_York', 'America/Chicago', 'America/Denver', 'America/Los_Angeles', 'America/Toronto',
  'Australia/Sydney', 'UTC',
] as const;
