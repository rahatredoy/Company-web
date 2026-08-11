import type { CmsPage, Faq } from '@/types';
import type { ContactInput } from '../content';

/**
 * Editorial fixtures: policy pages, the about page, and the FAQ.
 *
 * `bodyHtml` is written here as the API is expected to deliver it — already
 * sanitised, a small closed set of tags, no attributes beyond `href`. The page
 * renderer sanitises again on the way out; this file is what proves that pass
 * does not mangle legitimate content.
 */

const UPDATED = '2026-06-01T00:00:00.000Z';

function page(
  slug: string,
  title: string,
  excerpt: string,
  bodyHtml: string,
): CmsPage {
  return {
    slug,
    title,
    excerpt,
    bodyHtml,
    updatedAt: UPDATED,
    seo: { title: `${title}`, description: excerpt },
  };
}

const PAGES: CmsPage[] = [
  page(
    'about',
    'About Us',
    'Who we are, what we sell, and why we started.',
    `<p>We started in a single room in Dhaka with a simple frustration: buying good things online meant either paying import prices or gambling on a listing with three blurry photographs and no returns policy.</p>
<p>So we built the shop we wanted to buy from. Every product is chosen by a person, photographed properly, and priced without the theatre of a permanent fake discount.</p>
<h2>What we care about</h2>
<ul>
<li><strong>Honest pricing.</strong> A sale is a sale. When something is not on offer, we do not invent a crossed-out number to make it look like one.</li>
<li><strong>Returns that work.</strong> Thirty days, no interrogation. If it is not right, send it back.</li>
<li><strong>Real stock.</strong> If the site says it is in stock, it is on a shelf we can see.</li>
</ul>
<h2>Where we are going</h2>
<p>More categories, more local makers, and same-day delivery beyond the capital. If there is something you want us to carry, tell us — a surprising amount of what we stock started as a customer email.</p>`,
  ),
  page(
    'shipping-policy',
    'Shipping Policy',
    'Delivery zones, charges, and how long orders take.',
    `<h2>Delivery zones</h2>
<p>We deliver nationwide. Dhaka city orders are handled by our own riders; everywhere else goes through our courier partners.</p>
<h2>Charges</h2>
<ul>
<li>Inside Dhaka — ৳60, delivered in 1–2 working days.</li>
<li>Outside Dhaka — ৳120, delivered in 2–5 working days.</li>
<li>Orders over ৳2,000 ship free, anywhere in the country.</li>
</ul>
<h2>Processing</h2>
<p>Orders placed before 4pm are packed the same working day. Orders placed on a Friday or a public holiday are packed on the next working day.</p>
<h2>Tracking</h2>
<p>You will receive a tracking number by email and SMS as soon as your parcel leaves our warehouse. You can also follow it from your account.</p>
<h2>If something goes wrong</h2>
<p>If a parcel has not moved for three working days, contact us and we will chase the courier ourselves rather than asking you to.</p>`,
  ),
  page(
    'return-policy',
    'Returns &amp; Refunds',
    'How to return an item, what qualifies, and when the money comes back.',
    `<h2>The window</h2>
<p>You have <strong>30 days</strong> from delivery to start a return. That is 30 days from the day the parcel arrived, not the day you ordered.</p>
<h2>What we can take back</h2>
<p>Anything unworn, unwashed and in its original packaging with the tags still attached.</p>
<h2>What we cannot take back</h2>
<ul>
<li>Underwear, swimwear and pierced jewellery, for hygiene reasons.</li>
<li>Cosmetics and skincare once the seal is broken.</li>
<li>Anything made or engraved to your order.</li>
<li>Gift cards.</li>
</ul>
<h2>How to start one</h2>
<p>Open the order in your account and choose <strong>Request a return</strong>. Pick the items, tell us why, and add a photograph if the item arrived damaged. We approve most requests within one working day.</p>
<h2>Getting your money back</h2>
<p>Refunds are issued to the original payment method within 5–7 working days of the item reaching our warehouse and passing inspection. Cash-on-delivery orders are refunded by mobile banking or bank transfer.</p>
<h2>Who pays return postage</h2>
<p>We do, if the item was faulty, damaged, or not what you ordered. If you simply changed your mind, return postage is ৳100 and is deducted from the refund.</p>`,
  ),
  page(
    'refund-policy',
    'Refund Policy',
    'Refund methods, timings and partial refunds.',
    `<h2>When a refund is issued</h2>
<p>Once a returned item reaches our warehouse and passes inspection, or immediately if we cancelled the order ourselves.</p>
<h2>How long it takes</h2>
<ul>
<li>Card payments — 5–7 working days, depending on your bank.</li>
<li>bKash and Nagad — 1–3 working days.</li>
<li>Cash on delivery — 3–5 working days by mobile banking or bank transfer.</li>
</ul>
<h2>Partial refunds</h2>
<p>If you return part of an order, we refund the returned items at the price you actually paid for them. Where a discount applied to the whole order, the discount is apportioned rather than lost.</p>
<h2>Shipping charges</h2>
<p>The original delivery charge is refunded only when the whole order goes back, or when the return was our fault.</p>`,
  ),
  page(
    'privacy',
    'Privacy Policy',
    'What we collect, why, and what we never do with it.',
    `<h2>What we collect</h2>
<p>Your name, email, phone number and delivery address, because we cannot deliver a parcel without them. Your order history, because you need it and so do we. Basic analytics about which pages are visited.</p>
<h2>What we do not collect</h2>
<p>We never see or store your full card number. Payments go directly to our payment provider and we receive only the last four digits and a token.</p>
<h2>Why we hold it</h2>
<ul>
<li>To fulfil your orders and handle returns.</li>
<li>To answer you when you contact support.</li>
<li>To send marketing email — only if you asked for it, and every message has an unsubscribe link that genuinely works.</li>
</ul>
<h2>Who else sees it</h2>
<p>Our courier gets your name, address and phone number, because that is a delivery. Our payment provider gets what it needs to take a payment. Nobody else. We do not sell customer data.</p>
<h2>Your rights</h2>
<p>You can ask for a copy of everything we hold about you, ask us to correct it, or ask us to delete your account. Email us and we will action it within 30 days.</p>
<h2>Cookies</h2>
<p>We use cookies to keep you signed in and to remember your basket. Analytics cookies are optional and you can decline them without losing any part of the shop.</p>`,
  ),
  page(
    'terms',
    'Terms &amp; Conditions',
    'The agreement between you and this store.',
    `<h2>Placing an order</h2>
<p>An order is an offer to buy. The contract is formed when we send the dispatch confirmation, not when you click Place Order — which is also why we can cancel and refund an order if an item turns out to be genuinely unavailable.</p>
<h2>Pricing</h2>
<p>Prices include VAT where applicable and exclude delivery unless stated. If an item is listed at an obviously wrong price — a decimal point in the wrong place — we will contact you rather than silently ship or silently cancel.</p>
<h2>Your account</h2>
<p>Keep your password to yourself. You are responsible for what happens under your account, so tell us straight away if you think someone else has access to it.</p>
<h2>Acceptable use</h2>
<p>Do not scrape the site, do not attempt to break it, and do not use it to resell at volume without talking to us first.</p>
<h2>Liability</h2>
<p>We are responsible for the goods we sell you and for delivering them. We are not responsible for losses that were not reasonably foreseeable. Nothing here limits your statutory rights as a consumer.</p>
<h2>Changes</h2>
<p>We may update these terms. The version that applies to your order is the one published on the day you ordered.</p>`,
  ),
];

const FAQS: Faq[] = [
  { id: 'f-1', category: 'Orders', question: 'How do I place an order?', answer: 'Add the items you want to your basket, open the basket and choose Proceed to Checkout. You can check out as a guest — an account is optional, though it does make tracking and returns easier.' },
  { id: 'f-2', category: 'Orders', question: 'Can I change my order after placing it?', answer: 'Yes, until it has been packed. Open the order in your account: if the status is still Pending or Confirmed you can cancel it and reorder. Once it says Packed the parcel is sealed and you would need to use the returns process instead.' },
  { id: 'f-3', category: 'Orders', question: 'Can I cancel an order?', answer: 'You can cancel any order that has not yet shipped, from the order page in your account. Refunds for cancelled prepaid orders start the same day.' },
  { id: 'f-4', category: 'Orders', question: 'I did not get an order confirmation email.', answer: 'Check the spam folder first — confirmation emails often land there on the first order. If it is not there, the address may have a typo in it. Contact us with your phone number and we will find the order.' },
  { id: 'f-5', category: 'Payments', question: 'Which payment methods can I use?', answer: 'Cash on delivery, bKash, Nagad, and any Visa or Mastercard credit or debit card. Only the methods this store has switched on appear at checkout.' },
  { id: 'f-6', category: 'Payments', question: 'Is it safe to pay by card?', answer: 'Yes. Card details are entered on the payment provider’s own page and never touch our servers. We receive a token and the last four digits, which is all we need to issue a refund later.' },
  { id: 'f-7', category: 'Payments', question: 'My payment failed but money left my account.', answer: 'That is almost always a hold rather than a charge, and banks release it automatically within 5–7 working days. If it has not cleared by then, send us the transaction reference and we will chase it.' },
  { id: 'f-8', category: 'Payments', question: 'Do you offer instalments?', answer: 'Not yet. Card instalment plans offered by your own bank still work normally, since we take a single payment.' },
  { id: 'f-9', category: 'Shipping', question: 'How long will delivery take?', answer: 'One to two working days inside Dhaka, two to five elsewhere in the country. Orders placed before 4pm are packed the same working day.' },
  { id: 'f-10', category: 'Shipping', question: 'How much is delivery?', answer: '৳60 inside Dhaka and ৳120 elsewhere. Orders over ৳2,000 ship free anywhere in the country.' },
  { id: 'f-11', category: 'Shipping', question: 'Do you deliver outside Bangladesh?', answer: 'Not at the moment. We are working on it — join the newsletter if you would like to hear when that changes.' },
  { id: 'f-12', category: 'Shipping', question: 'How do I track my parcel?', answer: 'Every order gets a tracking number by email and SMS when it leaves our warehouse. You can also open the order in your account, or use the Track Order page if you checked out as a guest.' },
  { id: 'f-13', category: 'Returns', question: 'What is your returns window?', answer: 'Thirty days from the day the parcel arrived. Items need to be unworn, unwashed and in their original packaging with tags attached.' },
  { id: 'f-14', category: 'Returns', question: 'How do I return something?', answer: 'Open the order in your account and choose Request a return. Pick the items, tell us why, and attach a photograph if it arrived damaged. Most requests are approved within one working day.' },
  { id: 'f-15', category: 'Returns', question: 'What cannot be returned?', answer: 'Underwear, swimwear and pierced jewellery for hygiene reasons; opened cosmetics; anything personalised; and gift cards.' },
  { id: 'f-16', category: 'Returns', question: 'When do I get my refund?', answer: 'Within 5–7 working days of the item reaching us and passing inspection. Cash-on-delivery orders are refunded by mobile banking or bank transfer.' },
  { id: 'f-17', category: 'Returns', question: 'Who pays for return postage?', answer: 'We do if the item was faulty, damaged or not what you ordered. For a change of mind it is ৳100, deducted from the refund.' },
  { id: 'f-18', category: 'Account', question: 'Do I need an account to buy?', answer: 'No. Guest checkout works fully. An account only adds saved addresses, order history and one-click returns.' },
  { id: 'f-19', category: 'Account', question: 'I forgot my password.', answer: 'Use the Forgot Password link on the sign-in page. You will get a reset link by email that is valid for one hour.' },
  { id: 'f-20', category: 'Account', question: 'How do I delete my account?', answer: 'Email us from the address on the account and we will delete it within 30 days. Orders already placed are kept for as long as tax law requires, but are detached from your profile.' },
  { id: 'f-21', category: 'Products', question: 'Are the colours in photographs accurate?', answer: 'We shoot everything ourselves under consistent lighting, so they are close. Screens do vary, and the product page lists the exact fabric and colour name for anything where it matters.' },
  { id: 'f-22', category: 'Products', question: 'How do I choose a size?', answer: 'Every clothing product page has a size chart with real measurements in centimetres, taken from the garment rather than copied from the supplier.' },
  { id: 'f-23', category: 'Products', question: 'An item is out of stock — will it come back?', answer: 'Usually. Use Notify Me on the product page and we will email you the moment it is back, once, with no marketing attached.' },
  { id: 'f-24', category: 'Products', question: 'Are your products genuine?', answer: 'Yes. We buy from authorised distributors and keep the paperwork. If you ever doubt an item, contact us with the order number and we will send you its provenance.' },
];

export async function mockCmsPage(slug: string): Promise<CmsPage | null> {
  return PAGES.find((entry) => entry.slug === slug) ?? null;
}

export async function mockCmsPageSlugs(): Promise<string[]> {
  return PAGES.map((entry) => entry.slug);
}

export async function mockFaqs(): Promise<Faq[]> {
  return FAQS;
}

/** Accepts and forgets. The fixture layer has nowhere to put a subscriber. */
export async function mockSubscribeNewsletter(email: string): Promise<void> {
  console.info(`[storefront:mock] newsletter subscribe — ${email}`);
}

export async function mockSubmitContactMessage(input: ContactInput): Promise<void> {
  console.info(`[storefront:mock] contact message from ${input.email} — ${input.subject}`);
}
